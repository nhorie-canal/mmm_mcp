import { loadSession, type AuthSession } from "./auth/session.js";
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
    cached = { session, client: new FirestoreRestClient(session) };
  }
  return cached;
}
