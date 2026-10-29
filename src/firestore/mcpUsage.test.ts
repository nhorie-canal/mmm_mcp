import assert from "node:assert/strict";
import { test } from "node:test";
import { McpUsageRecorder } from "./mcpUsage.js";
import type { FirestoreDoc, FirestoreWrite } from "./restClient.js";

// 必要なメソッドだけを持つ手書きの偽クライアント(モックのライブラリは使わない)。
function fakeClient(initial: FirestoreDoc | null, opts: { failRead?: boolean; failWrite?: boolean } = {}) {
  const calls = { reads: 0, commits: [] as FirestoreWrite[][] };
  return {
    calls,
    client: {
      getDocument: async (_path: string) => {
        calls.reads++;
        if (opts.failRead) throw new Error("read failed");
        return initial;
      },
      commitWrites: async (writes: FirestoreWrite[]) => {
        calls.commits.push(writes);
        if (opts.failWrite) throw new Error("write failed");
      },
    },
  };
}

const day = (d: number) => new Date(2026, 9, d, 12);

test("初回は別の commit で1件だけ書く", async () => {
  const { client, calls } = fakeClient(null);
  await new McpUsageRecorder().record(client, "u1", day(29));
  assert.equal(calls.commits.length, 1);
  assert.equal(calls.commits[0].length, 1);
  assert.equal(calls.commits[0][0].path, "users/u1/private/usage");
});

test("同じ日の2回目以降は、読み取りも書き込みもしない", async () => {
  const { client, calls } = fakeClient(null);
  const recorder = new McpUsageRecorder();
  await recorder.record(client, "u1", day(29));
  await recorder.record(client, "u1", day(29));
  await recorder.record(client, "u1", day(29));
  assert.equal(calls.reads, 1);
  assert.equal(calls.commits.length, 1);
});

test("日付が変われば、その日の初回としてまた書く", async () => {
  const doc: FirestoreDoc = { id: "usage", data: { mcpLastWriteDay: "2026-10-29", mcpWriteDays: 1 }, updateTime: "t" };
  const { client, calls } = fakeClient(doc);
  const recorder = new McpUsageRecorder();
  await recorder.record(client, "u1", day(29)); // 今日の印は済み
  assert.equal(calls.commits.length, 0);
  await recorder.record(client, "u1", day(30));
  assert.equal(calls.commits.length, 1);
  assert.deepEqual(calls.commits[0][0].fields, { mcpLastWriteDay: "2026-10-30", mcpWriteDays: 2 });
});

test("読み取りが失敗しても投げず、次の書き込みでもう一度試す", async () => {
  const { client, calls } = fakeClient(null, { failRead: true });
  const recorder = new McpUsageRecorder();
  await assert.doesNotReject(recorder.record(client, "u1", day(29)));
  await recorder.record(client, "u1", day(29));
  assert.equal(calls.reads, 2);
});

test("書き込みが失敗しても投げない(マップへの書き込みの結果は変えない)", async () => {
  const { client } = fakeClient(null, { failWrite: true });
  await assert.doesNotReject(new McpUsageRecorder().record(client, "u1", day(29)));
});
