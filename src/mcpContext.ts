import { AsyncLocalStorage } from "node:async_hooks";
import { loadSession, type UserSession } from "./auth/session.js";
import type { PlanGate } from "./domain/planGate.js";
import { validTimeZone } from "./domain/scheduleText.js";
import { McpUsageRecorder } from "./firestore/mcpUsage.js";
import { FirestoreRestClient } from "./firestore/restClient.js";

export interface McpContext {
  session: UserSession;
  client: FirestoreRestClient;
  /**
   * 時刻付きの期日・着手日と利用の印の日付を解釈するタイムゾーンを返す
   * （`users/{uid}/private/profile` の `timeZone`。アプリが端末のタイムゾーンを書く）。
   * 無い・読めないときは undefined（ローカル版は PC の現地時刻）。
   */
  getTimeZone(): Promise<string | undefined>;
  /** 無料プランの上限の判定（リモート版だけ。無ければ判定しない）。 */
  planGate?: PlanGate;
}

/** 呼び出しごとに別の利用者で動かすための差し込み口（リモート版の入口が使う）。 */
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
      // 読めないときは、前の値（無ければ PC の現地時刻）のまま。次の呼び出しで読み直す
    }
    return value;
  };
}

let contextRequired = false;
/**
 * 呼び出しごとの文脈（runWithContext）が無いときに、ローカル版のサインイン（~/.config/mmm-mcp）へ落ちず投げる。
 * 常時動くリモート版の入口が呼ぶ（文脈の付け忘れで、サーバーの持つ別の資格情報を使ってしまわないように）。
 */
export function requirePerCallContext(): void {
  contextRequired = true;
}

let cached: McpContext | null = null;

/** サインイン済みセッションとFirestoreクライアントを1つだけ用意し、使い回す。 */
export function getContext(): McpContext {
  const override = perCall.getStore();
  if (override) return override;
  if (contextRequired) throw new Error("呼び出しの利用者の文脈がありません（内部エラー）");
  if (!cached) {
    const session = loadSession();
    const client = new FirestoreRestClient(session);
    const usage = new McpUsageRecorder();
    const getTimeZone = createTimeZoneReader(client, session.uid);
    // マップへの書き込みに成功したら、その日の初回だけ「MCP から書いた日」の印をつける
    client.onWriteSucceeded = async () => usage.record(client, session.uid, new Date(), await getTimeZone());
    cached = { session, client, getTimeZone };
  }
  return cached;
}

/** サインインし直したときに呼び、次のツール呼び出しで新しい認証情報を読み直させる。 */
export function resetContext(): void {
  cached = null;
}
