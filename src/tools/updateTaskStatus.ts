import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContext } from "../mcpContext.js";
import { resolveMap, bodiesPathOf, formatPath, assertCanEditMap } from "../domain/mapResolver.js";
import { bodyFromFirestore, ancestorDetails } from "../domain/body.js";
import type { FirestoreWrite } from "../firestore/restClient.js";

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
      const bodiesPath = bodiesPathOf(map);

      const existingDocs = await client.listDocuments(bodiesPath);
      const existingBodies = existingDocs.map((d) => bodyFromFirestore(d.id, d.data));
      const byId = new Map(existingBodies.map((b) => [b.id, b]));

      const writes: FirestoreWrite[] = [];
      const results: Array<{ elementId: string; path: string | null; checked: boolean; found: boolean }> = [];
      for (const update of updates) {
        const body = byId.get(update.elementId);
        if (!body) {
          results.push({ elementId: update.elementId, path: null, checked: update.checked, found: false });
          continue;
        }
        writes.push({
          path: `${bodiesPath}/${update.elementId}`,
          fields: { done: update.checked },
        });
        const path = formatPath(map.header.title, ancestorDetails(existingBodies, update.elementId));
        results.push({ elementId: update.elementId, path, checked: update.checked, found: true });
      }

      await client.commitWrites(writes);

      return {
        content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }],
      };
    }
  );
}
