import { test } from "node:test";
import assert from "node:assert/strict";
import { levelsSnapshotFromDocs } from "./levelsOps.js";
import { parseDocumentDetail } from "./documentRef.js";
import {
  MAX_DOCUMENT_BYTES,
  assertDocumentSize,
  buildDocumentCreateWrites,
  documentTitleFromContent,
  encodeDocumentDetail,
  normalizeTitle,
} from "./documentOps.js";

const LEVELS = "users/u/headers/h/levels";
const DOCS = "users/u/headers/h/documents";
const NOW = new Date("2026-11-04T00:00:00Z");

function snapshot(levels: Record<string, string[]>) {
  return levelsSnapshotFromDocs(
    Object.entries(levels).map(([id, ids]) => ({
      id,
      data: { children: ids.map((c) => ({ id: c, detail: c.toUpperCase(), done: false })) },
      updateTime: `t-${id}`,
    }))
  );
}

const input = (over: Partial<Parameters<typeof buildDocumentCreateWrites>[3]> = {}) => ({
  documentId: "DOC1",
  elementId: "EL1",
  content: "# 京都旅行\n本文",
  targetParentId: null,
  isTodo: false,
  now: NOW,
  ...over,
});

test("documentTitleFromContent: 最初の見出し、無ければ最初の行、無ければ代わりの名前", () => {
  assert.equal(documentTitleFromContent("前置き\n## 見出し\n本文"), "見出し");
  assert.equal(documentTitleFromContent("\n\n最初の行\n次"), "最初の行");
  assert.equal(documentTitleFromContent("   \n"), "無題の文書");
  // 見出しの記号だけの行は見出しではないので、最初の行として扱う(アプリと同じ)
  assert.equal(documentTitleFromContent("#   \n本文"), "#");
});

test("documentTitleFromContent: 長いタイトルは60文字で切る(絵文字を割らない)", () => {
  const long = "あ".repeat(100);
  assert.equal(documentTitleFromContent(long), `${"あ".repeat(60)}…`);
  const emoji = "😀".repeat(70);
  assert.equal(documentTitleFromContent(emoji), `${"😀".repeat(60)}…`);
});

test("normalizeTitle: 改行は空白に、前後の空白は落とす", () => {
  assert.equal(normalizeTitle("  a\nb\r\nc  "), "a b c");
});

test("encodeDocumentDetail: アプリが読める形で、読み戻せる", () => {
  const detail = encodeDocumentDetail("DOC1", "京都");
  assert.equal(detail, "mmmdoc://DOC1\n京都");
  assert.deepEqual(parseDocumentDetail(detail), { documentId: "DOC1", title: "京都" });
});

test("buildDocumentCreateWrites: 最上位の末尾に要素を足し、文書を新規作成する(同じpathは重複しない)", () => {
  const { writes, title } = buildDocumentCreateWrites(LEVELS, DOCS, snapshot({ root: ["a", "b"] }), input());
  assert.equal(title, "京都旅行");
  assert.equal(new Set(writes.map((w) => w.path)).size, writes.length);
  const root = writes.find((w) => w.path === `${LEVELS}/root`)!;
  const children = root.fields!.children as Array<{ id: string; detail: string; done: boolean }>;
  assert.deepEqual(children.map((c) => c.id), ["a", "b", "EL1"]);
  assert.equal(children[2].detail, "mmmdoc://DOC1\n京都旅行");
  assert.equal(children[2].done, false);
  assert.equal(root.requireUpdateTime, "t-root");
  const doc = writes.find((w) => w.path === `${DOCS}/DOC1`)!;
  assert.deepEqual(doc.fields, { content: "# 京都旅行\n本文", updatedAt: NOW });
  assert.equal(doc.requireMissing, true);
});

test("buildDocumentCreateWrites: 指定した親の子の末尾に足す。親以外の子一覧は触らない", () => {
  const { writes } = buildDocumentCreateWrites(
    LEVELS,
    DOCS,
    snapshot({ root: ["a", "b"], a: ["a1"] }),
    input({ targetParentId: "a" })
  );
  assert.deepEqual(
    writes.map((w) => w.path).sort(),
    [`${DOCS}/DOC1`, `${LEVELS}/a`].sort()
  );
  const a = writes.find((w) => w.path === `${LEVELS}/a`)!;
  assert.deepEqual((a.fields!.children as Array<{ id: string }>).map((c) => c.id), ["a1", "EL1"]);
});

test("buildDocumentCreateWrites: 子の無い親には子一覧を新規作成する", () => {
  const { writes } = buildDocumentCreateWrites(LEVELS, DOCS, snapshot({ root: ["a"] }), input({ targetParentId: "a" }));
  const a = writes.find((w) => w.path === `${LEVELS}/a`)!;
  assert.equal(a.requireMissing, true);
  assert.deepEqual((a.fields!.children as Array<{ id: string }>).map((c) => c.id), ["EL1"]);
});

test("buildDocumentCreateWrites: levels/root が無いマップでも最上位に足せる", () => {
  const { writes } = buildDocumentCreateWrites(LEVELS, DOCS, snapshot({}), input());
  const root = writes.find((w) => w.path === `${LEVELS}/root`)!;
  assert.equal(root.requireMissing, true);
});

test("buildDocumentCreateWrites: TODOマップでも未チェックで足す。タイトル引数が優先され、改行は空白になる", () => {
  const { writes, title } = buildDocumentCreateWrites(
    LEVELS,
    DOCS,
    snapshot({ root: [] }),
    input({ isTodo: true, title: "手動\nタイトル" })
  );
  assert.equal(title, "手動 タイトル");
  const root = writes.find((w) => w.path === `${LEVELS}/root`)!;
  const [entry] = root.fields!.children as Array<{ detail: string; done: boolean }>;
  assert.equal(entry.done, false);
  assert.equal(entry.detail, "mmmdoc://DOC1\n手動 タイトル");
});

test("assertDocumentSize: 上限ちょうどは通り、超えると何も組まずに例外(UTF-8のバイト数で数える)", () => {
  assertDocumentSize("a".repeat(MAX_DOCUMENT_BYTES));
  assert.throws(() => assertDocumentSize("a".repeat(MAX_DOCUMENT_BYTES + 1)), /上限/);
  // 日本語は1文字3バイト。333,334文字で上限を超える
  assert.throws(() => assertDocumentSize("あ".repeat(333_334)), /上限/);
  assertDocumentSize("あ".repeat(333_333));
  assert.throws(
    () => buildDocumentCreateWrites(LEVELS, DOCS, snapshot({ root: [] }), input({ content: "a".repeat(MAX_DOCUMENT_BYTES + 1) })),
    /何も書き込んでいません/
  );
});
