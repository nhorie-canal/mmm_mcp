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
  await t.test("段を飛ばした字下げでも、親も前の兄弟も無い要素を作らない", () => {
    const outline = (markdown: string): string[] => {
      const { nodes } = parseMarkdownForImport(markdown, { headingsAsNodes: true });
      const heads = nodes.filter((n) => n.parentId === null && n.prevId === null);
      assert.equal(heads.length, 1, `最上位の先頭が1つではない: ${markdown}`);
      const lines: string[] = [];
      const walk = (id: string | null, depth: number) => {
        while (id !== null) {
          const n = byId(nodes, id);
          lines.push("  ".repeat(depth) + n.detail);
          walk(n.childId, depth + 1);
          id = n.nextId;
        }
      };
      walk(heads[0].id, 0);
      assert.equal(lines.length, nodes.length, `辿れない要素がある: ${markdown}`);
      return lines;
    };

    // 字下げ 0・4・2。b は a の子、c は b の弟になる。
    assert.deepEqual(outline("- a\n    - b\n  - c"), ["a", "  b", "  c"]);
    // 最初の行だけ深い。a と b はどちらも最上位に並ぶ。
    assert.deepEqual(outline("  - a\n- b"), ["a", "b"]);
    // 見出しの直下のリストは、段が飛んでもその見出しの子になる。
    assert.deepEqual(outline("# 題\n- a\n## 小\n- b"), ["題", "  a", "  小", "    b"]);
    assert.deepEqual(outline("# A\n## B\n- x\n# C\n- y"), ["A", "  B", "    x", "C", "  y"]);
  });
});

test("parseMarkdownForImport: 期日(📅)・着手日(🛫)", async (t) => {
  process.env.TZ = "Asia/Tokyo";
  const parse = (text: string) => parseMarkdownForImport(text, { headingsAsNodes: true }).nodes;

  await t.test("Obsidian Tasks の書き方を日付として読み、本文から取り除く", () => {
    const [node] = parse("- [ ] 企画書を書く 🛫 2026-10-12 📅 2026-10-15");
    assert.equal(node.detail, "企画書を書く");
    assert.deepEqual(node.schedule, {
      start: { at: new Date("2026-10-12T00:00:00Z"), allDay: true },
      due: { at: new Date("2026-10-15T00:00:00Z"), allDay: true },
    });
  });

  await t.test("時刻付きの期日は、日付のあとの時刻を PC の現地時刻として読む", () => {
    const [node] = parse("- 会議 📅 2026-10-15 09:00");
    assert.equal(node.detail, "会議");
    assert.deepEqual(node.schedule, { due: { at: new Date("2026-10-15T00:00:00Z"), allDay: false } });
  });

  await t.test("日付の無い要素には schedule を付けない", () => {
    assert.equal(parse("- 買い物")[0].schedule, undefined);
  });

  await t.test("読めない日付は本文に残す", () => {
    const [node] = parse("- 予定 📅 2026-02-30");
    assert.equal(node.detail, "予定 📅 2026-02-30");
    assert.equal(node.schedule, undefined);
  });

  await t.test("継続行の中の印は日付として読まない", () => {
    const [node] = parse("- メモ\n  📅 2026-10-15 と書いておく");
    assert.equal(node.detail, "メモ\n📅 2026-10-15 と書いておく");
    assert.equal(node.schedule, undefined);
  });
});

// IDは毎回変わるので、親・前後・子を並びの位置に置き換えて比べる。
function outline(nodes: MarkdownNode[]) {
  const indexOf = (id: string | null) => (id === null ? null : nodes.findIndex((n) => n.id === id));
  return nodes.map((n) => ({
    detail: n.detail,
    rawIndent: n.rawIndent,
    done: n.done,
    parent: indexOf(n.parentId),
    prev: indexOf(n.prevId),
    next: indexOf(n.nextId),
    child: indexOf(n.childId),
    schedule: n.schedule,
  }));
}

test("parseMarkdownForImport の改行コード", async (t) => {
  const lf = "# 見出し\n\n- [x] a 📅 2026-05-01\n  - [ ] a1\n    2行目\n- [ ] b\n\n---\n- 署名\n";

  for (const [name, eol] of [
    ["CRLF", "\r\n"],
    ["CR だけ(古い Mac の形式)", "\r"],
  ] as const) {
    await t.test(`${name} の改行でも、LF と同じ構造・チェック・見出し・日付で取り込む`, () => {
      for (const headingsAsNodes of [true, false]) {
        const expected = parseMarkdownForImport(lf, { headingsAsNodes });
        const actual = parseMarkdownForImport(lf.replace(/\n/g, eol), { headingsAsNodes });
        assert.equal(actual.headingTitle, "見出し");
        assert.equal(actual.hasCheckbox, expected.hasCheckbox);
        assert.deepEqual(outline(actual.nodes), outline(expected.nodes));
      }
      const { nodes } = parseMarkdownForImport(lf.replace(/\n/g, eol), { headingsAsNodes: false });
      assert.deepEqual(
        nodes.map((n) => n.detail),
        ["a", "a1\n2行目", "b"]
      );
    });
  }
});
