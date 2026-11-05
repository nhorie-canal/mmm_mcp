import { test } from "node:test";
import assert from "node:assert/strict";
import { documentContentOf, documentTitleIn, parseDocumentDetail } from "./documentRef.js";

test("parseDocumentDetail", async (t) => {
  await t.test("印と2行目のタイトルを読む", () => {
    assert.deepEqual(parseDocumentDetail("mmmdoc://abc123\n旅程"), { documentId: "abc123", title: "旅程" });
  });
  await t.test("タイトルが無くても文書の要素", () => {
    assert.deepEqual(parseDocumentDetail("mmmdoc://abc123"), { documentId: "abc123", title: "" });
  });
  await t.test("普通の文字・画像のURL・空は文書ではない", () => {
    assert.equal(parseDocumentDetail("買い物"), null);
    assert.equal(parseDocumentDetail("https://example.com/a.png"), null);
    assert.equal(parseDocumentDetail(""), null);
  });
  await t.test("印が壊れたもの(idが空・空白や/を含む・先頭に無い)は文書ではない", () => {
    assert.equal(parseDocumentDetail("mmmdoc://"), null);
    assert.equal(parseDocumentDetail("mmmdoc://\nタイトル"), null);
    assert.equal(parseDocumentDetail("mmmdoc://a b\nx"), null);
    assert.equal(parseDocumentDetail("mmmdoc://a/b\nx"), null);
    assert.equal(parseDocumentDetail("x mmmdoc://abc\nメモ"), null);
  });
});

test("documentContentOf", async (t) => {
  await t.test("content の文字列を返す", () => {
    assert.equal(documentContentOf({ content: "# 見出し" }), "# 見出し");
  });
  await t.test("無い・文字列でないときは空文字", () => {
    assert.equal(documentContentOf({}), "");
    assert.equal(documentContentOf({ content: 1 }), "");
  });
});

test("documentTitleIn", async (t) => {
  const details = ["普通", "mmmdoc://a\nA", "mmmdoc://b\nB"];
  await t.test("文書を指す要素のタイトルを返す", () => {
    assert.equal(documentTitleIn(details, "b"), "B");
  });
  await t.test("どの要素も指していなければ null", () => {
    assert.equal(documentTitleIn(details, "zzz"), null);
  });
});
