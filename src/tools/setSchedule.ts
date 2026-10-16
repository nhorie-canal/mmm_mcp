import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContext } from "../mcpContext.js";
import {
  ancestorDetailsInLevels,
  buildLevelsScheduleWrites,
  readLevelsSnapshot,
  type ScheduleUpdate,
} from "../domain/levelsOps.js";
import { resolveMap, levelsPathOf, formatPath, assertCanEditMap } from "../domain/mapResolver.js";
import { parseScheduleDate } from "../domain/scheduleText.js";

const dateSchema = z
  .string()
  .nullable()
  .optional()
  .describe(
    "終日なら\"YYYY-MM-DD\"、時刻付きなら\"YYYY-MM-DD HH:mm\"(このPCの現地時刻)。" +
      "nullで外す。省略するとその日付には触れない"
  );

export function registerSetSchedule(server: McpServer): void {
  server.tool(
    "set_schedule",
    "要素の期日(due)と着手日(start)を付ける・外す。1件でも複数件でもよい。" +
      "親の日付を子に引き継ぐことはしない(親と子の日付は独立している)。" +
      "今の日付はlist_elementsで確認できる。",
    {
      mapId: z.string().describe("list_mapsで得たマップのID"),
      updates: z
        .array(
          z.object({
            elementId: z.string().describe("list_elementsで得た要素のID"),
            due: dateSchema,
            start: dateSchema,
          })
        )
        .min(1),
    },
    async ({ mapId, updates }) => {
      // 日付の書き方の誤りは、何も読まないうちに返す
      const parsed: ScheduleUpdate[] = updates.map((u) => ({
        elementId: u.elementId,
        due: u.due == null ? u.due : parseScheduleDate(u.due),
        start: u.start == null ? u.start : parseScheduleDate(u.start),
      }));

      const { client, session } = getContext();
      const map = await resolveMap(client, session, mapId);
      assertCanEditMap(map, session);
      const levelsPath = levelsPathOf(map);

      let results: Array<{ elementId: string; path: string | null; found: boolean }> = [];
      await client.runOptimistic(async () => {
        const snapshot = await readLevelsSnapshot(client, levelsPath);
        const { writes, found } = buildLevelsScheduleWrites(levelsPath, snapshot, parsed);
        results = updates.map((u) => ({
          elementId: u.elementId,
          path: found.has(u.elementId)
            ? formatPath(map.header.title, ancestorDetailsInLevels(snapshot, u.elementId))
            : null,
          ...(u.due !== undefined ? { due: u.due } : {}),
          ...(u.start !== undefined ? { start: u.start } : {}),
          found: found.has(u.elementId),
        }));
        return writes;
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }],
      };
    }
  );
}
