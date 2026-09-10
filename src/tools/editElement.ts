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
import type { FirestoreWrite } from "../firestore/restClient.js";
import { assertLevelsRootExists, buildUpdateEntryWrites, levelsDocExists } from "../domain/levels.js";

export function registerEditElement(server: McpServer): void {
  server.tool(
    "edit_element",
    "既存マップの要素1件の本文(detail)を書き換える。要素の追加はauto_structure_thought・" +
      "import_markdown_contextを、チェック状態の変更はupdate_task_statusを使うこと。",
    {
      mapId: z.string().describe("list_mapsで得たマップのID"),
      elementId: z.string().describe("list_elementsで得た要素のID"),
      detail: z.string().min(1).describe("書き換え後の本文"),
    },
    async ({ mapId, elementId, detail }) => {
      const { client, session } = getContext();
      const map = await resolveMap(client, session, mapId);
      assertCanEditMap(map, session);
      const levelsPath = levelsPathOf(map);
      const bodiesPath = bodiesPathOf(map);

      assertLevelsRootExists(await levelsDocExists(client, levelsPath, "root"), map.header.title);

      let path: string | null = null;
      await client.runOptimistic(async () => {
        const bodyDoc = await client.getDocument(`${bodiesPath}/${elementId}`);
        if (!bodyDoc) {
          throw new Error(
            `elementId(${elementId})がこのマップに見つかりません。list_elementsで確認してください。`
          );
        }
        const body = bodyFromFirestore(elementId, bodyDoc.data, bodyDoc.updateTime);
        const existingDocs = await client.listDocuments(bodiesPath);
        const existingBodies = existingDocs.map((d) => bodyFromFirestore(d.id, d.data, d.updateTime));
        path = formatPath(map.header.title, ancestorDetails(existingBodies, elementId));

        const writes: FirestoreWrite[] = [
          {
            path: `${bodiesPath}/${elementId}`,
            fields: { detail },
            requireUpdateTime: body.updateTime,
          },
        ];
        const levelWrites = await buildUpdateEntryWrites(client, levelsPath, [
          { parentId: body.parent, elementId, patch: { detail } },
        ]);
        return [...writes, ...levelWrites];
      });

      return {
        content: [{ type: "text", text: JSON.stringify({ path }, null, 2) }],
      };
    }
  );
}
