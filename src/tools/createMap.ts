import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContext } from "../mcpContext.js";

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

      const existing = await client.listDocuments(`users/${session.uid}/headers`);
      const maxOrder = existing.reduce((max, doc) => Math.max(max, Number(doc.data.order ?? 0)), 0);

      const created = await client.createDocument(`users/${session.uid}/headers`, {
        title,
        order: maxOrder + 1,
        isTodo,
        editors: [],
        viewers: [],
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ id: created.id, title, isTodo }, null, 2),
          },
        ],
      };
    }
  );
}
