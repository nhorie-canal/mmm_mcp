import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContext } from "../mcpContext.js";
import { countElements, countDocumentElements } from "../domain/planGate.js";
import { ancestorDetailsInLevels, locateInLevels, readLevelsSnapshot } from "../domain/levelsOps.js";
import { assertCanEditMap, formatPath, headerPathOf, levelsPathOf, resolveMap } from "../domain/mapResolver.js";
import { buildDocumentCreateWrites, assertDocumentSize, MAX_DOCUMENT_BYTES } from "../domain/documentOps.js";
import { newDocId } from "../domain/idGen.js";

export function registerCreateDocument(server: McpServer): void {
  server.tool(
    "create_document",
    "マップに、Markdownの文書(MD文書)を新しく作る。指定した要素の子の末尾に、文書の要素を1つ足す" +
      "(parentElementIdを省略またはnullにすると、マップの最上位の末尾)。" +
      "作った文書の要素は、アプリでは書類のアイコンとタイトルで見える(タップすると整形した文書が開く。" +
      "```mermaid のブロックは図になる)。中身はread_documentで読める。" +
      "既存の文書の書き換えはupdate_documentを使う(これは新しく作るだけ)。" +
      `contentはMarkdown(UTF-8で${MAX_DOCUMENT_BYTES}バイトまで。超えると何も書かずにエラーを返す)。` +
      "titleを省略すると、contentの最初の見出し(# の行)、無ければ最初の行がタイトルになる。" +
      "追加先(parentElementId)はlist_elementsの結果を見て判断すること。",
    {
      mapId: z.string().describe("list_mapsで得たマップのID"),
      parentElementId: z
        .string()
        .nullable()
        .optional()
        .describe("この要素の内側(子)の末尾に足す。マップの最上位に足す場合はnullまたは省略"),
      content: z.string().describe("文書の中身(Markdown)"),
      title: z
        .string()
        .nullable()
        .optional()
        .describe("行に見せるタイトル。省略するとcontentの最初の見出しから決める"),
    },
    async ({ mapId, parentElementId, content, title }) => {
      assertDocumentSize(content);
      const { client, session, planGate } = getContext();
      const map = await resolveMap(client, session, mapId);
      assertCanEditMap(map, session);
      const levelsPath = levelsPathOf(map);
      const documentsPath = `${headerPathOf(map)}/documents`;
      const targetParentId = parentElementId ?? null;
      const documentId = newDocId();
      const elementId = newDocId();

      let result = { path: "", title: "" };
      await client.runOptimistic(async () => {
        const snapshot = await readLevelsSnapshot(client, levelsPath);
        if (targetParentId !== null && !locateInLevels(snapshot, targetParentId)) {
          throw new Error(
            `parentElementId(${targetParentId})がこのマップに見つかりません。list_elementsで確認してください。`
          );
        }
        // 無料プランの上限（リモート版だけ）。要素の数と、そのマップの文書の数で判定する
        await planGate?.assertCanAddDocument(map.ownerUid, countElements(snapshot), countDocumentElements(snapshot));
        const plan = buildDocumentCreateWrites(levelsPath, documentsPath, snapshot, {
          documentId,
          elementId,
          title: title ?? undefined,
          content,
          targetParentId,
          isTodo: map.header.isTodo,
          now: new Date(),
        });
        result = {
          path: formatPath(map.header.title, [...ancestorDetailsInLevels(snapshot, targetParentId), plan.title]),
          title: plan.title,
        };
        return plan.writes;
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ path: result.path, documentId, title: result.title }, null, 2),
          },
        ],
      };
    }
  );
}
