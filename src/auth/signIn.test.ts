import assert from "node:assert/strict";
import { test } from "node:test";
import { BrowserSignIn, type BrowserSignInMethod } from "./signIn.js";

// ブラウザでの承認の代わりに、外から終わらせられる偽の開始関数を渡す。
function controllableStart() {
  const calls: BrowserSignInMethod[] = [];
  let finish!: (account: string) => void;
  let fail!: (err: Error) => void;
  const start = (method: BrowserSignInMethod) => {
    calls.push(method);
    return new Promise<string | null>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
  };
  return { start, calls, finish: (a: string) => finish(a), fail: (e: Error) => fail(e) };
}

test("待ち時間内に承認されれば、サインインしたアカウントを返し、認証情報を読み直させる", async () => {
  const fake = controllableStart();
  let resets = 0;
  const signIn = new BrowserSignIn(fake.start, () => resets++);

  const running = signIn.run("google", 1_000);
  fake.finish("user@example.com");

  assert.deepEqual(await running, { status: "signed_in", account: "user@example.com" });
  assert.equal(resets, 1);
});

test("待ち時間を過ぎたら承認待ちを返し、承認は裏で続く", async () => {
  const fake = controllableStart();
  let resets = 0;
  const signIn = new BrowserSignIn(fake.start, () => resets++);

  assert.deepEqual(await signIn.run("apple", 10), { status: "pending", method: "apple" });

  fake.finish("user@example.com");
  assert.deepEqual(await signIn.run("apple", 1_000), {
    status: "signed_in",
    account: "user@example.com",
  });
  assert.equal(resets, 1);
});

test("承認待ちの間に呼ばれても新しく始めず、同じ承認を待つ(Appleの固定ポートを二重に開かない)", async () => {
  const fake = controllableStart();
  const signIn = new BrowserSignIn(fake.start, () => {});

  await signIn.run("apple", 10);
  await signIn.run("apple", 10);
  assert.deepEqual(fake.calls, ["apple"]);

  fake.finish("user@example.com");
  await signIn.run("apple", 1_000);
});

test("承認待ちの間に別の方法で呼ばれても、始めた方の承認を待つと返す", async () => {
  const fake = controllableStart();
  const signIn = new BrowserSignIn(fake.start, () => {});

  await signIn.run("apple", 10);
  assert.deepEqual(await signIn.run("google", 10), { status: "pending", method: "apple" });
  assert.deepEqual(fake.calls, ["apple"]);

  fake.finish("user@example.com");
  await signIn.run("apple", 1_000);
});

test("失敗したら理由を返し、次の呼び出しで新しく始め直せる", async () => {
  const fake = controllableStart();
  let resets = 0;
  const signIn = new BrowserSignIn(fake.start, () => resets++);

  const running = signIn.run("google", 1_000);
  fake.fail(new Error("Google認証が拒否されました: access_denied"));
  assert.deepEqual(await running, {
    status: "failed",
    message: "Google認証が拒否されました: access_denied",
  });
  assert.equal(resets, 0);

  // 片付け(finally)が走るのを待ってから呼び直す
  await new Promise((resolve) => setImmediate(resolve));
  const retry = signIn.run("google", 1_000);
  fake.finish("user@example.com");
  assert.deepEqual(await retry, { status: "signed_in", account: "user@example.com" });
  assert.deepEqual(fake.calls, ["google", "google"]);
});
