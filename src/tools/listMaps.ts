import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContext } from "../mcpContext.js";
import { canEditHeader, headerFromFirestore } from "../domain/header.js";

export function registerListMaps(server: McpServer): void {
  server.tool(
    "list_maps",
    "自分のMatryoshka Mind Mapの全マップ(タイトル・ID・TODOかどうか)を返す。" +
      "他のツールでmapIdを指定する前に、まずこれで存在するマップとそのIDを確認する。" +
      "自分が所有するマップに加え、他のユーザーから共有されて見えているマップも含む" +
      "(共有マップのroleが'viewer'の場合は閲覧のみで、書き込み系ツールは使えない)。" +
      "アプリ側での直接の編集(新規マップ作成等)はこのツールを呼ぶまで反映されないため、" +
      "ユーザーから状態を尋ねられたときは記憶に頼らず必ず呼び直すこと。",
    {},
    async () => {
      const { client, session } = getContext();

      const own = await client.listDocuments(`users/${session.uid}/headers`);
      const ownMaps = own.map((doc) => {
        const header = headerFromFirestore(doc.id, session.uid, doc.data);
        return {
          id: header.id,
          title: header.title,
          isTodo: header.isTodo,
          shared: false as const,
        };
      });

      const refs = await client.listDocuments(`users/${session.uid}/refs`);
      const sharedMaps = (
        await Promise.all(
          refs.map(async (ref) => {
            const ownerUid = ref.data.userId;
            const headerId = ref.data.headerId;
            if (typeof ownerUid !== "string" || typeof headerId !== "string") {
              return null; // 壊れたrefsは無視する
            }
            const doc = await client.getDocument(`users/${ownerUid}/headers/${headerId}`);
            if (!doc) return null; // 共有元で削除済み
            const header = headerFromFirestore(headerId, ownerUid, doc.data);
            const ownerDoc = await client.getDocument(`users/${ownerUid}`);
            return {
              id: header.id,
              title: header.title,
              isTodo: header.isTodo,
              shared: true as const,
              role: canEditHeader(header, session.uid, session.email) ? ("editor" as const) : ("viewer" as const),
              ownerEmail: (ownerDoc?.data.email as string | undefined) ?? null,
            };
          })
        )
      ).filter((m): m is NonNullable<typeof m> => m !== null);

      const maps = [...ownMaps, ...sharedMaps];
      return {
        content: [{ type: "text", text: JSON.stringify({ maps }, null, 2) }],
      };
    }
  );
}
