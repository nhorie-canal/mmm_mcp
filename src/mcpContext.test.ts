import assert from "node:assert/strict";
import { test } from "node:test";
import { createTimeZoneReader, getContext, runWithContext, type McpContext } from "./mcpContext.js";

function client(data: Record<string, unknown> | null, opts: { fail?: boolean } = {}) {
  const calls = { reads: [] as string[] };
  return {
    calls,
    client: {
      getDocument: async (path: string) => {
        calls.reads.push(path);
        if (opts.fail) throw new Error("offline");
        return data ? { id: "u1", data } : null;
      },
    },
  };
}

test("プロフィールの timeZone を読む。数分は読み直さない", async () => {
  let t = 1000;
  const c = client({ timeZone: "Asia/Tokyo" });
  const read = createTimeZoneReader(c.client, "u1", () => t);
  assert.equal(await read(), "Asia/Tokyo");
  assert.equal(await read(), "Asia/Tokyo");
  assert.deepEqual(c.calls.reads, ["users/u1/private/profile"]);
  t += 6 * 60 * 1000;
  await read();
  assert.equal(c.calls.reads.length, 2);
});

test("無い・使えない名前・読めないときは undefined（PC の現地時刻）", async () => {
  assert.equal(await createTimeZoneReader(client(null).client, "u1")(), undefined);
  assert.equal(await createTimeZoneReader(client({}).client, "u1")(), undefined);
  assert.equal(await createTimeZoneReader(client({ timeZone: "Not/AZone" }).client, "u1")(), undefined);
  assert.equal(await createTimeZoneReader(client({ timeZone: 9 }).client, "u1")(), undefined);
  assert.equal(await createTimeZoneReader(client(null, { fail: true }).client, "u1")(), undefined);
});

test("読めなくなっても、前に読めた値を使い続ける", async () => {
  let t = 0;
  let fail = false;
  const read = createTimeZoneReader(
    {
      getDocument: async () => {
        if (fail) throw new Error("offline");
        return { id: "u1", data: { timeZone: "Asia/Tokyo" } };
      },
    },
    "u1",
    () => t
  );
  assert.equal(await read(), "Asia/Tokyo");
  fail = true;
  t += 10 * 60 * 1000;
  assert.equal(await read(), "Asia/Tokyo");
});

test("runWithContext: 呼び出しごとに別の利用者として動き、混ざらない", async () => {
  const make = (uid: string) =>
    ({ session: { uid } as never, client: {} as never, getTimeZone: async () => uid }) as McpContext;
  const results = await Promise.all(
    ["a", "b", "c"].map((uid) =>
      runWithContext(make(uid), async () => {
        await new Promise((r) => setTimeout(r, Math.random() * 10));
        return getContext().session.uid;
      })
    )
  );
  assert.deepEqual(results, ["a", "b", "c"]);
});
