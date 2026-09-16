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
import { mergeWritesByPath, type FirestoreWrite } from "../firestore/restClient.js";
import { assertLevelsRootExists, buildRemoveChildrenWrite, levelsDocExists } from "../domain/levels.js";

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
        const currentById = new Map(currentBodies.map((b) => [b.id, b]));

        const writes: FirestoreWrite[] = [];
        const levelRemovals = new Map<string, string[]>();
        const allIds = new Set<string>();

        // 1周目: 消える要素を全て確定させる。繋ぎ直しは2周目で行う。
        // **先に全体を確定させること。** 隣り合う要素を同時に消すとき、
        // 1件ずつその場で繋ぎ直すと、消える予定の相手を指すポインタを
        // 書いてしまい、存在しないIDを指したまま残る。
        for (const elementId of elementIds) {
          const body = currentById.get(elementId);
          if (!body) continue; // 既に削除済み(リトライ時など)
          const subtree = collectSubtreeIds(currentBodies, elementId);
          for (const id of subtree) allIds.add(id);
          deletedPaths.push({
            elementId,
            path: formatPath(map.header.title, ancestorDetails(currentBodies, elementId)),
            subtreeCount: subtree.length,
          });
        }

        /** [startId]から[key]方向へ、消えない要素に当たるまで辿る。 */
        const survivingNeighbor = (
          startId: string | null,
          key: "prev" | "next"
        ): string | null => {
          let cursor = startId;
          const seen = new Set<string>();
          while (cursor !== null && allIds.has(cursor) && !seen.has(cursor)) {
            seen.add(cursor);
            cursor = currentById.get(cursor)?.[key] ?? null;
          }
          return cursor;
        };

        // 2周目: 生き残る要素どうしを繋ぎ直す。
        for (const elementId of elementIds) {
          const body = currentById.get(elementId);
          if (!body) continue;
          const newPrev = survivingNeighbor(body.prev, "prev");
          const newNext = survivingNeighbor(body.next, "next");
          if (newPrev !== null) {
            writes.push({
              path: `${bodiesPath}/${newPrev}`,
              fields: { next: newNext },
              requireUpdateTime: currentById.get(newPrev)?.updateTime,
            });
          } else if (body.parent !== null && !allIds.has(body.parent)) {
            writes.push({
              path: `${bodiesPath}/${body.parent}`,
              fields: { child: newNext },
              requireUpdateTime: currentById.get(body.parent)?.updateTime,
            });
          }
          if (newNext !== null) {
            writes.push({
              path: `${bodiesPath}/${newNext}`,
              fields: { prev: newPrev },
              requireUpdateTime: currentById.get(newNext)?.updateTime,
            });
          }
          const levelId = body.parent ?? "root";
          const list = levelRemovals.get(levelId) ?? [];
          list.push(elementId);
          levelRemovals.set(levelId, list);
        }

        for (const id of allIds) {
          writes.push({ path: `${bodiesPath}/${id}`, delete: true });
          // 配下の要素が子を持っていた場合、そのlevelsドキュメント自体も消す。
          // 存在しないドキュメントへのdeleteはFirestoreでは無害。
          writes.push({ path: `${levelsPath}/${id}`, delete: true });
        }
        for (const [levelId, removeIds] of levelRemovals) {
          // 親自身も消えるなら、levels/{親} は上のdeleteで消える。
          // ここで書き戻すと、消したドキュメントが中身入りで復活する。
          if (allIds.has(levelId)) continue;
          const write = await buildRemoveChildrenWrite(client, levelsPath, levelId, removeIds);
          if (write) writes.push(write);
        }

        totalDeleted = allIds.size;
        return mergeWritesByPath(writes);
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
