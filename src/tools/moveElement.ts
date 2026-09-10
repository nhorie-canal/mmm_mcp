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
import {
  assertLevelsRootExists,
  buildRemoveChildrenWrite,
  buildInsertChildWrite,
  levelsDocExists,
} from "../domain/levels.js";

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

        const writes: FirestoreWrite[] = [];

        // 1) 元の場所の連結リストを繋ぎ直す
        if (body.prev !== null) {
          writes.push({
            path: `${bodiesPath}/${body.prev}`,
            fields: { next: body.next },
            requireUpdateTime: byId.get(body.prev)?.updateTime,
          });
        } else if (body.parent !== null) {
          writes.push({
            path: `${bodiesPath}/${body.parent}`,
            fields: { child: body.next },
            requireUpdateTime: byId.get(body.parent)?.updateTime,
          });
        }
        if (body.next !== null) {
          writes.push({
            path: `${bodiesPath}/${body.next}`,
            fields: { prev: body.prev },
            requireUpdateTime: byId.get(body.next)?.updateTime,
          });
        }

        // 2) 新しい場所へ挿入する位置を求める(afterElementIdが実際にnewParentElementId
        //    の子でなければ、見つからない扱い=末尾として無視する)。
        const newSiblingsExcludingSelf = existingBodies.filter(
          (b) => b.parent === newParentElementId && b.id !== elementId
        );
        const afterBody =
          afterElementId !== null
            ? newSiblingsExcludingSelf.find((b) => b.id === afterElementId) ?? null
            : null;
        const newPrevId = afterElementId === null ? null : afterBody?.id ?? null;
        const newNextId =
          newPrevId === null
            ? newSiblingsExcludingSelf.find((b) => b.prev === null)?.id ?? null
            : newSiblingsExcludingSelf.find((b) => b.prev === newPrevId)?.id ?? null;

        writes.push({
          path: `${bodiesPath}/${elementId}`,
          fields: { parent: newParentElementId, prev: newPrevId, next: newNextId },
          requireUpdateTime: body.updateTime,
        });
        if (newPrevId !== null) {
          writes.push({
            path: `${bodiesPath}/${newPrevId}`,
            fields: { next: elementId },
            requireUpdateTime: byId.get(newPrevId)?.updateTime,
          });
        } else if (newParentElementId !== null) {
          writes.push({
            path: `${bodiesPath}/${newParentElementId}`,
            fields: { child: elementId },
            requireUpdateTime: byId.get(newParentElementId)?.updateTime,
          });
        }
        if (newNextId !== null) {
          writes.push({
            path: `${bodiesPath}/${newNextId}`,
            fields: { prev: elementId },
            requireUpdateTime: byId.get(newNextId)?.updateTime,
          });
        }

        // 3) levels側: 元の親から取り除き、新しい親へ挿入する
        const oldLevelId = body.parent ?? "root";
        const removeWrite = await buildRemoveChildrenWrite(client, levelsPath, oldLevelId, [elementId]);
        if (removeWrite) writes.push(removeWrite);
        const newLevelId = newParentElementId ?? "root";
        const insertWrite = await buildInsertChildWrite(
          client,
          levelsPath,
          newLevelId,
          { id: elementId, detail: body.detail, done: body.done },
          newPrevId
        );
        writes.push(insertWrite);

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
