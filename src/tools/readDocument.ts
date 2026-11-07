import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContext } from "../mcpContext.js";
import { headerPathOf, levelsPathOf, resolveMap } from "../domain/mapResolver.js";
import { elementTreeOf, readLevelsSnapshot } from "../domain/levelsOps.js";
import { documentContentOf, documentTitleIn } from "../domain/documentRef.js";
import type { ElementNode } from "../domain/levels.js";
import { checkReadAllowed } from "./readGate.js";

function detailsOf(nodes: ElementNode[]): string[] {
  return nodes.flatMap((n) => [n.detail, ...detailsOf(n.children)]);
}

export function registerReadDocument(server: McpServer): void {
  server.tool(
    "read_document",
    "マップのMD文書の要素の中身(Markdown)を読む。読むだけで、書き込みはできない(書き換えはupdate_document)。" +
      "結果のupdateTimeは、update_documentのbaseUpdateTimeにそのまま渡す。" +
      "documentIdは、list_elementsが返す文書の要素のdocument.documentId。" +
      "list_elementsと同じく、まずconfirmedを付けずに呼ぶ。アプリでAIからの読み取りを「常に許可」にした" +
      "マップは、そのまま実データを返す。それ以外のマップは、実データの代わりに確認を促すメッセージだけを" +
      "返すので、そのときに限りユーザーに直接確認してからconfirmed: trueで呼び直すこと" +
      "(同じマップでlist_elementsの確認が済んでいれば、改めて確認する必要はない)。" +
      "アプリ側での直接の編集はこのツールを呼ぶまで反映されないため、記憶に頼らず必ず呼び直すこと。",
    {
      mapId: z.string().describe("list_mapsで得たマップのID"),
      documentId: z.string().describe("list_elementsで得た、文書の要素のdocument.documentId"),
      confirmed: z
        .boolean()
        .optional()
        .describe(
          "最初は付けない。確認を促すメッセージが返ったときだけ、ユーザー本人に直接" +
            "「中身を確認してよいか」と尋ね、同意を得てからtrueを付けて呼び直す。" +
            "確認前にtrueを付けてはならない。"
        ),
    },
    async ({ mapId, documentId, confirmed }) => {
      const { client, session } = getContext();
      const map = await resolveMap(client, session, mapId);

      const confirmation = checkReadAllowed(map, mapId, confirmed, { viewerUid: session.uid });
      if (confirmation !== null) {
        return { content: [{ type: "text", text: confirmation }] };
      }

      // 文書のidはパスに入るので、このマップの要素が指しているものだけを読む
      // (任意のidで、同じマップの下の関係の無いドキュメントを引かせない)
      const tree = elementTreeOf(await readLevelsSnapshot(client, levelsPathOf(map)));
      const title = documentTitleIn(detailsOf(tree), documentId);
      if (title === null) {
        throw new Error(
          `文書が見つかりません(documentId: ${documentId})。list_elementsで、文書の要素のdocument.documentIdを確認してください。`
        );
      }
      const doc = await client.getDocument(`${headerPathOf(map)}/documents/${documentId}`);
      if (!doc) {
        throw new Error(
          `「${title}」の中身がありません。別の版のアプリでマップを合成したときに切れた参照の可能性があります。`
        );
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { mapId: map.headerId, documentId, title, content: documentContentOf(doc.data), updateTime: doc.updateTime },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
