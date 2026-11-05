import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContext } from "../mcpContext.js";
import { resolveMap, levelsPathOf } from "../domain/mapResolver.js";
import { type ElementNode } from "../domain/levels.js";
import { elementTreeOf, readLevelsSnapshot } from "../domain/levelsOps.js";
import { formatScheduleDate } from "../domain/scheduleText.js";
import { parseDocumentDetail } from "../domain/documentRef.js";
import { checkReadAllowed } from "./readGate.js";

// ElementNodeの`done`を`checked`という名前で公開する(仕様書の用語に合わせる)。
function toChecked(nodes: ElementNode[]): unknown[] {
  return nodes.map((n) => ({
    id: n.id,
    detail: n.detail,
    // MD 文書の要素は、中身を read_document で読めるよう文書のidとタイトルを添える
    ...(parseDocumentDetail(n.detail) ? { document: parseDocumentDetail(n.detail) } : {}),
    checked: n.done,
    // 日付は付いているときだけ返す(docs/schedule.md §3 MCP)
    ...(n.schedule?.due ? { due: formatScheduleDate(n.schedule.due) } : {}),
    ...(n.schedule?.start ? { start: formatScheduleDate(n.schedule.start) } : {}),
    children: toChecked(n.children),
  }));
}

export function registerListElements(server: McpServer): void {
  server.tool(
    "list_elements",
    "指定したマップ内の全要素と親子関係、チェック状態(checked)、期日(due)・着手日(start)を返す。" +
      "dueとstartは付いている要素にだけあり、終日なら\"YYYY-MM-DD\"、時刻付きなら" +
      "\"YYYY-MM-DD HH:mm\"(このPCの現地時刻)。" +
      "checkedは各要素にFirestoreへ実際に保存されている生の値であり、" +
      "「祖先がチェック済みなら配下も完了とみなす」という加工は行っていない。" +
      "そう解釈したい場合は、返ってきたツリーを見てこちら(呼び出す側)で判断すること。" +
      "呼ぶ前にユーザーへ確認しないこと。まずconfirmedを付けずに呼ぶ。" +
      "アプリでAIからの読み取りを「常に許可」にしたマップは、そのまま実データを返す。" +
      "それ以外のマップは、実データの代わりに確認を促すメッセージだけを返すので、" +
      "そのときに限りユーザーに直接確認してからconfirmed: trueで呼び直すこと。" +
      "アプリ側での直接の編集はこのツールを呼ぶまで反映されないため、" +
      "ユーザーから進捗や状態を尋ねられたときは記憶に頼らず必ず呼び直すこと。" +
      "MD文書の要素にはdocument(documentIdとtitle)が付く。detailは「mmmdoc://…」で始まる印とタイトルで、" +
      "文書の中身はread_documentで読む。",
    {
      mapId: z.string().describe("list_mapsで得たマップのID"),
      confirmed: z
        .boolean()
        .optional()
        .describe(
          "最初は付けない。確認を促すメッセージが返ったときだけ、ユーザー本人に直接" +
            "「中身を確認してよいか」と尋ね、同意を得てからtrueを付けて呼び直す。" +
            "確認前にtrueを付けてはならない。"
        ),
    },
    async ({ mapId, confirmed }) => {
      const { client, session } = getContext();
      const map = await resolveMap(client, session, mapId);

      // 実データは確認のゲートを通過するまで一切読みに行かない(readGate.ts)
      const confirmation = checkReadAllowed(map, mapId, confirmed);
      if (confirmation !== null) {
        return { content: [{ type: "text", text: confirmation }] };
      }

      // levels/rootが無いマップは空のマップとして返す(アプリで開いてもrootは作られない)。
      const tree = elementTreeOf(await readLevelsSnapshot(client, levelsPathOf(map)));

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
