import { loadSession, type AuthSession } from "./auth/session.js";
import { McpUsageRecorder } from "./firestore/mcpUsage.js";
import { FirestoreRestClient } from "./firestore/restClient.js";

export interface McpContext {
  session: AuthSession;
  client: FirestoreRestClient;
}

let cached: McpContext | null = null;

/** サインイン済みセッションとFirestoreクライアントを1つだけ用意し、使い回す。 */
export function getContext(): McpContext {
  if (!cached) {
    const session = loadSession();
    const client = new FirestoreRestClient(session);
    const usage = new McpUsageRecorder();
    // マップへの書き込みに成功したら、その日の初回だけ「MCP から書いた日」の印をつける
    client.onWriteSucceeded = () => usage.record(client, session.uid);
    cached = { session, client };
  }
  return cached;
}

/** サインインし直したときに呼び、次のツール呼び出しで新しい認証情報を読み直させる。 */
export function resetContext(): void {
  cached = null;
}
