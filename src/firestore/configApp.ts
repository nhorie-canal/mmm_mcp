import { FIREBASE_PROJECT_ID } from "../firebaseConfig.js";
import { decodeFields } from "./valueCodec.js";

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/**
 * config/app は誰でも読めるので、サインインしていなくても認証なしで読む。
 * ドキュメントが無ければ null。HTTP の失敗・壊れた応答は投げる。
 */
export async function fetchConfigApp(
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<Record<string, unknown> | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/config/app`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`config/app: HTTP ${res.status}`);
  const body = (await res.json()) as { fields?: Record<string, never> } | null;
  if (body === null || typeof body !== "object") throw new Error("config/app: 応答の形が不正");
  return decodeFields(body.fields ?? {});
}
