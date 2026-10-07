import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContext } from "../mcpContext.js";
import { ancestorDetailsInLevels, buildLevelsAppendWrites, locateInLevels, readLevelsSnapshot } from "../domain/levelsOps.js";
import {
  resolveMap,
  levelsPathOf,
  formatPath,
  assertCanEditMap,
} from "../domain/mapResolver.js";
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
      const levelsPath = levelsPathOf(map);
      const targetParentId = parentElementId ?? null;

      const parsed = parseMarkdownForImport(markdown, { headingsAsNodes: true });
      if (parsed.nodes.length === 0) {
        throw new Error("Markdownからリスト項目・見出しが見つかりませんでした。");
      }

      let levelsPathResult = "";
      await client.runOptimistic(async () => {
        const snapshot = await readLevelsSnapshot(client, levelsPath);
        if (targetParentId !== null && !locateInLevels(snapshot, targetParentId)) {
          throw new Error(
            `parentElementId(${targetParentId})がこのマップに見つかりません。list_elementsで確認してください。`
          );
        }
        levelsPathResult = formatPath(map.header.title, ancestorDetailsInLevels(snapshot, targetParentId));
        return buildLevelsAppendWrites(levelsPath, snapshot, parsed.nodes, targetParentId, map.header.isTodo);
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                path: levelsPathResult,
                addedElementCount: parsed.nodes.length,
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
