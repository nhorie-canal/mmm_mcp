// アプリの MD 文書の要素(docs/md-document.md §3.1)。要素の本文は
//   mmmdoc://{docId}
//   {タイトル}
// の2行で、中身は users/{uid}/headers/{headerId}/documents/{docId} の content にある。
// lib/document/document_ref.dart と同じ読み方にする。

export const DOCUMENT_SCHEME = "mmmdoc://";

export interface DocumentRef {
  documentId: string;
  title: string;
}

/** 要素の本文を文書への参照として読む。文書の要素でなければ(印が無い・idが壊れている)null。 */
export function parseDocumentDetail(detail: string): DocumentRef | null {
  if (!detail.startsWith(DOCUMENT_SCHEME)) return null;
  const lineEnd = detail.indexOf("\n");
  const head = lineEnd < 0 ? detail : detail.slice(0, lineEnd);
  const documentId = head.slice(DOCUMENT_SCHEME.length).trim();
  if (documentId === "" || /[\s/]/.test(documentId)) return null;
  const title = lineEnd < 0 ? "" : detail.slice(lineEnd + 1).trim();
  return { documentId, title };
}

/** 文書の中身(documents/{docId} のフィールド)から本文を取り出す。形が崩れていれば空文字。 */
export function documentContentOf(data: Record<string, unknown>): string {
  return typeof data.content === "string" ? data.content : "";
}

/** 要素の本文の一覧のうち、文書[documentId]を指すものからタイトルを探す。無ければ null。 */
export function documentTitleIn(details: Iterable<string>, documentId: string): string | null {
  for (const detail of details) {
    const ref = parseDocumentDetail(detail);
    if (ref && ref.documentId === documentId) return ref.title;
  }
  return null;
}
