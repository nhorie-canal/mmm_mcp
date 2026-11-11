import { AsyncLocalStorage } from "node:async_hooks";
import type { UserSession } from "./auth/session.js";
import type { PlanGate } from "./domain/planGate.js";
import { validTimeZone } from "./domain/scheduleText.js";
import { FirestoreRestClient } from "./firestore/restClient.js";

export interface McpContext {
  session: UserSession;
  client: FirestoreRestClient;
  /**
   * 時刻付きの期日・着手日と利用の印の日付を解釈するタイムゾーンを返す
   * （`users/{uid}/private/profile` の `timeZone`。アプリが端末のタイムゾーンを書く）。
   * 無い・読めないときは undefined。
   */
  getTimeZone(): Promise<string | undefined>;
  /** 無料プランの上限の判定（無ければ判定しない）。 */
  planGate?: PlanGate;
}

/** 呼び出しごとに別の利用者で動かすための差し込み口（入口の /mcp が使う）。 */
const perCall = new AsyncLocalStorage<McpContext>();

/** [fn] の中のツール呼び出しを、[context] の利用者として動かす。 */
export function runWithContext<T>(context: McpContext, fn: () => T): T {
  return perCall.run(context, fn);
}

const TIME_ZONE_CACHE_MS = 5 * 60 * 1000;

/** プロフィールのタイムゾーンを読む。数分覚え、読めなくても投げない。 */
export function createTimeZoneReader(
  client: Pick<FirestoreRestClient, "getDocument">,
  uid: string,
  now: () => number = Date.now
): () => Promise<string | undefined> {
  let value: string | undefined;
  let readAt = 0;
  return async () => {
    const t = now();
    if (readAt !== 0 && t - readAt < TIME_ZONE_CACHE_MS) return value;
    try {
      const doc = await client.getDocument(`users/${uid}/private/profile`);
      const zone = doc?.data.timeZone;
      value = typeof zone === "string" ? validTimeZone(zone) : undefined;
      readAt = t;
    } catch {
      // 読めないときは前の値のまま。次の呼び出しで読み直す
    }
    return value;
  };
}

/** 今の呼び出しの利用者の文脈。runWithContext の外で呼ばれたら投げる（別の利用者の資格情報を使わないように）。 */
export function getContext(): McpContext {
  const context = perCall.getStore();
  if (!context) throw new Error("呼び出しの利用者の文脈がありません（内部エラー）");
  return context;
}
