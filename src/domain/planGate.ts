// 無料プランの上限の判定の差し込み口（docs/paid-plan.md「リモート版の MCP」）。
// 上限を効かせるのはリモート版だけで、ローカル版（npx・.mcpb）は gate を持たず、何も判定しない。
// 判定に使うデータ（マップ数・そのマップの要素数・文書の要素数）は、書き込みの前に既に読み直しているものだけで、
// 読み取りは増えない。上限に達していたら何も書かずに投げる。

import { parseDocumentDetail } from "./documentRef.js";
import type { LevelsSnapshot } from "./levelsOps.js";

/** 無料プランの上限に達した。ツールの結果としてそのまま返す文（何も書いていない旨を含む）を持つ。 */
export class PlanLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanLimitError";
  }
}

export interface PlanGate {
  /** 自分のマップを1つ増やしてよいか。[currentMaps]は自分のマップの数。 */
  assertCanAddMap(currentMaps: number): Promise<void>;
  /** マップ（持ち主 [ownerUid]）に要素を [adding] 個足してよいか。共有マップは持ち主のプランで判定する。 */
  assertCanAddElements(ownerUid: string, currentElements: number, adding: number): Promise<void>;
  /** マップ（持ち主 [ownerUid]）に文書の要素を1つ足してよいか（要素も1つ増える）。 */
  assertCanAddDocument(ownerUid: string, currentElements: number, currentDocuments: number): Promise<void>;
}

/** そのマップの全要素の数（levels の全件の子の数）。 */
export function countElements(snapshot: LevelsSnapshot): number {
  let n = 0;
  for (const level of snapshot.values()) n += level.children.length;
  return n;
}

/** そのマップの文書の要素（mmmdoc://…）の数。 */
export function countDocumentElements(snapshot: LevelsSnapshot): number {
  let n = 0;
  for (const level of snapshot.values()) {
    for (const entry of level.children) if (parseDocumentDetail(entry.detail)) n++;
  }
  return n;
}
