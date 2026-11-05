// 文書(docs/md-document.md)を新しく作る書き込みの組み立て。
// 文書の中身(documents/{docId})と、親の子一覧(levels)への要素の追加を、
// 1回の commit にまとめる(別のドキュメントなので同じ commit でよい。
// 同じドキュメントへ2件書かない決まりは、levels 側が[buildLevelsAppendWrites]で守る)。
// タイトルの決め方は、アプリが保存時に決める規則(lib/document/document_ref.dart の
// documentTitleFromContent)と同じにする。

import type { FirestoreWrite } from "../firestore/restClient.js";
import { buildLevelsAppendWrites, type LevelsSnapshot } from "./levelsOps.js";
import { DOCUMENT_SCHEME } from "./documentRef.js";

/** 1文書の中身の上限(UTF-8のバイト数)。アプリの1ファイルの上限(1,000,000バイト)と同じ。 */
export const MAX_DOCUMENT_BYTES = 1_000_000;

/** タイトルの最大の長さ(文字数)。アプリと同じ。 */
const MAX_TITLE_CHARS = 60;

/** タイトルも見出しも無いときの名前。 */
export const UNTITLED_DOCUMENT = "無題の文書";

/** 上限を超えたときにClaudeへ返す説明。黙って切らない。 */
export function tooLargeDocumentMessage(bytes: number): string {
  return (
    `文書の中身が${bytes}バイトあり、上限(${MAX_DOCUMENT_BYTES}バイト)を超えています。` +
    `何も書き込んでいません。内容を分けて、複数の文書にしてください。`
  );
}

/** 中身の大きさを確かめる。超えていれば、何も書かずに済むよう例外を投げる。 */
export function assertDocumentSize(content: string): void {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_DOCUMENT_BYTES) throw new Error(tooLargeDocumentMessage(bytes));
}

function clip(s: string): string {
  const chars = Array.from(s);
  return chars.length <= MAX_TITLE_CHARS ? s : `${chars.slice(0, MAX_TITLE_CHARS).join("")}…`;
}

/** 文書の中身から付けるタイトル。最初の見出し(# の行)、無ければ最初の空でない行。無ければ[fallback]。 */
export function documentTitleFromContent(content: string, fallback = UNTITLED_DOCUMENT): string {
  let firstLine: string | null = null;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading && heading[1].trim() !== "") return clip(heading[1].trim());
    firstLine ??= line;
  }
  return firstLine === null ? fallback : clip(firstLine);
}

/** 引数のタイトルを要素の2行目に入れられる形にする(改行は空白へ、前後の空白は落とす、長いものは切る)。 */
export function normalizeTitle(title: string): string {
  return clip(title.replace(/[\r\n]+/g, " ").trim());
}

/** 文書の要素の本文。1行目は印と文書のid、2行目は行に見せるタイトル(docs/md-document.md §3.1)。 */
export function encodeDocumentDetail(documentId: string, title: string): string {
  return `${DOCUMENT_SCHEME}${documentId}\n${title}`;
}

export interface DocumentCreateInput {
  /** 文書のid(documents/{docId})。 */
  documentId: string;
  /** 文書の要素のid(levels の子のid)。文書のidとは別。 */
  elementId: string;
  /** 引数で指定されたタイトル。省略または空なら、中身から決める。 */
  title?: string;
  content: string;
  /** 足す先の親の要素のid。nullならマップの最上位。 */
  targetParentId: string | null;
  isTodo: boolean;
  now: Date;
}

export interface DocumentCreatePlan {
  writes: FirestoreWrite[];
  title: string;
}

/**
 * 文書を新しく作る書き込み。文書の中身(新規作成。既にあれば失敗)と、
 * [targetParentId]の子の末尾への文書の要素の追加を返す。
 * 親の存在確認は呼び出し側で済ませること。
 */
export function buildDocumentCreateWrites(
  levelsPath: string,
  documentsPath: string,
  snapshot: LevelsSnapshot,
  input: DocumentCreateInput
): DocumentCreatePlan {
  assertDocumentSize(input.content);
  const given = input.title === undefined ? "" : normalizeTitle(input.title);
  const title = given !== "" ? given : documentTitleFromContent(input.content);
  const levelWrites = buildLevelsAppendWrites(
    levelsPath,
    snapshot,
    [
      {
        id: input.elementId,
        detail: encodeDocumentDetail(input.documentId, title),
        done: false,
        parentId: input.targetParentId,
      },
    ],
    input.targetParentId,
    input.isTodo
  );
  const documentWrite: FirestoreWrite = {
    path: `${documentsPath}/${input.documentId}`,
    fields: { content: input.content, updatedAt: input.now },
    requireMissing: true,
  };
  return { writes: [...levelWrites, documentWrite], title };
}
