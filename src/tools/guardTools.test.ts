import assert from "node:assert/strict";
import { test } from "node:test";
import { guardTools } from "./guardTools.js";

// tool だけを持つ手書きの偽 server
function fakeServer() {
  const registered = new Map<string, (...a: unknown[]) => Promise<unknown>>();
  return {
    registered,
    tool(...args: unknown[]) {
      registered.set(args[0] as string, args[args.length - 1] as (...a: unknown[]) => Promise<unknown>);
    },
  };
}

test("止まっているときは、元のハンドラを呼ばず案内を返す", async () => {
  const server = fakeServer();
  let called = 0;
  guardTools(server, { isDisabled: async () => true });
  server.tool("list_maps", "説明", {}, async () => {
    called++;
    return { content: [] };
  });
  const result = (await server.registered.get("list_maps")!({})) as { isError: boolean; content: Array<{ text: string }> };
  assert.equal(called, 0);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /https:\/\/mmm\.spheres\.jp\/mcp/);
});

test("動いているときは、引数をそのまま渡して元の結果を返す", async () => {
  const server = fakeServer();
  const seen: unknown[][] = [];
  guardTools(server, { isDisabled: async () => false });
  server.tool("list_elements", "説明", { mapId: "schema" }, async (...a: unknown[]) => {
    seen.push(a);
    return { content: [{ type: "text", text: "ok" }] };
  });
  const result = await server.registered.get("list_elements")!({ mapId: "m1" }, { extra: 1 });
  assert.deepEqual(seen, [[{ mapId: "m1" }, { extra: 1 }]]);
  assert.deepEqual(result, { content: [{ type: "text", text: "ok" }] });
});

test("包んだあとに登録したツールはすべて包まれる", async () => {
  const server = fakeServer();
  guardTools(server, { isDisabled: async () => true });
  for (const name of ["a", "b", "c"]) server.tool(name, "d", async () => ({ content: [] }));
  for (const name of ["a", "b", "c"]) {
    const r = (await server.registered.get(name)!()) as { isError: boolean };
    assert.equal(r.isError, true, name);
  }
});
