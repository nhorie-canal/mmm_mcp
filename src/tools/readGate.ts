import type { ResolvedMap } from "../domain/mapResolver.js";

// マップの中身には秘匿情報が含まれ得るため、実際の要素を返す前に必ず本人の
// 明示的な許可を得る。このサーバープロセスが生きている間(概ね1会話)、
// 同じマップへの確認は1回でよい。
//
// 当初はMCP標準のelicitInputで確認していたが、接続クライアントが対応を
// 広告していても実際にはダイアログを一切出さないまま失敗することがあり
// (2026-09-03、Claude Codeデスクトップアプリで確認)、本人が一度も確認画面を
// 見ないまま恒久的に読み取り不能になる不具合があった。ホストごとの
// elicitation対応状況に依存しない、呼び出し側(Claude等)への文面提示+
// confirmedパラメータの方式に一本化した。呼び出し側が実際にユーザーへ
// 確認したかをこちらで検証する手段は無いため、確実な強制ではなく
// ベストエフォートであることを理解した上で採用している。
const confirmedMaps = new Map<string, number>();

/**
 * 確認済みの印を覚える時間（既定はプロセスが生きている間）。サーバーは会話の区切りを知らないので、
 * mcp-remote が短い時間に設定し、利用者ごとに覚える。
 */
let confirmationTtlMs = Number.POSITIVE_INFINITY;
export function setConfirmationTtlMs(ms: number): void {
  confirmationTtlMs = ms;
}

export interface ReadGateOptions {
  /** 確認を覚える単位に使う利用者の uid（リモート版は利用者が混ざらないよう必ず渡す）。 */
  viewerUid?: string;
  now?: number;
}

function buildConfirmationRequestText(title: string): string {
  return (
    `「${title}」の中身を読み取る前に、ユーザー本人に直接「中身を確認してよいか」と` +
    "尋ねてください。まだ実データは返していません。同意が得られたら、confirmed: true を" +
    "付けてこのツールを再度呼び出してください。"
  );
}

class AiReadDeniedError extends Error {
  constructor(title: string) {
    super(
      `「${title}」はAIからの読み取りが「常に拒否」に設定されているため、このツールでは読めません。` +
        "読む必要がある場合は、アプリのマップ編集画面で設定を変更するようユーザーに伝えてください。"
    );
    this.name = "AiReadDeniedError";
  }
}


/**
 * マップの中身を読む前の本人の許可(list_elements と read_document で共通)。
 * 読んでよければ null、確認が要るときは返すべき確認の文面を返す。
 * 「常に拒否」のマップは投げる。確認済みの印は同じサーバープロセスの間、マップ単位で共有する。
 */
export function checkReadAllowed(
  map: ResolvedMap,
  mapId: string,
  confirmed: boolean | undefined,
  { viewerUid = "", now = Date.now() }: ReadGateOptions = {}
): string | null {
  const key = `${viewerUid}:${mapId}`;
  const at = confirmedMaps.get(key);
  const isConfirmed = at !== undefined && now - at < confirmationTtlMs;
  // マップ単位のAI読み取り許可(aiReadPermission)。このフィールドは
  // アプリのマップ編集画面からのみ変更でき、MCPサーバーのどの
  // ツールからも書き込まない(AIが自分自身に許可を与えられると
  // 確認の仕組みが意味を失うため)。
  if (map.header.aiReadPermission === "deny") {
    throw new AiReadDeniedError(map.header.title);
  }
  const alwaysAllowed = map.header.aiReadPermission === "allow";
  if (!alwaysAllowed && !isConfirmed) {
    if (confirmed === true) {
      // 期限のある設定（リモート版）では、期限切れの印を捨てて増え続けないようにする
    if (Number.isFinite(confirmationTtlMs)) {
      for (const [k, at] of confirmedMaps) if (now - at >= confirmationTtlMs) confirmedMaps.delete(k);
    }
    confirmedMaps.set(key, now);
    } else {
      return buildConfirmationRequestText(map.header.title);
    }
  }
  return null;
}
