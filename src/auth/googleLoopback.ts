import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import open from "open";
import { loadGoogleOAuthClientConfig } from "./googleOAuthConfig.js";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

function base64url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * `gcloud auth login`と同種のローカルループバック方式でGoogleにサインインし、
 * IDトークン(JWT、Firebaseへの交換に使う)を返す。
 */
export async function signInWithGoogleLoopback(): Promise<string> {
  const { client_id, client_secret } = loadGoogleOAuthClientConfig();
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  const state = base64url(randomBytes(16));

  const idToken = await new Promise<string>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/") {
          res.writeHead(404).end();
          return;
        }
        const returnedState = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        const errorParam = url.searchParams.get("error");

        if (errorParam) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<p>ログインがキャンセルされました。このタブは閉じて構いません。</p>");
          server.close();
          reject(new Error(`Google認証が拒否されました: ${errorParam}`));
          return;
        }
        if (returnedState !== state || !code) {
          res.writeHead(400).end("invalid state");
          return;
        }

        const port = (server.address() as { port: number }).port;
        const tokenRes = await fetch(TOKEN_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id,
            client_secret,
            redirect_uri: `http://127.0.0.1:${port}`,
            grant_type: "authorization_code",
            code_verifier: codeVerifier,
          }),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.id_token) {
          throw new Error(tokenData.error_description ?? "Googleトークン交換に失敗しました");
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          "<p>Googleログインが完了しました。このタブは閉じてターミナルに戻ってください。</p>"
        );
        server.close();
        resolve(tokenData.id_token as string);
      } catch (err) {
        res.writeHead(500).end("internal error");
        server.close();
        reject(err);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      const redirectUri = `http://127.0.0.1:${port}`;
      const authUrl = new URL(AUTH_ENDPOINT);
      authUrl.searchParams.set("client_id", client_id);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", "openid email profile");
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("code_challenge", codeChallenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("prompt", "select_account");

      console.log("ブラウザでGoogleのログイン画面を開きます…");
      open(authUrl.toString()).catch(() => {
        console.log(`自動で開けなかった場合は次のURLを開いてください:\n${authUrl.toString()}`);
      });
    });

    server.on("error", reject);
  });

  return idToken;
}
