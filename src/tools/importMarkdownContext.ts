import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContext } from "../mcpContext.js";
import {
  resolveMap,
  bodiesPathOf,
  levelsPathOf,
  formatPath,
  assertCanEditMap,
} from "../domain/mapResolver.js";
import { bodyFromFirestore, ancestorDetails } from "../domain/body.js";
import { buildAppendWrites } from "../domain/appendForest.js";
import { parseMarkdownForImport } from "../domain/markdownParser.js";
import { assertLevelsRootExists, buildAppendLevelWrites, levelsDocExists } from "../domain/levels.js";

export function registerImportMarkdownContext(server: McpServer): void {
  server.tool(
    "import_markdown_context",
    "任意の深さのMarkdown(インデントで階層を表現したリスト、見出しは`#`)を組み立てて、" +
      "既存のマップに流し込む。見出しも1つの要素として取り込む。" +
      "取り込み先がTODOマップでない場合、`- [ ]`/`- [x]`のチェックボックス記法は取り除かれ" +
      "チェック状態も反映されない(アプリ本体の挙動と同じ)。" +
      "対象は既存マップのみ(新規作成が必要ならcreate_mapを先に呼ぶ)。",
    {
      mapId: z.string().describe("list_mapsで得たマップのID"),
      markdown: z.string().min(1).describe("取り込むMarkdownテキスト"),
      parentElementId: z
        .string()
        .nullable()
        .optional()
        .describe("この要素の内側(子)として取り込む。マップの最上位に取り込む場合はnullまたは省略"),
    },
    async ({ mapId, markdown, parentElementId }) => {
      const { client, session } = getContext();
      const map = await resolveMap(client, session, mapId);
      assertCanEditMap(map, session);
      const levelsPath = levelsPathOf(map);
      const bodiesPath = bodiesPathOf(map);
      const targetParentId = parentElementId ?? null;

      const parsed = parseMarkdownForImport(markdown, { headingsAsNodes: true });
      if (parsed.nodes.length === 0) {
        throw new Error("Markdownからリスト項目・見出しが見つかりませんでした。");
      }

      // 読み取り(bodies一覧・levels存在確認)から書き込みまでを楽観的
      // ロックでまとめる。読み取り後に対象ドキュメントが他から変更される
      // とコミットがFAILED_PRECONDITIONになり、読み取りからやり直す。
      let createdIds: string[] = [];
      let existingBodiesForPath: ReturnType<typeof bodyFromFirestore>[] = [];
      await client.runOptimistic(async () => {
        assertLevelsRootExists(await levelsDocExists(client, levelsPath, "root"), map.header.title);
        const existingDocs = await client.listDocuments(bodiesPath);
        const existingBodies = existingDocs.map((d) => bodyFromFirestore(d.id, d.data, d.updateTime));
        existingBodiesForPath = existingBodies;

        if (targetParentId !== null && !existingBodies.some((b) => b.id === targetParentId)) {
          throw new Error(
            `parentElementId(${targetParentId})がこのマップに見つかりません。list_elementsで確認してください。`
          );
        }
        const { writes, createdIds: ids } = buildAppendWrites(
          bodiesPath,
          existingBodies,
          parsed.nodes,
          targetParentId,
          map.header.isTodo
        );
        createdIds = ids;
        // 挿入先のlevelsドキュメントが実際に存在するかを直接確認する
        // (bodies側の状態から推測すると、levelsとbodiesが食い違っている
        // 場合にarrayUnion書き込みが「ドキュメントが無い」で失敗しうるため)。
        const targetLevelId = targetParentId ?? "root";
        const targetHasLevelsDoc =
          targetLevelId === "root" || (await levelsDocExists(client, levelsPath, targetLevelId));
        const levelWrites = buildAppendLevelWrites(
          levelsPath,
          parsed.nodes,
          targetParentId,
          targetHasLevelsDoc,
          map.header.isTodo
        );
        return [...writes, ...levelWrites];
      });

      const path = formatPath(map.header.title, ancestorDetails(existingBodiesForPath, targetParentId));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                path,
                addedElementCount: createdIds.length,
                checkboxIgnored: !map.header.isTodo && parsed.hasCheckbox,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
