import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContext } from "../mcpContext.js";
import { resolveMap, levelsPathOf } from "../domain/mapResolver.js";
import {
  assertLevelsInitialized,
  buildTreeFromLevels,
  readAllLevelDocs,
  type ElementNode,
} from "../domain/levels.js";

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
//
// 当初はMCP標準のelicitInputで確認していたが、接続クライアントが対応を
// 広告していても実際にはダイアログを一切出さないまま失敗することがあり
// (2026-09-03、Claude Codeデスクトップアプリで確認)、本人が一度も確認画面を
// 見ないまま恒久的に読み取り不能になる不具合があった。ホストごとの
// elicitation対応状況に依存しない、呼び出し側(Claude等)への文面提示+
// confirmedパラメータの方式に一本化した。呼び出し側が実際にユーザーへ
// 確認したかをこちらで検証する手段は無いため、確実な強制ではなく
// ベストエフォートであることを理解した上で採用している。
const confirmedMapIds = new Set<string>();

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
      "ユーザー本人の許可が必要。confirmed: trueを付けずに呼ぶと、このツールは" +
      "実データを返す代わりに確認を促すメッセージだけを返すので、その指示に従って" +
      "ユーザーに直接確認してからconfirmed: trueで呼び直すこと。" +
      "アプリ側での直接の編集はこのツールを呼ぶまで反映されないため、" +
      "ユーザーから進捗や状態を尋ねられたときは記憶に頼らず必ず呼び直すこと。",
    {
      mapId: z.string().describe("list_mapsで得たマップのID"),
      confirmed: z
        .boolean()
        .optional()
        .describe(
          "ユーザー本人に直接「中身を確認してよいか」と尋ね、同意を得てからtrueを付けて呼ぶこと。" +
            "確認前にtrueを付けてはならない。"
        ),
    },
    async ({ mapId, confirmed }) => {
      const { client, session } = getContext();
      const map = await resolveMap(client, session, mapId);

      // 未確認のマップでは、確認を促す文面だけを返して終える。levelsの
      // 実データはこのゲートを通過するまで一切読みに行かない
      // (以前はlevels/rootの存在確認のために先に読んでしまっていたが、
      // 「実際の要素を返す前に必ず本人の明示的な許可を得る」という設計
      // 意図に反するため、確認ゲートの後に読む順序へ戻した)。
      if (!confirmedMapIds.has(mapId)) {
        if (confirmed === true) {
          confirmedMapIds.add(mapId);
        } else {
          return { content: [{ type: "text", text: buildConfirmationRequestText(map.header.title) }] };
        }
      }

      const levelsById = await readAllLevelDocs(client, levelsPathOf(map));
      assertLevelsInitialized(levelsById, map.header.title);
      const tree = buildTreeFromLevels(levelsById);

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
