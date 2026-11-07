import { zonedParts } from "./scheduleText.js";
import type { FirestoreWrite } from "../firestore/restClient.js";

/** MCP の利用の印を置くドキュメント(`users/{uid}/private/usage`)のパス。 */
export function mcpUsagePath(uid: string): string {
  return `users/${uid}/private/usage`;
}

/** アプリで設定しているタイムゾーン（無ければ PC の現地）の日付(YYYY-MM-DD)。 */
export function localDayKey(now: Date, timeZone?: string): string {
  const p = zonedParts(now, timeZone);
  const y = String(p.y).padStart(4, "0");
  const m = String(p.mo).padStart(2, "0");
  const d = String(p.d).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 読み取った `usage` ドキュメント。まだ無ければ null。 */
export interface McpUsageDoc {
  data: Record<string, unknown>;
  updateTime?: string;
}

/**
 * マップへの書き込みに成功したあとに書く「MCP から書いた日」の印を組み立てる。
 * その日の初回だけ書く: `mcpLastWriteDay` が今日ならすでに印があるので null。
 * 印の書き込みは、読み取ったときの状態を前提にする(無ければ「まだ無い」、あれば
 * その updateTime)。別の MCP が同時に印を付けていたら失敗するだけで、数え直さない。
 */
export function planMcpUsageWrite(
  uid: string,
  existing: McpUsageDoc | null,
  today: string
): FirestoreWrite | null {
  const path = mcpUsagePath(uid);
  if (!existing) {
    return {
      path,
      fields: { mcpLastWriteDay: today, mcpWriteDays: 1 },
      requireMissing: true,
    };
  }
  if (existing.data.mcpLastWriteDay === today) return null;
  const days = existing.data.mcpWriteDays;
  const previous = typeof days === "number" && Number.isInteger(days) && days >= 0 ? days : 0;
  return {
    path,
    fields: { mcpLastWriteDay: today, mcpWriteDays: previous + 1 },
    requireUpdateTime: existing.updateTime,
    // 更新時刻が取れていないときは、せめて「無い」ドキュメントを作らない
    requireExists: existing.updateTime ? undefined : true,
  };
}
