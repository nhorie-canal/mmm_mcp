import { FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN } from "../firebaseConfig.js";

const IDENTITY_TOOLKIT_BASE = "https://identitytoolkit.googleapis.com/v1";
const SECURE_TOKEN_URL = "https://securetoken.googleapis.com/v1/token";

export class FirebaseAuthError extends Error {
  constructor(message: string, public readonly raw?: unknown) {
    super(message);
    this.name = "FirebaseAuthError";
  }
}

/** レスポンスがJSONでない(障害時のHTMLエラーページ等)場合でも例外にせず読む。 */
async function parseJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: { message: text || `HTTP ${res.status}` } };
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await parseJsonResponse(res);
  if (!res.ok) {
    const message = (data as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
    throw new FirebaseAuthError(String(message), data);
  }
  return data as T;
}

export interface SignInResult {
  idToken: string;
  refreshToken: string;
  localId: string;
  email: string | null;
}

/** メール+パスワードでサインインする(Firebase Auth REST API)。 */
export async function signInWithPassword(
  email: string,
  password: string
): Promise<SignInResult> {
  const data = await postJson<{
    idToken: string;
    refreshToken: string;
    localId: string;
    email: string;
  }>(`${IDENTITY_TOOLKIT_BASE}/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
    email,
    password,
    returnSecureToken: true,
  });
  return {
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    localId: data.localId,
    email: data.email ?? null,
  };
}

/**
 * 第三者IdP(Google/Apple)のIDトークンをFirebaseの認証情報に交換する。
 * `providerId`は"google.com"または"apple.com"。
 * Appleでnonceを使った場合は元のnonce文字列(SHA-256化する前の値)を渡す。
 */
export async function signInWithIdp(
  providerId: "google.com" | "apple.com",
  idpIdToken: string,
  nonce?: string
): Promise<SignInResult> {
  let postBody = `id_token=${encodeURIComponent(idpIdToken)}&providerId=${providerId}`;
  if (nonce) {
    postBody += `&nonce=${encodeURIComponent(nonce)}`;
  }
  const data = await postJson<{
    idToken: string;
    refreshToken: string;
    localId: string;
    email?: string;
  }>(`${IDENTITY_TOOLKIT_BASE}/accounts:signInWithIdp?key=${FIREBASE_API_KEY}`, {
    postBody,
    requestUri: `https://${FIREBASE_AUTH_DOMAIN}`,
    returnSecureToken: true,
    returnIdpCredential: true,
  });
  return {
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    localId: data.localId,
    email: data.email ?? null,
  };
}

export interface RefreshedToken {
  idToken: string;
  refreshToken: string;
  userId: string;
  expiresInSec: number;
}

/** refresh_tokenから新しいIDトークンを取得する。 */
export async function refreshIdToken(refreshToken: string): Promise<RefreshedToken> {
  const res = await fetch(`${SECURE_TOKEN_URL}?key=${FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const data = (await parseJsonResponse(res)) as Record<string, unknown>;
  if (!res.ok) {
    const message = (data.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
    throw new FirebaseAuthError(String(message), data);
  }
  return {
    idToken: data.id_token as string,
    refreshToken: data.refresh_token as string,
    userId: data.user_id as string,
    expiresInSec: Number(data.expires_in),
  };
}

/** 現在のアカウントのメールアドレスなどを取得する(accounts:lookup)。 */
export async function lookupAccountEmail(idToken: string): Promise<string | null> {
  const data = await postJson<{ users: Array<{ email?: string }> }>(
    `${IDENTITY_TOOLKIT_BASE}/accounts:lookup?key=${FIREBASE_API_KEY}`,
    { idToken }
  );
  return data.users[0]?.email ?? null;
}
