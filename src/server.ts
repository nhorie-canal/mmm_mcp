import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerListMaps } from "./tools/listMaps.js";
import { registerListElements } from "./tools/listElements.js";
import { registerCreateMap } from "./tools/createMap.js";
import { registerAutoStructureThought } from "./tools/autoStructureThought.js";
import { registerUpdateTaskStatus } from "./tools/updateTaskStatus.js";
import { registerImportMarkdownContext } from "./tools/importMarkdownContext.js";
import { registerEditElement } from "./tools/editElement.js";
import { registerDeleteElements } from "./tools/deleteElements.js";
import { registerMoveElement } from "./tools/moveElement.js";

const server = new McpServer(
  {
    name: "matryoshka-mindmap",
    version: "0.1.0",
  },
  {
    instructions:
      "このサーバーはリアルタイム同期を行わない。各ツールは呼び出された瞬間の" +
      "Firestoreの状態を返すだけで、アプリ側でユーザーが直接行った変更は" +
      "自動的には通知されない。ユーザーから進捗や現在の状態を尋ねられたときは、" +
      "それ以前の会話で見た内容を記憶に頼って答えず、必ずlist_maps/list_elementsを" +
      "呼び直して最新の状態を確認してから答えること。",
  }
);

registerListMaps(server);
registerListElements(server);
registerCreateMap(server);
registerAutoStructureThought(server);
registerUpdateTaskStatus(server);
registerImportMarkdownContext(server);
registerEditElement(server);
registerDeleteElements(server);
registerMoveElement(server);

const transport = new StdioServerTransport();
await server.connect(transport);
