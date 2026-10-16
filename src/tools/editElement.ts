import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContext } from "../mcpContext.js";
import { assertDetailLengths } from "../domain/detailLimit.js";
import { ancestorDetailsInLevels, buildLevelsPatchWrites, readLevelsSnapshot } from "../domain/levelsOps.js";
import {
  resolveMap,
  levelsPathOf,
  formatPath,
  assertCanEditMap,
} from "../domain/mapResolver.js";

export function registerEditElement(server: McpServer): void {
  server.tool(
    "edit_element",
    "既存マップの要素1件の本文(detail)を書き換える。要素の追加はauto_structure_thought・" +
      "import_markdown_contextを、チェック状態の変更はupdate_task_statusを使うこと。",
    {
      mapId: z.string().describe("list_mapsで得たマップのID"),
      elementId: z.string().describe("list_elementsで得た要素のID"),
      detail: z.string().min(1).describe("書き換え後の本文(1要素5000文字まで)"),
    },
    async ({ mapId, elementId, detail }) => {
      assertDetailLengths([detail]);
      const { client, session } = getContext();
      const map = await resolveMap(client, session, mapId);
      assertCanEditMap(map, session);
      const levelsPath = levelsPathOf(map);

      let levelsPathResult: string | null = null;
      await client.runOptimistic(async () => {
        const snapshot = await readLevelsSnapshot(client, levelsPath);
        const { writes, found } = buildLevelsPatchWrites(levelsPath, snapshot, [
          { elementId, patch: { detail } },
        ]);
        if (!found.has(elementId)) {
          throw new Error(
            `elementId(${elementId})がこのマップに見つかりません。list_elementsで確認してください。`
          );
        }
        // snapshotは書き込み前なので、末尾(この要素自身)だけ書き換え後の本文にする。
        const chain = ancestorDetailsInLevels(snapshot, elementId);
        chain[chain.length - 1] = detail;
        levelsPathResult = formatPath(map.header.title, chain);
        return writes;
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ path: levelsPathResult }, null, 2) }],
      };
    }
  );
}
