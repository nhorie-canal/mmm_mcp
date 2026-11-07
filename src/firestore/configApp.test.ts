import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchConfigApp } from "./configApp.js";

const res = (status: number, body: unknown, jsonThrows = false) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (jsonThrows) throw new SyntaxError("Unexpected token");
    return body;
  },
});

test("localMcpEnabled を bool として読む", async () => {
  const data = await fetchConfigApp(res(200, { fields: { localMcpEnabled: { booleanValue: false }, latestVersion: { stringValue: "5.3.0" } } }));
  assert.equal(data?.localMcpEnabled, false);
  assert.equal(data?.latestVersion, "5.3.0");
});

test("文字列の \"false\" は bool として読まれない（止まらない）", async () => {
  const data = await fetchConfigApp(res(200, { fields: { localMcpEnabled: { stringValue: "false" } } }));
  assert.equal(data?.localMcpEnabled, "false");
});

test("404 は null（ドキュメントが無い）", async () => {
  assert.equal(await fetchConfigApp(res(404, {})), null);
});

test("HTTP 500 は投げる", async () => {
  await assert.rejects(fetchConfigApp(res(500, {})), /HTTP 500/);
});

test("壊れた JSON は投げる。fields が無ければ空のオブジェクト", async () => {
  await assert.rejects(fetchConfigApp(res(200, null, true)));
  await assert.rejects(fetchConfigApp(res(200, null)), /不正/);
  assert.deepEqual(await fetchConfigApp(res(200, {})), {});
});
