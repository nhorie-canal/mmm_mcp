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

test("runOptimistic: 書き込みが通ったあとに onWriteSucceeded を呼ぶ。印の失敗は書き込みの結果を変えない", async () => {
  const { client, bodies } = clientCapturing();
  let called = 0;
  client.onWriteSucceeded = async () => {
    called++;
    throw new Error("印の書き込みに失敗");
  };
  await client.runOptimistic(async () => [{ path: "users/u1/headers/h1/levels/root", fields: { children: [] } }]);
  assert.equal(bodies.length, 1);
  assert.equal(called, 1);
});

test("runOptimistic: 書き込みが失敗したときは onWriteSucceeded を呼ばない", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: "x", status: "PERMISSION_DENIED" } }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  const session = { getValidIdToken: async () => "token" } as unknown as AuthSession;
  const client = new FirestoreRestClient(session);
  let called = 0;
  client.onWriteSucceeded = async () => {
    called++;
  };
  await assert.rejects(client.runOptimistic(async () => [{ path: "users/u1/headers/h1", fields: { a: 1 } }]));
  assert.equal(called, 0);
});
