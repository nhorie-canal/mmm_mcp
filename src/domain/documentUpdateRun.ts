import type { FirestoreRestClient } from "../firestore/restClient.js";
import { buildDocumentUpdateWrites, resolveDocumentUpdate } from "./documentOps.js";
import { ancestorDetailsInLevels, elementTreeOf, readLevelsSnapshot } from "./levelsOps.js";
import { formatPath } from "./mapResolver.js";

type UpdateClient = Pick<FirestoreRestClient, "runOptimistic" | "getDocument" | "listDocuments">;

export interface UpdateDocumentParams {
  levelsPath: string;
  documentsPath: string;
  mapTitle: string;
  documentId: string;
  baseUpdateTime: string;
  content: string;
  title?: string;
  now?: Date;
}

/**
 * update_document の本体。levels 側の競合（他の編集が割り込んだ）は runOptimistic が読み直してやり直すが、
 * **文書が baseUpdateTime のあとに変わっていたら、読み直してもやり直さず DocumentConflictError で止まる**
 * （読み直した中身をもとにしていない全文で、アプリで保存された内容を上書きしないため）。
 */
export async function executeUpdateDocument(
  client: UpdateClient,
  p: UpdateDocumentParams
): Promise<{ path: string; title: string }> {
  let result = { path: "", title: "" };
  await client.runOptimistic(async () => {
    const snapshot = await readLevelsSnapshot(client as FirestoreRestClient, p.levelsPath);
    // 文書のidはパスに入るので、このマップの要素が指しているものだけを書き換える
    const doc = await client.getDocument(`${p.documentsPath}/${p.documentId}`);
    const target = resolveDocumentUpdate(elementTreeOf(snapshot), p.documentId, doc, p.baseUpdateTime);
    const plan = buildDocumentUpdateWrites(p.levelsPath, p.documentsPath, snapshot, {
      documentId: p.documentId,
      target,
      content: p.content,
      title: p.title,
      now: p.now ?? new Date(),
    });
    const chain = ancestorDetailsInLevels(snapshot, target.elements[0].elementId);
    chain[chain.length - 1] = plan.title;
    result = { path: formatPath(p.mapTitle, chain), title: plan.title };
    return plan.writes;
  });
  return result;
}
