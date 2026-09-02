import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContext } from "../mcpContext.js";
import { resolveMap, bodiesPathOf, formatPath, assertCanEditMap } from "../domain/mapResolver.js";
import { bodyFromFirestore, ancestorDetails } from "../domain/body.js";
import { buildForestFromTree, buildAppendWrites, type TreeInputNode } from "../domain/appendForest.js";

const treeNodeSchema: z.ZodType<TreeInputNode> = z.lazy(() =>
  z.object({
    detail: z.string().min(1).describe("要素の本文"),
    done: z.boolean().optional().describe("TODOマップのときのチェック状態(省略時false)"),
    children: z.array(treeNodeSchema).optional().describe("この要素の内側に入れ子にする子要素"),
  })
);

export function registerAutoStructureThought(server: McpServer): void {
  server.tool(
    "auto_structure_thought",
    "会話中にClaudeが考えた階層構造を、既存のマップに追加する。深さは3階層固定ではなく任意。" +
      "構造化のロジック(何をどう分解するか)はClaude側の判断で行い、このツールはFirestoreへの" +
      "書き込みだけを行う。追加先(parentElementId)はlist_elementsの結果を見て判断すること。" +
      "対象は既存マップのみ(新規作成が必要ならcreate_mapを先に呼ぶ)。",
    {
      mapId: z.string().describe("list_mapsで得たマップのID"),
      parentElementId: z
        .string()
        .nullable()
        .optional()
        .describe("この要素の内側(子)として追加する。マップの最上位に追加する場合はnullまたは省略"),
      nodes: z.array(treeNodeSchema).min(1).describe("追加する階層構造(ルートの配列)"),
    },
    async ({ mapId, parentElementId, nodes }) => {
      const { client, session } = getContext();
      const map = await resolveMap(client, session, mapId);
      assertCanEditMap(map, session);
      const bodiesPath = bodiesPathOf(map);

      const existingDocs = await client.listDocuments(bodiesPath);
      const existingBodies = existingDocs.map((d) => bodyFromFirestore(d.id, d.data));

      const targetParentId = parentElementId ?? null;
      if (targetParentId !== null && !existingBodies.some((b) => b.id === targetParentId)) {
        throw new Error(
          `parentElementId(${targetParentId})がこのマップに見つかりません。list_elementsで確認してください。`
        );
      }
      const forest = buildForestFromTree(nodes);
      const { writes, createdIds } = buildAppendWrites(
        bodiesPath,
        existingBodies,
        forest,
        targetParentId,
        map.header.isTodo
      );
      await client.commitWrites(writes);

      const path = formatPath(map.header.title, ancestorDetails(existingBodies, targetParentId));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { path, addedElementCount: createdIds.length },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
