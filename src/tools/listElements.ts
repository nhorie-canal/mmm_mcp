import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContext } from "../mcpContext.js";
import { resolveMap, bodiesPathOf } from "../domain/mapResolver.js";
import { bodyFromFirestore, buildTree, type ElementNode } from "../domain/body.js";

// ElementNodeの`done`を`checked`という名前で公開する(仕様書の用語に合わせる)。
function toChecked(nodes: ElementNode[]): unknown[] {
  return nodes.map((n) => ({
    id: n.id,
    detail: n.detail,
    checked: n.done,
    children: toChecked(n.children),
  }));
}

// マップの中身には秘匿情報が含まれ得るため、実際の要素を返す前に必ず本人の
// 明示的な許可を得る。このサーバープロセスが生きている間(概ね1会話)、
// 同じマップへの確認は1回でよい。
const confirmedMapIds = new Set<string>();

/** 接続してきたMCPクライアントがelicitation(form)に対応しているか。 */
function clientSupportsElicitation(server: McpServer): boolean {
  return Boolean(server.server.getClientCapabilities()?.elicitation?.form);
}

/** MCP標準のelicitInputで確認する(対応クライアントでの確実な経路)。 */
async function confirmReadAccessViaElicitation(
  server: McpServer,
  mapId: string,
  title: string
): Promise<void> {
  // 追加のフォーム入力は要らない、単純な許可/拒否の確認。
  // フォーム内に必須の真偽値フィールドを別途持たせると、クライアント側が
  // 「許可する」ボタンとチェック欄を別に扱い、チェックを入れ忘れたまま
  // 送信されて意図せず拒否扱いになることがある(実機で確認)。
  // action(accept/decline/cancel)だけで判定する。
  const result = await server.server.elicitInput(
    {
      message: `「${title}」の中身を読み取ります。よろしいですか？`,
      requestedSchema: { type: "object", properties: {} },
    },
    { timeout: 300_000 }
  );

  if (result.action !== "accept") {
    throw new Error(`「${title}」の中身の読み取りが許可されませんでした。`);
  }
  confirmedMapIds.add(mapId);
}

/**
 * elicitationに対応していないクライアント向けのフォールバック文面。
 * 呼び出し側(Claude等)が実際にユーザーへ確認したかをこちらで検証する
 * 手段は無いため、あくまでベストエフォートの経路であることに注意。
 */
function buildConfirmationRequestText(title: string): string {
  return (
    `「${title}」の中身を読み取る前に、ユーザー本人に直接「中身を確認してよいか」と` +
    "尋ねてください。まだ実データは返していません。同意が得られたら、confirmed: true を" +
    "付けてこのツールを再度呼び出してください。"
  );
}

export function registerListElements(server: McpServer): void {
  server.tool(
    "list_elements",
    "指定したマップ内の全要素と親子関係、チェック状態(checked)を返す。" +
      "checkedは各要素にFirestoreへ実際に保存されている生の値であり、" +
      "「祖先がチェック済みなら配下も完了とみなす」という加工は行っていない。" +
      "そう解釈したい場合は、返ってきたツリーを見てこちら(呼び出す側)で判断すること。" +
      "マップの中身には秘匿情報が含まれ得るため、初めて読むマップでは呼び出し前に" +
      "ユーザー本人の許可が必要。接続クライアントがelicitationに対応していれば" +
      "自動的に確認ダイアログが出る(拒否された場合はエラーになるので、その旨を" +
      "そのままユーザーに伝えること)。対応していない場合はこのツールがconfirmed:" +
      "falseのままエラーにせずメッセージだけを返すので、その指示に従って" +
      "ユーザーに直接確認してからconfirmed: trueで呼び直すこと。" +
      "アプリ側での直接の編集はこのツールを呼ぶまで反映されないため、" +
      "ユーザーから進捗や状態を尋ねられたときは記憶に頼らず必ず呼び直すこと。",
    {
      mapId: z.string().describe("list_mapsで得たマップのID"),
      confirmed: z
        .boolean()
        .optional()
        .describe(
          "elicitation非対応クライアント向け。ユーザー本人に直接確認し、同意を得てからtrueを付けて呼ぶこと。" +
            "elicitation対応クライアントでは無視される。"
        ),
    },
    async ({ mapId, confirmed }) => {
      const { client, session } = getContext();
      const map = await resolveMap(client, session, mapId);

      if (!confirmedMapIds.has(mapId)) {
        if (clientSupportsElicitation(server)) {
          await confirmReadAccessViaElicitation(server, mapId, map.header.title);
        } else if (confirmed === true) {
          confirmedMapIds.add(mapId);
        } else {
          return { content: [{ type: "text", text: buildConfirmationRequestText(map.header.title) }] };
        }
      }

      const docs = await client.listDocuments(bodiesPathOf(map));
      const bodies = docs.map((d) => bodyFromFirestore(d.id, d.data));
      const tree = buildTree(bodies);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                mapId: map.headerId,
                title: map.header.title,
                isTodo: map.header.isTodo,
                elements: toChecked(tree),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
