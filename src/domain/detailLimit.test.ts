import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_DETAIL_LENGTH, assertDetailLengths } from "./detailLimit.js";

test("assertDetailLengths", async (t) => {
  await t.test("上限ちょうどまでは通す", () => {
    assert.doesNotThrow(() => assertDetailLengths(["a", "あ".repeat(MAX_DETAIL_LENGTH)]));
  });

  await t.test("1件でも上限を超えれば、文字数と上限を添えて投げる", () => {
    assert.throws(
      () => assertDetailLengths(["a", "x".repeat(MAX_DETAIL_LENGTH + 1)]),
      new RegExp(`${MAX_DETAIL_LENGTH + 1}文字.*${MAX_DETAIL_LENGTH}文字`)
    );
  });

  await t.test("UTF-16の単位で数える(絵文字は2)", () => {
    assert.throws(() => assertDetailLengths(["😀".repeat(MAX_DETAIL_LENGTH / 2 + 1)]));
  });
});
