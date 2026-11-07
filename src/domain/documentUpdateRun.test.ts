import assert from "node:assert/strict";
import { test } from "node:test";
import { DocumentConflictError, encodeDocumentDetail } from "./documentOps.js";
import { executeUpdateDocument } from "./documentUpdateRun.js";
import { FirestoreError, type FirestoreDoc, type FirestoreWrite } from "../firestore/restClient.js";

const LEVELS = "users/u/headers/h/levels";
const DOCS = "users/u/headers/h/documents";

/**
 * Firestore の前提条件（updateTime）と runOptimistic のやり直しを再現した手書きの偽クライアント
 * （モックのライブラリは使わない）。commit は前提条件が合わなければ FAILED_PRECONDITION で失敗する。
 */
function fakeStore() {
  const store = new Map<string, { data: Record<string, unknown>; v: number }>();
  const calls = { operations: 0, commits: [] as FirestoreWrite[][] };
  let afterFirstDocRead: (() => void) | null = null;
  let afterFirstLevelsRead: (() => void) | null = null;

  const put = (path: string, data: Record<string, unknown>) => {
    const prev = store.get(path);
    store.set(path, { data: { ...(prev?.data ?? {}), ...data }, v: (prev?.v ?? 0) + 1 });
  };
  const toDoc = (path: string): FirestoreDoc | null => {
    const e = store.get(path);
    return e ? { id: path.split("/").pop()!, data: e.data, updateTime: `v${e.v}` } : null;
  };

  const client = {
    async getDocument(path: string) {
      const doc = toDoc(path);
      const hook = afterFirstDocRead;
      afterFirstDocRead = null;
      hook?.();
      return doc;
    },
    async listDocuments(collectionPath: string) {
      const docs = [...store.keys()]
        .filter((p) => p.startsWith(`${collectionPath}/`))
        .map((p) => toDoc(p)!);
      const hook = afterFirstLevelsRead;
      afterFirstLevelsRead = null;
      hook?.();
      return docs;
    },
    async runOptimistic(operation: () => Promise<FirestoreWrite[]>, maxAttempts = 5) {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        calls.operations++;
        const writes = await operation();
        calls.commits.push(writes);
        const ok = writes.every((w) => {
          if (w.requireUpdateTime === undefined) return true;
          return `v${store.get(w.path)?.v}` === w.requireUpdateTime;
        });
        if (!ok) continue; // FAILED_PRECONDITION → 読み直してやり直す
        for (const w of writes) put(w.path, w.fields as Record<string, unknown>);
        return;
      }
      throw new FirestoreError("retries exhausted", 400);
    },
  };
  return {
    client,
    store,
    calls,
    put,
    onFirstDocRead: (f: () => void) => (afterFirstDocRead = f),
    onFirstLevelsRead: (f: () => void) => (afterFirstLevelsRead = f),
  };
}

const el = (id: string, detail: string) => ({ id, detail, done: false });
function seed(s: ReturnType<typeof fakeStore>) {
  s.put(`${LEVELS}/root`, { children: [el("E1", encodeDocumentDetail("DOC1", "京都旅行")), el("X", "ほかの要素")] });
  s.put(`${DOCS}/DOC1`, { content: "# 京都旅行\n元の本文" });
}
const params = (over = {}) => ({
  levelsPath: LEVELS,
  documentsPath: DOCS,
  mapTitle: "マップ",
  documentId: "DOC1",
  baseUpdateTime: "v1",
  content: "# 京都旅行\nAI が直した本文",
  ...over,
});

test("読んだ updateTime のままなら、中身を上書きする", async () => {
  const s = fakeStore();
  seed(s);
  const r = await executeUpdateDocument(s.client as never, params());
  assert.equal(r.title, "京都旅行");
  assert.equal(s.store.get(`${DOCS}/DOC1`)!.data.content, "# 京都旅行\nAI が直した本文");
});

test("読んだあとに(update_document の前に)アプリで保存されていたら、何も書かず、やり直しもしない", async () => {
  const s = fakeStore();
  seed(s);
  s.put(`${DOCS}/DOC1`, { content: "利用者がアプリで保存した本文" }); // v2
  await assert.rejects(executeUpdateDocument(s.client as never, params()), DocumentConflictError);
  assert.equal(s.store.get(`${DOCS}/DOC1`)!.data.content, "利用者がアプリで保存した本文");
  assert.equal(s.calls.commits.length, 0);
});

test("ツールが文書を読んでから commit するまでの間に保存されても、読み直して止まり、上書きしない", async () => {
  const s = fakeStore();
  seed(s);
  s.onFirstDocRead(() => s.put(`${DOCS}/DOC1`, { content: "割り込んだ保存" }));
  await assert.rejects(executeUpdateDocument(s.client as never, params()), DocumentConflictError);
  assert.equal(s.store.get(`${DOCS}/DOC1`)!.data.content, "割り込んだ保存");
  assert.equal(s.calls.commits.length, 1, "前提条件で弾かれた1回だけ。読み直した結果は書かない");
});

test("levels だけが競合したときは、読み直してやり直して書ける", async () => {
  const s = fakeStore();
  seed(s);
  s.onFirstLevelsRead(() => s.put(`${LEVELS}/root`, { children: [el("E1", encodeDocumentDetail("DOC1", "京都旅行")), el("X", "ほかの要素"), el("Y", "割り込みで増えた要素")] }));
  // 見出しが変わる書き換えにして、levels への書き込み（updateTime 前提）を発生させる
  await executeUpdateDocument(s.client as never, params({ content: "# 大阪旅行\n本文" }));
  assert.equal(s.calls.operations, 2);
  assert.equal(s.store.get(`${DOCS}/DOC1`)!.data.content, "# 大阪旅行\n本文");
  const children = s.store.get(`${LEVELS}/root`)!.data.children as Array<{ id: string; detail: string }>;
  assert.deepEqual(children.map((c) => c.id), ["E1", "X", "Y"], "割り込みで増えた要素を消さない");
  assert.equal(children[0].detail, "mmmdoc://DOC1\n大阪旅行");
});

test("要素が無い・中身が無いときは何も書かない", async () => {
  const s = fakeStore();
  seed(s);
  await assert.rejects(executeUpdateDocument(s.client as never, params({ documentId: "NOPE" })), /文書が見つかりません/);
  s.store.delete(`${DOCS}/DOC1`);
  await assert.rejects(executeUpdateDocument(s.client as never, params()), /中身がありません/);
  assert.equal(s.calls.commits.length, 0);
});
