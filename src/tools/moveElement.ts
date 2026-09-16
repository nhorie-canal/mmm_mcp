import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContext } from "../mcpContext.js";
import {
  resolveMap,
  bodiesPathOf,
  levelsPathOf,
  formatPath,
  assertCanEditMap,
} from "../domain/mapResolver.js";
import { bodyFromFirestore, ancestorDetails } from "../domain/body.js";
import { assertLevelsRootExists, levelsDocExists } from "../domain/levels.js";
import { buildMoveElementWrites } from "../domain/moveElement.js";

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
      const bodiesPath = bodiesPathOf(map);
      assertLevelsRootExists(await levelsDocExists(client, levelsPath, "root"), map.header.title);

      if (elementId === newParentElementId) {
        throw new Error("要素を自分自身の子にすることはできません。");
      }
      if (elementId === afterElementId) {
        throw new Error("afterElementIdにelementId自身は指定できません。");
      }

      let path: string | null = null;
      await client.runOptimistic(async () => {
        const existingDocs = await client.listDocuments(bodiesPath);
        const existingBodies = existingDocs.map((d) => bodyFromFirestore(d.id, d.data, d.updateTime));
        const byId = new Map(existingBodies.map((b) => [b.id, b]));

        const body = byId.get(elementId);
        if (!body) {
          throw new Error(
            `elementId(${elementId})がこのマップに見つかりません。list_elementsで確認してください。`
          );
        }
        if (newParentElementId !== null && !byId.has(newParentElementId)) {
          throw new Error(
            `newParentElementId(${newParentElementId})がこのマップに見つかりません。`
          );
        }
        if (afterElementId !== null && !byId.has(afterElementId)) {
          throw new Error(`afterElementId(${afterElementId})がこのマップに見つかりません。`);
        }
        // 移動先が自分自身の配下(子孫)だと、木構造が壊れる(循環になる)。
        for (let cur = newParentElementId; cur !== null; cur = byId.get(cur)?.parent ?? null) {
          if (cur === elementId) {
            throw new Error("要素を自分自身の配下(子孫)の中へ移動することはできません。");
          }
        }

        const writes = await buildMoveElementWrites(
          client,
          bodiesPath,
          levelsPath,
          existingBodies,
          elementId,
          newParentElementId,
          afterElementId
        );

        path = formatPath(
          map.header.title,
          newParentElementId === null
            ? []
            : ancestorDetails(existingBodies, newParentElementId)
        );
        return writes;
      });

      return {
        content: [{ type: "text", text: JSON.stringify({ path }, null, 2) }],
      };
    }
  );
}
