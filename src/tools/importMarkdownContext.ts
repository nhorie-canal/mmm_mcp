import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContext } from "../mcpContext.js";
import { resolveMap, bodiesPathOf, formatPath, assertCanEditMap } from "../domain/mapResolver.js";
import { bodyFromFirestore, ancestorDetails } from "../domain/body.js";
import { buildAppendWrites } from "../domain/appendForest.js";
import { parseMarkdownForImport } from "../domain/markdownParser.js";

export function registerImportMarkdownContext(server: McpServer): void {
  server.tool(
    "import_markdown_context",
    "任意の深さのMarkdown(インデントで階層を表現したリスト、見出しは`#`)を組み立てて、" +
      "既存のマップに流し込む。見出しも1つの要素として取り込む。" +
      "取り込み先がTODOマップでない場合、`- [ ]`/`- [x]`のチェックボックス記法は取り除かれ" +
      "チェック状態も反映されない(アプリ本体の挙動と同じ)。" +
      "対象は既存マップのみ(新規作成が必要ならcreate_mapを先に呼ぶ)。",
    {
      mapId: z.string().describe("list_mapsで得たマップのID"),
      markdown: z.string().min(1).describe("取り込むMarkdownテキスト"),
      parentElementId: z
        .string()
        .nullable()
        .optional()
        .describe("この要素の内側(子)として取り込む。マップの最上位に取り込む場合はnullまたは省略"),
    },
    async ({ mapId, markdown, parentElementId }) => {
      const { client, session } = getContext();
      const map = await resolveMap(client, session, mapId);
      assertCanEditMap(map, session);
      const bodiesPath = bodiesPathOf(map);

      const existingDocs = await client.listDocuments(bodiesPath);
      const existingBodies = existingDocs.map((d) => bodyFromFirestore(d.id, d.data));

      const parsed = parseMarkdownForImport(markdown, { headingsAsNodes: true });
      if (parsed.nodes.length === 0) {
        throw new Error("Markdownからリスト項目・見出しが見つかりませんでした。");
      }

      const targetParentId = parentElementId ?? null;
      if (targetParentId !== null && !existingBodies.some((b) => b.id === targetParentId)) {
        throw new Error(
          `parentElementId(${targetParentId})がこのマップに見つかりません。list_elementsで確認してください。`
        );
      }
      const { writes, createdIds } = buildAppendWrites(
        bodiesPath,
        existingBodies,
        parsed.nodes,
        targetParentId,
        map.header.isTodo
      );
      await client.commitWrites(writes);

      const path = formatPath(map.header.title, ancestorDetails(existingBodies, targetParentId));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                path,
                addedElementCount: createdIds.length,
                checkboxIgnored: !map.header.isTodo && parsed.hasCheckbox,
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
