import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import open from "open";
import { APPLE_SERVICES_ID, APPLE_RELAY_URL, APPLE_LOOPBACK_PORT } from "../firebaseConfig.js";

const AUTHORIZE_ENDPOINT = "https://appleid.apple.com/auth/authorize";

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Appleは(Googleと違って)localhostへのredirect_uriを許可しないため、
 * Firebase Hosting上の中継ページ(web/mcp-apple-relay.html)を経由して
 * このプロセスに認可コードを引き渡してもらう。中継ページのURLは
 * 固定でなければならず、そこにポート番号を含められないため、
 * ここでは毎回固定ポート(APPLE_LOOPBACK_PORT)でローカルサーバーを立てる。
 */
export async function signInWithAppleLoopback(): Promise<string> {
  const state = base64url(randomBytes(16));

  return new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${APPLE_LOOPBACK_PORT}`);
        if (url.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const returnedState = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<p>サインインがキャンセルされました。このタブは閉じて構いません。</p>");
          server.close();
          reject(new Error(`Apple認証が拒否されました: ${error}`));
          return;
        }

        if (returnedState !== state || !code) {
          // stateが一致しない・codeが無いリクエストは、favicon取得等の無関係な
          // アクセスの可能性もあるため、応答だけしてサーバーは閉じずに待ち続ける。
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<p>不正なリクエストです。このタブは閉じて構いません。</p>");
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          "<p>Appleサインインが完了しました。このタブは閉じてターミナルに戻ってください。</p>"
        );
        server.close();
        resolve(code);
      } catch (err) {
        res.writeHead(500).end("internal error");
        server.close();
        reject(err);
      }
    });

    server.listen(APPLE_LOOPBACK_PORT, "127.0.0.1", () => {
      const authUrl = new URL(AUTHORIZE_ENDPOINT);
      authUrl.searchParams.set("client_id", APPLE_SERVICES_ID);
      authUrl.searchParams.set("redirect_uri", APPLE_RELAY_URL);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("response_mode", "query");
      authUrl.searchParams.set("state", state);

      console.log("ブラウザでAppleのサインイン画面を開きます…");
      open(authUrl.toString()).catch(() => {
        console.log(`自動で開けなかった場合は次のURLを開いてください:\n${authUrl.toString()}`);
      });
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `ポート${APPLE_LOOPBACK_PORT}が使用中です。他のプロセスを終了してから再試行してください。`
          )
        );
      } else {
        reject(err);
      }
    });
  });
}
