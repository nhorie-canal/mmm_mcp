import assert from "node:assert/strict";
import { request } from "node:http";
import { test } from "node:test";
import { startEmailSignInPage } from "./emailLoopback.js";
import { FirebaseAuthError, type SignInResult } from "./firebaseAuthRest.js";

// Firebase には繋がず、手書きの偽のサインイン関数を渡す。ページへは本物の HTTP で送る。
const signedIn: SignInResult = { idToken: "id", refreshToken: "rt", localId: "uid1", email: "a@example.com" };

function send(
  url: string,
  options: { method?: string; body?: string; host?: string } = {}
): Promise<{ status: number; body: string }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: target.port,
        path: "/",
        method: options.method ?? "GET",
        headers: {
          host: options.host ?? target.host,
          "content-type": "application/x-www-form-urlencoded",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

function stateOf(html: string): string {
  const match = html.match(/name="state" value="([0-9a-f]+)"/);
  assert.ok(match, "フォームに state が埋まっている");
  return match[1];
}

function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

test("正しい入力でサインインし、送られたメールアドレスとパスワードをそのまま渡す", async () => {
  const received: Array<[string, string]> = [];
  const page = await startEmailSignInPage({
    signIn: async (email, password) => {
      received.push([email, password]);
      return signedIn;
    },
  });
  const form = await send(page.url);
  assert.equal(form.status, 200);

  const done = await send(page.url, {
    method: "POST",
    body: formBody({ state: stateOf(form.body), email: " a@example.com ", password: "p@ss word" }),
  });
  assert.equal(done.status, 200);
  assert.match(done.body, /ログインしました/);
  assert.deepEqual(await page.result, signedIn);
  assert.deepEqual(received, [["a@example.com", "p@ss word"]]);
});

test("パスワードが違えばページを閉じずに理由を出し、入力し直せる", async () => {
  let attempts = 0;
  const page = await startEmailSignInPage({
    signIn: async () => {
      attempts++;
      if (attempts === 1) throw new FirebaseAuthError("INVALID_LOGIN_CREDENTIALS");
      return signedIn;
    },
  });
  const state = stateOf((await send(page.url)).body);

  const wrong = await send(page.url, {
    method: "POST",
    body: formBody({ state, email: "a@example.com", password: "wrong" }),
  });
  assert.equal(wrong.status, 200);
  assert.match(wrong.body, /メールアドレスかパスワードが違います/);
  assert.match(wrong.body, /value="a@example.com"/, "メールアドレスは入れ直さなくてよい");
  assert.doesNotMatch(wrong.body, /wrong/, "パスワードはページに書き戻さない");

  await send(page.url, { method: "POST", body: formBody({ state, email: "a@example.com", password: "right" }) });
  assert.deepEqual(await page.result, signedIn);
});

test("state が合わない送信は受け付けず、サインインを試みない", async () => {
  let called = false;
  const page = await startEmailSignInPage({
    signIn: async () => {
      called = true;
      return signedIn;
    },
    timeoutMs: 200,
  });
  const res = await send(page.url, {
    method: "POST",
    body: formBody({ state: "0".repeat(32), email: "a@example.com", password: "x" }),
  });
  assert.equal(res.status, 403);
  assert.equal(called, false);
  await assert.rejects(page.result, /時間切れ/);
});

test("Host が 127.0.0.1 でない要求は受け付けない(DNSリバインディング対策)", async () => {
  const page = await startEmailSignInPage({ signIn: async () => signedIn, timeoutMs: 200 });
  const res = await send(page.url, { host: "evil.example.com" });
  assert.equal(res.status, 400);
  await assert.rejects(page.result, /時間切れ/);
});

test("入力された文字列は HTML としてではなく文字として出す", async () => {
  const page = await startEmailSignInPage({
    signIn: async () => {
      throw new FirebaseAuthError("INVALID_EMAIL");
    },
    timeoutMs: 200,
  });
  const state = stateOf((await send(page.url)).body);
  const res = await send(page.url, {
    method: "POST",
    body: formBody({ state, email: '"><script>x</script>', password: "x" }),
  });
  assert.doesNotMatch(res.body, /<script>x<\/script>/);
  assert.match(res.body, /&quot;&gt;&lt;script&gt;/);
  await assert.rejects(page.result, /時間切れ/);
});
