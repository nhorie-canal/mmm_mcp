// 文書(docs/md-document.md)を新しく作る書き込みの組み立て。
// 文書の中身(documents/{docId})と、親の子一覧(levels)への要素の追加を、
// 1回の commit にまとめる(別のドキュメントなので同じ commit でよい。
// 同じドキュメントへ2件書かない決まりは、levels 側が[buildLevelsAppendWrites]で守る)。
// タイトルの決め方は、アプリが保存時に決める規則(lib/document/document_ref.dart の
// documentTitleFromContent)と同じにする。

import type { FirestoreWrite } from "../firestore/restClient.js";
import { buildLevelsAppendWrites, buildLevelsPatchWrites, type LevelsSnapshot } from "./levelsOps.js";
import { DOCUMENT_SCHEME, parseDocumentDetail } from "./documentRef.js";
import type { ElementNode } from "./levels.js";

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

/** 木の中から、文書[documentId]を指す要素をすべて探す（合成などで同じ文書を指す要素が複数ありうる）。 */
export function findDocumentElements(
  tree: ElementNode[],
  documentId: string
): Array<{ elementId: string; title: string }> {
  const found: Array<{ elementId: string; title: string }> = [];
  const walk = (nodes: ElementNode[]) => {
    for (const node of nodes) {
      const ref = parseDocumentDetail(node.detail);
      if (ref && ref.documentId === documentId) found.push({ elementId: node.id, title: ref.title });
      walk(node.children);
    }
  };
  walk(tree);
  return found;
}

/**
 * 読んでから書くまでの間に文書が変わっていた。**リトライしてはいけない**（読み直した中身を
 * もとにしていない全文で上書きしてしまう）。呼び出し側のAIが read_document から読み直す。
 */
export class DocumentConflictError extends Error {
  constructor() {
    super(
      "文書は、read_documentで読んだあとに変更されています。何も書き込んでいません。" +
        "read_documentで読み直し、最新の中身をもとに直した全文と、新しいupdateTimeをbaseUpdateTimeに付けてやり直してください。"
    );
    this.name = "DocumentConflictError";
  }
}

export interface DocumentUpdateTarget {
  /** この文書を指す要素（通常は1つ）。 */
  elements: Array<{ elementId: string; title: string }>;
  /** 書き込みの前提にする updateTime（= baseUpdateTime）。 */
  updateTime: string;
}

/**
 * update_document の前に調べること。要素が無い・中身が無い・読んでから変わっている、のいずれかなら投げる。
 * [doc]は documents/{docId} を読んだ結果（無ければ null）。
 */
export function resolveDocumentUpdate(
  tree: ElementNode[],
  documentId: string,
  doc: { updateTime?: string } | null,
  baseUpdateTime: string
): DocumentUpdateTarget {
  const elements = findDocumentElements(tree, documentId);
  if (elements.length === 0) {
    throw new Error(
      `文書が見つかりません(documentId: ${documentId})。list_elementsで、文書の要素のdocument.documentIdを確認してください。`
    );
  }
  if (!doc) {
    throw new Error(
      `「${elements[0].title}」の中身がありません。別の版のアプリでマップを合成したときに切れた参照の可能性があります。` +
        "新しく作るにはcreate_documentを使ってください。"
    );
  }
  if (!doc.updateTime || doc.updateTime !== baseUpdateTime) throw new DocumentConflictError();
  return { elements, updateTime: doc.updateTime };
}

export interface DocumentUpdateInput {
  documentId: string;
  target: DocumentUpdateTarget;
  content: string;
  /** 引数で指定されたタイトル。省略または空なら、新しい中身から決める（アプリの保存と同じ）。 */
  title?: string;
  now: Date;
}

export interface DocumentUpdatePlan {
  writes: FirestoreWrite[];
  title: string;
  titleChanged: boolean;
}

/**
 * 既存の文書の中身を上書きする書き込み。アプリが保存時に行うのと同じく、タイトルは
 * 新しい中身（または引数）から決め直し、変わった要素だけ2行目を直す（同じ文書を指す要素が
 * 複数あれば全部）。文書の中身と levels は別のドキュメントなので1回の commit にまとめ、
 * 文書は読んだ updateTime を前提条件にする。
 */
export function buildDocumentUpdateWrites(
  levelsPath: string,
  documentsPath: string,
  snapshot: LevelsSnapshot,
  input: DocumentUpdateInput
): DocumentUpdatePlan {
  assertDocumentSize(input.content);
  const given = input.title === undefined ? "" : normalizeTitle(input.title);
  const title = given !== "" ? given : documentTitleFromContent(input.content);
  const stale = input.target.elements.filter((e) => e.title !== title);
  const writes: FirestoreWrite[] = [];
  if (stale.length > 0) {
    writes.push(
      ...buildLevelsPatchWrites(
        levelsPath,
        snapshot,
        stale.map((e) => ({ elementId: e.elementId, patch: { detail: encodeDocumentDetail(input.documentId, title) } }))
      ).writes
    );
  }
  writes.push({
    path: `${documentsPath}/${input.documentId}`,
    fields: { content: input.content, updatedAt: input.now },
    requireUpdateTime: input.target.updateTime,
  });
  return { writes, title, titleChanged: stale.length > 0 };
}
