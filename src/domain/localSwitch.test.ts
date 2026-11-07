import assert from "node:assert/strict";
import { test } from "node:test";
import { isLocalMcpDisabled, LocalSwitch, localMcpDisabledMessage, SWITCH_CACHE_MS } from "./localSwitch.js";

test("localMcpEnabled が false のときだけ止める", () => {
  assert.equal(isLocalMcpDisabled({ localMcpEnabled: false }), true);
  assert.equal(isLocalMcpDisabled({ localMcpEnabled: true }), false);
  assert.equal(isLocalMcpDisabled({}), false);
  assert.equal(isLocalMcpDisabled(null), false);
  assert.equal(isLocalMcpDisabled({ localMcpEnabled: "false" }), false);
});

test("案内にリモート版の URL を含む", () => {
  assert.match(localMcpDisabledMessage(), /https:\/\/mmm\.spheres\.jp\/mcp/);
});

test("無効のとき true、有効のとき false を返す", async () => {
  assert.equal(await new LocalSwitch(async () => ({ localMcpEnabled: false })).isDisabled(), true);
  assert.equal(await new LocalSwitch(async () => ({ localMcpEnabled: true })).isDisabled(), false);
});

test("読めないときは止めない", async () => {
  const sw = new LocalSwitch(async () => {
    throw new Error("offline");
  });
  assert.equal(await sw.isDisabled(), false);
});

test("結果を一定時間覚え、過ぎたら読み直す", async () => {
  let t = 1000;
  let reads = 0;
  let value = true;
  const sw = new LocalSwitch(
    async () => {
      reads++;
      return { localMcpEnabled: value };
    },
    () => t
  );
  assert.equal(await sw.isDisabled(), false);
  value = false;
  t += SWITCH_CACHE_MS - 1;
  assert.equal(await sw.isDisabled(), false);
  assert.equal(reads, 1);
  t += 2;
  assert.equal(await sw.isDisabled(), true);
  assert.equal(reads, 2);
});

test("止まっている状態で読み取りが失敗しても、止まったまま", async () => {
  let t = 0;
  let fail = false;
  const sw = new LocalSwitch(
    async () => {
      if (fail) throw new Error("5xx");
      return { localMcpEnabled: false };
    },
    () => t
  );
  assert.equal(await sw.isDisabled(), true);
  fail = true;
  t += SWITCH_CACHE_MS + 1;
  assert.equal(await sw.isDisabled(), true);
});

test("失敗したあとも、5分以内は読み直さない", async () => {
  let t = 0;
  let reads = 0;
  const sw = new LocalSwitch(
    async () => {
      reads++;
      throw new Error("offline");
    },
    () => t
  );
  await sw.isDisabled();
  t += SWITCH_CACHE_MS - 1;
  await sw.isDisabled();
  assert.equal(reads, 1);
  t += 2;
  await sw.isDisabled();
  assert.equal(reads, 2);
});
