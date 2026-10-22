import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { AuthSession } from "../auth/session.js";
import { FirestoreRestClient } from "./restClient.js";

// fetch だけを手書きの偽物に差し替えて、commit に送る本文を見る(モックのライブラリは使わない)。
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function clientCapturing(): { client: FirestoreRestClient; bodies: Array<{ writes: Array<Record<string, unknown>> }> } {
  const bodies: Array<{ writes: Array<Record<string, unknown>> }> = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    bodies.push(JSON.parse(init!.body!));
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const session = { getValidIdToken: async () => "token" } as unknown as AuthSession;
  return { client: new FirestoreRestClient(session), bodies };
}

test("requireExists: ドキュメントが存在することを前提にして書く(無ければ作らず失敗させる)", async () => {
  const { client, bodies } = clientCapturing();
  await client.commitWrites([{ path: "users/u1/headers/h1", fields: { linkCounts: {} }, requireExists: true }]);
  assert.deepEqual(bodies[0].writes[0].currentDocument, { exists: true });
});

test("前提の指定が無ければ currentDocument を付けない", async () => {
  const { client, bodies } = clientCapturing();
  await client.commitWrites([{ path: "users/u1/headers/h1/levels/root", fields: { children: [] } }]);
  assert.equal("currentDocument" in bodies[0].writes[0], false);
});
