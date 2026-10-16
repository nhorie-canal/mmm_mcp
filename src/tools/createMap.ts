import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContext } from "../mcpContext.js";
import { newDocId } from "../domain/idGen.js";
import { buildCreateMapWrites } from "../domain/headerOrder.js";

export function registerCreateMap(server: McpServer): void {
  server.tool(
    "create_map",
    "新しいマインドマップ(マップ)を1つ作成する。" +
      "list_mapsで確認して該当するマップが無いときだけ呼ぶこと。" +
      "呼ぶ前に、会話でタイトル案をユーザーに提示し、明示的な確認を得ること" +
      "(自動判断で勝手に作成しない)。",
    {
      title: z.string().min(1).describe("マップのタイトル"),
      isTodo: z.boolean().describe("TODOマップ(要素にチェックボックスを付ける)にするかどうか"),
    },
    async ({ title, isTodo }) => {
      const { client, session } = getContext();

      const headersPath = `users/${session.uid}/headers`;
      // 振り直しは読んだ時点の updateTime を前提条件にするので、読んでから書くまでに
      // ほかの端末で見出しが変わると失敗する。そのときは読み取りからやり直す。
      // id はやり直しても同じものを使う(失敗した commit は何も書いていない)。
      const headerId = newDocId();
      await client.runOptimistic(async () =>
        buildCreateMapWrites(headersPath, await client.listDocuments(headersPath), headerId, title, isTodo)
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ id: headerId, title, isTodo }, null, 2),
          },
        ],
      };
    }
  );
}
