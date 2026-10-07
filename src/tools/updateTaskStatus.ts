import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContext } from "../mcpContext.js";
import { ancestorDetailsInLevels, buildLevelsPatchWrites, readLevelsSnapshot } from "../domain/levelsOps.js";
import {
  resolveMap,
  levelsPathOf,
  formatPath,
  assertCanEditMap,
} from "../domain/mapResolver.js";

export function registerUpdateTaskStatus(server: McpServer): void {
  server.tool(
    "update_task_status",
    "TODOマップの要素のチェック状態を書き換える。1件でも複数件でもよい。" +
      "「親をチェックすると配下も完了扱いになる」というアプリ内の表示上の挙動は" +
      "このツールでは再現しない(指定した要素だけを書き換える、配下への自動連鎖はしない)。" +
      "配下も揃えたい場合は、対象の要素をすべてupdatesに列挙すること。",
    {
      mapId: z.string().describe("list_mapsで得たマップのID"),
      updates: z
        .array(
          z.object({
            elementId: z.string().describe("list_elementsで得た要素のID"),
            checked: z.boolean().describe("設定するチェック状態"),
          })
        )
        .min(1),
    },
    async ({ mapId, updates }) => {
      const { client, session } = getContext();
      const map = await resolveMap(client, session, mapId);
      assertCanEditMap(map, session);
      if (!map.header.isTodo) {
        throw new Error(
          `「${map.header.title}」はTODOマップではないため、チェック状態を持ちません。`
        );
      }
      const levelsPath = levelsPathOf(map);

      let levelsResults: Array<{ elementId: string; path: string | null; checked: boolean; found: boolean }> =
        [];
      await client.runOptimistic(async () => {
        const snapshot = await readLevelsSnapshot(client, levelsPath);
        const { writes, found } = buildLevelsPatchWrites(
          levelsPath,
          snapshot,
          updates.map((u) => ({ elementId: u.elementId, patch: { done: u.checked } }))
        );
        levelsResults = updates.map((u) => ({
          elementId: u.elementId,
          path: found.has(u.elementId)
            ? formatPath(map.header.title, ancestorDetailsInLevels(snapshot, u.elementId))
            : null,
          checked: u.checked,
          found: found.has(u.elementId),
        }));
        return writes;
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ results: levelsResults }, null, 2) }],
      };
    }
  );
}
