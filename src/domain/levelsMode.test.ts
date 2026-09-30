import { test } from "node:test";
import assert from "node:assert/strict";
import type { FirestoreDoc, FirestoreRestClient } from "../firestore/restClient.js";
import { isLevelsOnly, readLevelsSnapshot } from "./levelsMode.js";
import { buildLevelsAppendWrites } from "./levelsOps.js";

/** getDocumentだけを持つ手書きの偽クライアント。 */
function fakeClient(configApp: FirestoreDoc | null): FirestoreRestClient {
  return {
    async getDocument(path: string): Promise<FirestoreDoc | null> {
      return path === "config/app" ? configApp : null;
    },
  } as unknown as FirestoreRestClient;
}

test("isLevelsOnly: migrationEnabledが明示的にfalseのときだけbodiesとlevelsの両方へ書く", async () => {
  assert.equal(await isLevelsOnly(fakeClient({ id: "app", data: { migrationEnabled: true } })), true);
  assert.equal(await isLevelsOnly(fakeClient({ id: "app", data: { migrationEnabled: false } })), false);
});

test("isLevelsOnly: migrationEnabledが無ければlevelsだけで読み書きする", async () => {
  // bodies削除後にフラグを消しても、公開済みの古い版がbodiesへ書きに行かないようにする。
  assert.equal(await isLevelsOnly(fakeClient({ id: "app", data: {} })), true);
  assert.equal(await isLevelsOnly(fakeClient(null)), true);
});

/** listDocumentsだけを持つ手書きの偽クライアント。levelsコレクションの中身を返す。 */
function fakeLevelsClient(docs: FirestoreDoc[]): FirestoreRestClient {
  return {
    async listDocuments(): Promise<FirestoreDoc[]> {
      return docs;
    },
  } as unknown as FirestoreRestClient;
}

test("readLevelsSnapshot: levels/rootが無いマップは空のマップとして読む", async () => {
  // 切替後はアプリで開いてもrootが作られないため、「アプリで開いて」と止めると
  // 中身の無い古いマップへ永久に書き込めなくなる。
  const snapshot = await readLevelsSnapshot(fakeLevelsClient([]), "users/u/headers/h/levels");
  assert.equal(snapshot.size, 0);
});

test("readLevelsSnapshot: rootが無いマップへの追加は、rootを新規作成する書き込みになる", async () => {
  const levelsPath = "users/u/headers/h/levels";
  const snapshot = await readLevelsSnapshot(fakeLevelsClient([]), levelsPath);
  const writes = buildLevelsAppendWrites(
    levelsPath,
    snapshot,
    [{ id: "a", detail: "最初の要素", done: false, parentId: null }],
    null,
    false
  );
  assert.deepEqual(writes, [
    {
      path: `${levelsPath}/root`,
      fields: { children: [{ id: "a", detail: "最初の要素", done: false }] },
      requireMissing: true,
    },
  ]);
});
