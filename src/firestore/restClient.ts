import type { AuthSession } from "../auth/session.js";
import { FIREBASE_PROJECT_ID } from "../firebaseConfig.js";
import {
  decodeFields,
  encodeFields,
  encodeValue,
  lastPathSegment,
  type FirestoreValue,
} from "./valueCodec.js";

const BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

export interface FirestoreDoc {
  id: string;
  data: Record<string, unknown>;
}

export class FirestoreError extends Error {
  constructor(message: string, public readonly status: number, public readonly raw?: unknown) {
    super(message);
    this.name = "FirestoreError";
  }
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** レスポンスがJSONでない(障害時のHTMLエラーページ等)場合でも例外にせず読む。 */
async function parseJsonResponse(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: { message: text || `HTTP ${res.status}` } };
  }
}

/** Firestoreの1コミット(:commit)に含められる書き込み件数の上限(500)より余裕を持たせた値。 */
const COMMIT_CHUNK_SIZE = 400;

/** 書き込み系ツールで使う、1件分の更新指示。 */
export interface FirestoreWrite {
  /** ドキュメントの完全パス(例: "users/uid/headers/hid/bodies/bid")。 */
  path: string;
  /** このフィールドだけを部分更新する。delete/arrayUnionが指定されているときは無視される。 */
  fields?: Record<string, unknown>;
  /** trueならこのドキュメントを削除する(fields/arrayUnionは無視)。 */
  delete?: boolean;
  /**
   * levels移行: 既存ドキュメントの配列フィールドの末尾に、読み取りを介さず
   * 追記する(Firestoreネイティブのarray-union transform)。ドキュメントが
   * 存在しないと失敗するため、既存が確実にある場合にのみ使うこと
   * (無ければfieldsで新規作成する側を使う)。
   */
  arrayUnion?: { field: string; values: unknown[] };
}

export class FirestoreRestClient {
  constructor(private session: AuthSession) {}

  private async headers(): Promise<Record<string, string>> {
    const idToken = await this.session.getValidIdToken();
    return {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    };
  }

  async getDocument(path: string): Promise<FirestoreDoc | null> {
    const res = await fetch(`${BASE_URL}/${encodePath(path)}`, {
      headers: await this.headers(),
    });
    if (res.status === 404) return null;
    const data = await parseJsonResponse(res);
    if (!res.ok) {
      throw new FirestoreError(data?.error?.message ?? `HTTP ${res.status}`, res.status, data);
    }
    return { id: lastPathSegment(data.name), data: decodeFields(data.fields ?? {}) };
  }

  /** コレクション配下の全ドキュメントを取得する(ページングを自動で辿る)。 */
  async listDocuments(collectionPath: string): Promise<FirestoreDoc[]> {
    const results: FirestoreDoc[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${BASE_URL}/${encodePath(collectionPath)}`);
      url.searchParams.set("pageSize", "300");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await fetch(url, { headers: await this.headers() });
      const data = await parseJsonResponse(res);
      if (!res.ok) {
        throw new FirestoreError(data?.error?.message ?? `HTTP ${res.status}`, res.status, data);
      }
      for (const doc of data.documents ?? []) {
        results.push({ id: lastPathSegment(doc.name), data: decodeFields(doc.fields ?? {}) });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    return results;
  }

  /** サーバー採番のIDで新規ドキュメントを作る。 */
  async createDocument(
    collectionPath: string,
    fields: Record<string, unknown>
  ): Promise<FirestoreDoc> {
    const res = await fetch(`${BASE_URL}/${encodePath(collectionPath)}`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({ fields: encodeFields(fields) }),
    });
    const data = await parseJsonResponse(res);
    if (!res.ok) {
      throw new FirestoreError(data?.error?.message ?? `HTTP ${res.status}`, res.status, data);
    }
    return { id: lastPathSegment(data.name), data: decodeFields(data.fields ?? {}) };
  }

  /** 指定パスに、全フィールドを置き換える形で書き込む(無ければ作成)。 */
  async setDocument(docPath: string, fields: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${BASE_URL}/${encodePath(docPath)}`, {
      method: "PATCH",
      headers: await this.headers(),
      body: JSON.stringify({ fields: encodeFields(fields) }),
    });
    if (!res.ok) {
      const data = await parseJsonResponse(res);
      throw new FirestoreError(data?.error?.message ?? `HTTP ${res.status}`, res.status, data);
    }
  }

  /** 指定したフィールドだけを部分更新する。 */
  async updateDocument(docPath: string, fields: Record<string, unknown>): Promise<void> {
    const mask = Object.keys(fields).map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`);
    const url = `${BASE_URL}/${encodePath(docPath)}?${mask.join("&")}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: await this.headers(),
      body: JSON.stringify({ fields: encodeFields(fields) }),
    });
    if (!res.ok) {
      const data = await parseJsonResponse(res);
      throw new FirestoreError(data?.error?.message ?? `HTTP ${res.status}`, res.status, data);
    }
  }

  async deleteDocument(docPath: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/${encodePath(docPath)}`, {
      method: "DELETE",
      headers: await this.headers(),
    });
    if (!res.ok && res.status !== 404) {
      const data = await parseJsonResponse(res);
      throw new FirestoreError(data?.error?.message ?? `HTTP ${res.status}`, res.status, data);
    }
  }

  /**
   * 複数ドキュメントへの部分更新・削除をまとめて行う。
   * マインドマップの連結リスト(prev/next/parent/child)を書き換える操作は
   * 一部だけ成功すると整合性が壊れるため、必ずこれを使う。
   *
   * Firestoreの:commitは1リクエストあたり最大500件の書き込みまでしか
   * 受け付けないため、それを超える場合は複数回のコミットに分割する
   * (分割した場合、コミット単位はそれぞれ独立したトランザクションになる)。
   */
  async commitWrites(writes: FirestoreWrite[]): Promise<void> {
    for (let i = 0; i < writes.length; i += COMMIT_CHUNK_SIZE) {
      await this.commitChunk(writes.slice(i, i + COMMIT_CHUNK_SIZE));
    }
  }

  private async commitChunk(writes: FirestoreWrite[]): Promise<void> {
    if (writes.length === 0) return;
    const body = {
      writes: writes.map((w) => {
        const name = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${w.path}`;
        if (w.delete) {
          return { delete: name };
        }
        if (w.arrayUnion) {
          return {
            transform: {
              document: name,
              fieldTransforms: [
                {
                  fieldPath: w.arrayUnion.field,
                  appendMissingElements: { values: w.arrayUnion.values.map(encodeValue) },
                },
              ],
            },
          };
        }
        const fields = w.fields ?? {};
        return {
          update: { name, fields: encodeFields(fields) },
          updateMask: { fieldPaths: Object.keys(fields) },
        };
      }),
    };
    const res = await fetch(`${BASE_URL}:commit`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await parseJsonResponse(res);
      throw new FirestoreError(data?.error?.message ?? `HTTP ${res.status}`, res.status, data);
    }
  }
}

export type { FirestoreValue };
