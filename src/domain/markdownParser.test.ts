import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdownForImport, type MarkdownNode } from "./markdownParser.js";

function byId(nodes: MarkdownNode[], id: string): MarkdownNode {
  const found = nodes.find((n) => n.id === id);
  if (!found) throw new Error(`node not found: ${id}`);
  return found;
}
function byDetail(nodes: MarkdownNode[], detail: string): MarkdownNode {
  const found = nodes.find((n) => n.detail === detail);
  if (!found) throw new Error(`node not found: ${detail}`);
  return found;
}

test("parseMarkdownForImport", async (t) => {
  await t.test("インデントで親子・兄弟関係を組み立てる", () => {
    const markdown = ["- 親1", "  - 子1", "  - 子2", "- 親2"].join("\n");
    const { nodes } = parseMarkdownForImport(markdown, { headingsAsNodes: true });
    assert.equal(nodes.length, 4);

    const oya1 = byDetail(nodes, "親1");
    const ko1 = byDetail(nodes, "子1");
    const ko2 = byDetail(nodes, "子2");
    const oya2 = byDetail(nodes, "親2");

    assert.equal(oya1.parentId, null);
    assert.equal(oya1.childId, ko1.id);
    assert.equal(oya1.nextId, oya2.id);
    assert.equal(oya1.prevId, null);

    assert.equal(ko1.parentId, oya1.id);
    assert.equal(ko1.prevId, null);
    assert.equal(ko1.nextId, ko2.id);

    assert.equal(ko2.parentId, oya1.id);
    assert.equal(ko2.prevId, ko1.id);
    assert.equal(ko2.nextId, null);

    assert.equal(oya2.parentId, null);
    assert.equal(oya2.prevId, oya1.id);
    assert.equal(oya2.nextId, null);
  });

  await t.test("チェックボックス記法をdoneとhasCheckboxへ反映する", () => {
    const markdown = ["- [x] 完了済み", "- [ ] 未完了"].join("\n");
    const { nodes, hasCheckbox } = parseMarkdownForImport(markdown, { headingsAsNodes: true });
    assert.equal(hasCheckbox, true);
    assert.equal(byId(nodes, nodes[0].id).detail, "完了済み");
    assert.equal(nodes[0].done, true);
    assert.equal(nodes[1].detail, "未完了");
    assert.equal(nodes[1].done, false);
  });

  await t.test("headingsAsNodes: trueなら見出しも要素として取り込む", () => {
    const markdown = ["# タイトル", "- 項目"].join("\n");
    const { nodes, headingTitle } = parseMarkdownForImport(markdown, { headingsAsNodes: true });
    assert.equal(headingTitle, "タイトル");
    assert.equal(nodes.length, 2);
    const title = byDetail(nodes, "タイトル");
    const item = byDetail(nodes, "項目");
    assert.equal(item.parentId, title.id);
  });

  await t.test("headingsAsNodes: falseなら見出し行は要素にせず読み捨てる(headingTitleは検出する)", () => {
    const markdown = ["# タイトル", "- 項目"].join("\n");
    const { nodes, headingTitle } = parseMarkdownForImport(markdown, { headingsAsNodes: false });
    assert.equal(headingTitle, "タイトル");
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].detail, "項目");
  });

  await t.test("署名行(---)より後は読み捨てる", () => {
    const markdown = ["- 項目1", "---", "- 項目2"].join("\n");
    const { nodes } = parseMarkdownForImport(markdown, { headingsAsNodes: true });
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].detail, "項目1");
  });

  await t.test("リスト項目に続く非リスト行は本文へ連結する", () => {
    const markdown = ["- 項目", "  続きの文章"].join("\n");
    const { nodes } = parseMarkdownForImport(markdown, { headingsAsNodes: true });
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].detail, "項目\n続きの文章");
  });
});
