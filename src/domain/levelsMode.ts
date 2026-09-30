// levels移行の切替フラグ。アプリと同じく Firestore の config/app.migrationEnabled を
// 見て、明示的にfalseの間だけ従来どおりbodiesとlevelsの両方へ書く。それ以外
// (true・フィールドが無い・ドキュメントが無い)はbodiesを一切使わずlevelsだけで
// 読み書きする(levelsOps.ts)。bodies削除後にフラグを消しても、公開済みの古い版が
// bodiesへ書きに行かないよう、未設定はlevels側に倒す。
//
// フラグを見ずにlevelsだけへ書くと、切替前はアプリ(bodiesを読んで書く)の
// 書き込みがMCPの変更を上書きしてしまう。逆にbodiesを使い続けると、切替後は
// アプリで足した要素が見つからず、bodiesを読み取り専用にするルールの適用後は
// コミットごと失敗する。呼び出しのたびに読み直すので、MCPサーバーを
// 再起動しなくても切替に追従する。

import type { FirestoreRestClient } from "../firestore/restClient.js";
import { levelsSnapshotFromDocs, type LevelsSnapshot } from "./levelsOps.js";

export async function isLevelsOnly(client: FirestoreRestClient): Promise<boolean> {
  const config = await client.getDocument("config/app");
  return config?.data.migrationEnabled !== false;
}

/**
 * levels全件を読む。levels/rootが無いマップは空のマップとして扱う
 * (rootへの最初の書き込みは、存在しないことを前提条件にした新規作成になる)。
 * 切替後はアプリでマップを開いてもrootが作られないので、「アプリで開いて」と
 * 止めると中身の無い古いマップへ永久に書き込めなくなる。
 */
export async function readLevelsSnapshot(
  client: FirestoreRestClient,
  levelsPath: string
): Promise<LevelsSnapshot> {
  return levelsSnapshotFromDocs(await client.listDocuments(levelsPath));
}
