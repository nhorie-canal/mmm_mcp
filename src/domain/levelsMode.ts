// levels移行の切替フラグ。アプリと同じく Firestore の config/app.migrationEnabled を
// 見て、trueなら書き込み系ツールはbodiesを一切使わずlevelsだけで読み書きする
// (levelsOps.ts)。falseの間は従来どおりbodiesとlevelsの両方へ書く。
//
// フラグを見ずにlevelsだけへ書くと、切替前はアプリ(bodiesを読んで書く)の
// 書き込みがMCPの変更を上書きしてしまう。逆にbodiesを使い続けると、切替後は
// アプリで足した要素が見つからず、bodiesを読み取り専用にするルールの適用後は
// コミットごと失敗する。呼び出しのたびに読み直すので、MCPサーバーを
// 再起動しなくても切替に追従する。

import type { FirestoreRestClient } from "../firestore/restClient.js";
import { LevelsNotInitializedError } from "./levels.js";
import { levelsSnapshotFromDocs, type LevelsSnapshot } from "./levelsOps.js";

export async function isLevelsOnly(client: FirestoreRestClient): Promise<boolean> {
  const config = await client.getDocument("config/app");
  return config?.data.migrationEnabled === true;
}

/** levels全件を読む。levels/rootが無ければ、アプリで開いてもらうよう案内して止める。 */
export async function readLevelsSnapshot(
  client: FirestoreRestClient,
  levelsPath: string,
  mapTitle: string
): Promise<LevelsSnapshot> {
  const snapshot = levelsSnapshotFromDocs(await client.listDocuments(levelsPath));
  if (!snapshot.has("root")) throw new LevelsNotInitializedError(mapTitle);
  return snapshot;
}
