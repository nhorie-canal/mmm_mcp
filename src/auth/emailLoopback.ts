import { createServer, type IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import { FirebaseAuthError, type SignInResult } from "./firebaseAuthRest.js";

/**
 * メール+パスワードの入力を、AIとの会話ではなくブラウザで受け取る。
 * このプロセスが 127.0.0.1 に一時的に入力ページを開き、送られた値で
 * Firebase にサインインする。パスワードはこのプロセスとFirebaseの間だけを通る。
 *
 * - 開くたびに作る state をフォームに埋め、合わない送信は受け付けない
 * - Host が 127.0.0.1:<port> 以外の要求は受け付けない(DNSリバインディング対策)
 * - パスワードが違えばページを閉じずに理由を出し、入力し直してもらう
 */
export interface EmailSignInPage {
  url: string;
  result: Promise<SignInResult>;
}

export interface EmailSignInPageOptions {
  signIn: (email: string, password: string) => Promise<SignInResult>;
  timeoutMs?: number;
}

const MAX_BODY_BYTES = 16 * 1024;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Firebase のエラーコードを、入力し直す人に向けた文に直す。 */
export function describeSignInError(err: unknown): string {
  const code = err instanceof FirebaseAuthError ? err.message.split(" ")[0] : "";
  switch (code) {
    case "INVALID_LOGIN_CREDENTIALS":
    case "INVALID_PASSWORD":
    case "EMAIL_NOT_FOUND":
      return (
        "メールアドレスかパスワードが違います。アプリでGoogleかAppleでログインしている場合も" +
        "このエラーになります(その場合はAIに「Googleでログインして」「Appleでログインして」と頼んでください)。 / " +
        "Wrong email or password. You also get this error if you use Google or Apple in the app; " +
        "in that case, ask the AI to sign in with Google or Apple instead."
      );
    case "INVALID_EMAIL":
      return "メールアドレスの形が正しくありません。 / The email address is not valid.";
    case "TOO_MANY_ATTEMPTS_TRY_LATER":
      return "試した回数が多すぎます。しばらく待ってからやり直してください。 / Too many attempts. Please try again later.";
    case "USER_DISABLED":
      return "このアカウントは使えなくなっています。 / This account has been disabled.";
    default:
      return `サインインできませんでした / Could not sign in: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function renderForm(state: string, error?: string, email = ""): string {
  const errorBlock = error ? `<p class="error">${escapeHtml(error)}</p>` : "";
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Matryoshka Mind Map - Sign in</title>
<style>
body{font-family:-apple-system,"Segoe UI",sans-serif;background:#f5f5f7;color:#1d1d1f;display:flex;justify-content:center;padding:48px 16px;margin:0}
main{background:#fff;border-radius:16px;padding:28px;max-width:380px;width:100%;box-shadow:0 2px 12px rgba(0,0,0,.08)}
h1{font-size:20px;margin:0 0 6px}p.note{font-size:13px;color:#6e6e73;margin:0 0 20px;line-height:1.5}
label{display:block;font-size:13px;margin:14px 0 6px}input{width:100%;box-sizing:border-box;padding:10px 12px;font-size:16px;border:1px solid #d2d2d7;border-radius:10px}
button{margin-top:22px;width:100%;padding:12px;font-size:16px;border:0;border-radius:10px;background:#0071e3;color:#fff;cursor:pointer}
p.error{background:#fff2f2;color:#c00;border-radius:10px;padding:10px 12px;font-size:13px;line-height:1.5}
</style></head><body><main>
<h1>Matryoshka Mind Map</h1>
<p class="note">アプリで使っているメールアドレスとパスワードを入力してください。この画面はあなたのパソコンの中だけで開いていて、パスワードはAIには渡りません。<br>Enter the email and password you use in the app. This page runs only on your computer; your password is not shared with the AI.</p>
${errorBlock}
<form method="post" action="/">
<input type="hidden" name="state" value="${escapeHtml(state)}">
<label for="email">メールアドレス / Email</label>
<input id="email" name="email" type="email" autocomplete="username" required value="${escapeHtml(email)}">
<label for="password">パスワード / Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required>
<button type="submit">ログイン / Sign in</button>
</form></main></body></html>`;
}

const DONE_PAGE = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>Matryoshka Mind Map</title></head>
<body style="font-family:-apple-system,sans-serif;padding:48px 16px;text-align:center">
<p>ログインしました。このタブは閉じて構いません。<br>You are signed in. You can close this tab.</p></body></html>`;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/** 入力ページを開き、URLとサインインの結果を返す。ブラウザで開くのは呼び出す側。 */
export async function startEmailSignInPage(options: EmailSignInPageOptions): Promise<EmailSignInPage> {
  const state = randomBytes(16).toString("hex");
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;

  let settle!: { resolve: (r: SignInResult) => void; reject: (e: Error) => void };
  const result = new Promise<SignInResult>((resolve, reject) => {
    settle = { resolve, reject };
  });

  const server = createServer(async (req, res) => {
    const port = (server.address() as { port: number }).port;
    if (req.headers.host !== `127.0.0.1:${port}`) {
      res.writeHead(400).end();
      return;
    }
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname !== "/") {
      res.writeHead(404).end();
      return;
    }
    const html = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };

    if (req.method === "GET") {
      res.writeHead(200, html).end(renderForm(state));
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }

    let form: URLSearchParams;
    try {
      form = new URLSearchParams(await readBody(req));
    } catch {
      res.writeHead(413).end();
      return;
    }
    if (form.get("state") !== state) {
      res.writeHead(403).end();
      return;
    }
    const email = (form.get("email") ?? "").trim();
    const password = form.get("password") ?? "";

    try {
      const signedIn = await options.signIn(email, password);
      res.writeHead(200, html).end(DONE_PAGE);
      clearTimeout(timer);
      server.close();
      settle.resolve(signedIn);
    } catch (err) {
      res.writeHead(200, html).end(renderForm(state, describeSignInError(err), email));
    }
  });

  const timer = setTimeout(() => {
    server.close();
    settle.reject(new Error("入力ページが時間切れで閉じました。もう一度 sign_in を呼んでください。"));
  }, timeoutMs);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/`, result };
}
