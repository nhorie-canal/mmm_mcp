import { APPLE_SERVICES_ID, APPLE_RELAY_URL } from "../firebaseConfig.js";

const APPLE_TOKEN_ENDPOINT = "https://appleid.apple.com/auth/token";

/** Appleの認可コードをid_tokenに交換する(トークンエンドポイントへのサーバー間通信)。 */
export async function exchangeAppleAuthorizationCode(
  code: string,
  clientSecret: string
): Promise<string> {
  const res = await fetch(APPLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: APPLE_SERVICES_ID,
      client_secret: clientSecret,
      redirect_uri: APPLE_RELAY_URL,
    }),
  });

  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text };
  }

  if (!res.ok || typeof data.id_token !== "string") {
    const message = (data.error_description as string | undefined) ?? (data.error as string | undefined) ?? `HTTP ${res.status}`;
    throw new Error(`Appleトークン交換に失敗しました: ${message}`);
  }
  return data.id_token;
}
