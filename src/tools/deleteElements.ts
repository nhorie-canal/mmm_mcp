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
import { bodyFromFirestore, ancestorDetails, collectSubtreeIds } from "../domain/body.js";
import { assertLevelsRootExists, levelsDocExists } from "../domain/levels.js";
import { buildDeleteElementWrites } from "../domain/deleteElements.js";

export function registerDeleteElements(server: McpServer): void {
  server.tool(
    "delete_elements",
    "既存マップから要素を削除する。指定した要素とその配下(子孫)を丸ごと削除する。" +
      "削除は取り返しがつかないため、まずconfirmedを省略(またはfalse)で呼び、" +
      "返ってくる削除対象の一覧(パスと配下件数)をユーザーに提示して明示的な同意を得てから、" +
      "confirmed: trueで呼び直すこと。",
    {
      mapId: z.string().describe("list_mapsで得たマップのID"),
      elementIds: z.array(z.string()).min(1).describe("list_elementsで得た要素のID(複数可)"),
      confirmed: z
        .boolean()
        .optional()
        .describe("true以外(省略時false)は削除対象の確認情報だけを返し、実際には削除しない"),
    },
    async ({ mapId, elementIds, confirmed }) => {
      const { client, session } = getContext();
      const map = await resolveMap(client, session, mapId);
      assertCanEditMap(map, session);
      const levelsPath = levelsPathOf(map);
      const bodiesPath = bodiesPathOf(map);
      assertLevelsRootExists(await levelsDocExists(client, levelsPath, "root"), map.header.title);

      if (confirmed !== true) {
        const existingDocs = await client.listDocuments(bodiesPath);
        const existingBodies = existingDocs.map((d) => bodyFromFirestore(d.id, d.data, d.updateTime));
        const byId = new Map(existingBodies.map((b) => [b.id, b]));
        const allTargets = new Set<string>();
        const targets: Array<{ elementId: string; path: string; subtreeCount: number }> = [];
        for (const elementId of elementIds) {
          if (!byId.has(elementId)) {
            throw new Error(
              `elementId(${elementId})がこのマップに見つかりません。list_elementsで確認してください。`
            );
          }
          const subtree = collectSubtreeIds(existingBodies, elementId);
          for (const id of subtree) allTargets.add(id);
          targets.push({
            elementId,
            path: formatPath(map.header.title, ancestorDetails(existingBodies, elementId)),
            subtreeCount: subtree.length,
          });
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  confirmationRequired: true,
                  message:
                    "削除は取り返しがつきません。以下の内容をユーザーに提示して明示的な同意を得てから、" +
                    "confirmed: trueで呼び直してください。",
                  targets,
                  totalElementCount: allTargets.size,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const deletedPaths: Array<{ elementId: string; path: string; subtreeCount: number }> = [];
      let totalDeleted = 0;
      await client.runOptimistic(async () => {
        deletedPaths.length = 0;
        totalDeleted = 0;
        const currentDocs = await client.listDocuments(bodiesPath);
        const currentBodies = currentDocs.map((d) => bodyFromFirestore(d.id, d.data, d.updateTime));

        for (const elementId of elementIds) {
          if (!currentBodies.some((b) => b.id === elementId)) continue; // 既に削除済み(リトライ時など)
          deletedPaths.push({
            elementId,
            path: formatPath(map.header.title, ancestorDetails(currentBodies, elementId)),
            subtreeCount: collectSubtreeIds(currentBodies, elementId).length,
          });
        }

        const { writes, deletedIds } = await buildDeleteElementWrites(
          client,
          bodiesPath,
          levelsPath,
          currentBodies,
          elementIds
        );
        totalDeleted = deletedIds.size;
        return writes;
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ deleted: deletedPaths, totalElementCount: totalDeleted }, null, 2),
          },
        ],
      };
    }
  );
}
