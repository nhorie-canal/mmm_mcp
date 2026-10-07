import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContext } from "../mcpContext.js";
import { ancestorDetailsInLevels, buildLevelsMoveWrites, locateInLevels, readLevelsSnapshot } from "../domain/levelsOps.js";
import {
  resolveMap,
  levelsPathOf,
  formatPath,
  assertCanEditMap,
} from "../domain/mapResolver.js";

export function registerMoveElement(server: McpServer): void {
  server.tool(
    "move_element",
    "既存マップの要素1件(配下ごと)を、同じマップ内の別の場所へ移動する。" +
      "階層をまたいだ移動(昇格・降格)も、同じ階層内の並べ替えも、これ1つで行える。",
    {
      mapId: z.string().describe("list_mapsで得たマップのID"),
      elementId: z.string().describe("移動する要素のID"),
      newParentElementId: z
        .string()
        .nullable()
        .describe("移動先の親要素のID。マップの最上位へ移動する場合はnull"),
      afterElementId: z
        .string()
        .nullable()
        .describe("移動先の中で、このIDの要素の直後に置く。先頭に置く場合はnull"),
    },
    async ({ mapId, elementId, newParentElementId, afterElementId }) => {
      const { client, session } = getContext();
      const map = await resolveMap(client, session, mapId);
      assertCanEditMap(map, session);
      const levelsPath = levelsPathOf(map);

      if (elementId === newParentElementId) {
        throw new Error("要素を自分自身の子にすることはできません。");
      }
      if (elementId === afterElementId) {
        throw new Error("afterElementIdにelementId自身は指定できません。");
      }

      let levelsPathResult: string | null = null;
      await client.runOptimistic(async () => {
        const snapshot = await readLevelsSnapshot(client, levelsPath);
        if (afterElementId !== null && !locateInLevels(snapshot, afterElementId)) {
          throw new Error(`afterElementId(${afterElementId})がこのマップに見つかりません。`);
        }
        const writes = buildLevelsMoveWrites(
          levelsPath,
          snapshot,
          elementId,
          newParentElementId,
          afterElementId
        );
        levelsPathResult = formatPath(
          map.header.title,
          ancestorDetailsInLevels(snapshot, newParentElementId)
        );
        return writes;
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ path: levelsPathResult }, null, 2) }],
      };
    }
  );
}
