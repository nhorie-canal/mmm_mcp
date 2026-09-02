import { APPLE_CLIENT_SECRET_FUNCTION_URL } from "../firebaseConfig.js";

/**
 * Sign in with Appleのclient_secret(JWT)を、Cloud Function経由で取得する。
 * 秘密鍵はこのFunction側だけが持ち、全ユーザーのCLIが共有で呼び出す
 * (client_secretはアプリ自身を認証するものであり、ユーザーごとに
 * 異なるものではないため)。
 */
export async function fetchAppleClientSecret(): Promise<string> {
  let res: Response;
  try {
    res = await fetch(APPLE_CLIENT_SECRET_FUNCTION_URL);
  } catch (err) {
    throw new Error(
      `client_secretの発行元(${APPLE_CLIENT_SECRET_FUNCTION_URL})に接続できませんでした: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }

  if (!res.ok || typeof data.client_secret !== "string") {
    const message = (data.error as string | undefined) ?? `HTTP ${res.status}`;
    throw new Error(`client_secretの取得に失敗しました: ${message}`);
  }
  return data.client_secret;
}
