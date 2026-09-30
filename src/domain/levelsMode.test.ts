import { test } from "node:test";
import assert from "node:assert/strict";
import type { FirestoreDoc, FirestoreRestClient } from "../firestore/restClient.js";
import { isLevelsOnly } from "./levelsMode.js";

/** getDocumentだけを持つ手書きの偽クライアント。 */
function fakeClient(configApp: FirestoreDoc | null): FirestoreRestClient {
  return {
    async getDocument(path: string): Promise<FirestoreDoc | null> {
      return path === "config/app" ? configApp : null;
    },
  } as unknown as FirestoreRestClient;
}

test("isLevelsOnly: migrationEnabledがtrueのときだけlevelsだけで読み書きする", async () => {
  assert.equal(await isLevelsOnly(fakeClient({ id: "app", data: { migrationEnabled: true } })), true);
  assert.equal(await isLevelsOnly(fakeClient({ id: "app", data: { migrationEnabled: false } })), false);
  assert.equal(await isLevelsOnly(fakeClient({ id: "app", data: {} })), false);
  assert.equal(await isLevelsOnly(fakeClient(null)), false);
});
