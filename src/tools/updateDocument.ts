import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContext } from "../mcpContext.js";
import { assertCanEditMap, headerPathOf, levelsPathOf, resolveMap } from "../domain/mapResolver.js";
import { assertDocumentSize, MAX_DOCUMENT_BYTES } from "../domain/documentOps.js";
import { executeUpdateDocument } from "../domain/documentUpdateRun.js";

export function registerUpdateDocument(server: McpServer): void {
  server.tool(
    "update_document",
    "マップにあるMD文書(Markdown)の中身を、新しい中身で丸ごと上書きする(一部だけの差し替えはできない。" +
      "直す前にread_documentで今の中身を読み、直した全文をcontentに渡すこと)。" +
      "文書の要素の位置・日付・チェックは変わらない。文書を作り直して古い方を消す必要はない。" +
      "documentIdは、list_elementsが返す文書の要素のdocument.documentId。" +
      `contentはUTF-8で${MAX_DOCUMENT_BYTES}バイトまで(超えると何も書かずにエラーを返す)。` +
      "titleを省略すると、新しい中身の最初の見出し(# の行)、無ければ最初の行が行のタイトルになる。" +
      "baseUpdateTimeには、直前のread_documentが返したupdateTimeをそのまま渡す(必須)。" +
      "read_documentで読んだあとにアプリなどで文書が変わっていた場合は、何も書かずにエラーを返す" +
      "(自動ではやり直さない)ので、read_documentで読み直し、最新の中身をもとに直してやり直すこと。",
    {
      mapId: z.string().describe("list_mapsで得たマップのID"),
      documentId: z.string().describe("list_elementsで得た、文書の要素のdocument.documentId"),
      baseUpdateTime: z
        .string()
        .min(1)
        .describe("直前のread_documentが返したupdateTime。これと違えば(読んだあとに変更されていれば)書かずにエラー"),
      content: z.string().describe("書き換え後の文書の全文(Markdown)"),
      title: z
        .string()
        .nullable()
        .optional()
        .describe("行に見せるタイトル。省略するとcontentの最初の見出しから決める"),
    },
    async ({ mapId, documentId, baseUpdateTime, content, title }) => {
      assertDocumentSize(content);
      const { client, session } = getContext();
      const map = await resolveMap(client, session, mapId);
      assertCanEditMap(map, session);
      const levelsPath = levelsPathOf(map);
      const documentsPath = `${headerPathOf(map)}/documents`;

      const result = await executeUpdateDocument(client, {
        levelsPath,
        documentsPath,
        mapTitle: map.header.title,
        documentId,
        baseUpdateTime,
        content,
        title: title ?? undefined,
      });
      return {
        content: [
          { type: "text", text: JSON.stringify({ path: result.path, documentId, title: result.title }, null, 2) },
        ],
      };
    }
  );
}
