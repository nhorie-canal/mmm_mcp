/**
 * 1要素の本文の上限(UTF-16の単位、JavaScriptのlength)。子の一覧は1ドキュメントに
 * 入るため、巨大な書き込み1回でドキュメントの上限1MiBを超えないようにする。
 * アプリの lib/domain/detail_limit.dart と同じ値にする。決めごとは docs/paid-plan.md §7。
 */
export const MAX_DETAIL_LENGTH = 5000;

/** 上限を超えたときにClaudeへ返す説明。黙って切らず、分けて書き直してもらう。 */
export function tooLongDetailMessage(length: number): string {
  return (
    `要素の本文が${length}文字あり、1要素の上限(${MAX_DETAIL_LENGTH}文字)を超えています。` +
    `何も書き込んでいません。複数の要素に分けて書き直してください。`
  );
}

/** [details]のうち上限を超えるものがあれば、何も書かずに済むよう例外を投げる。 */
export function assertDetailLengths(details: Iterable<string>): void {
  for (const detail of details) {
    if (detail.length > MAX_DETAIL_LENGTH) throw new Error(tooLongDetailMessage(detail.length));
  }
}
