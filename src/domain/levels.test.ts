import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTreeFromLevels,
  type LevelChildEntry,
} from "./levels.js";

function entry(id: string, detail = id, done = false): LevelChildEntry {
  return { id, detail, done };
}

test("buildTreeFromLevels", async (t) => {
  await t.test("親子をchildren配列の順序どおりに展開する", () => {
    const levelsById = new Map([
      ["root", [entry("a"), entry("b")]],
      ["a", [entry("a1"), entry("a2")]],
    ]);
    const tree = buildTreeFromLevels(levelsById);
    assert.equal(tree.length, 2);
    assert.equal(tree[0].id, "a");
    assert.equal(tree[0].parentId, null);
    assert.equal(tree[0].children.length, 2);
    assert.equal(tree[0].children[0].id, "a1");
    assert.equal(tree[0].children[0].parentId, "a");
    assert.equal(tree[1].id, "b");
    assert.deepEqual(tree[1].children, []);
  });

  await t.test("循環参照があっても打ち切って無限ループにならない", () => {
    // a の子に b、b の子に a という不正なデータ(本来Firestore側では起きないが防御対象)。
    const levelsById = new Map([
      ["root", [entry("a")]],
      ["a", [entry("b")]],
      ["b", [entry("a")]],
    ]);
    const tree = buildTreeFromLevels(levelsById);
    assert.equal(tree.length, 1);
    assert.equal(tree[0].id, "a");
    assert.equal(tree[0].children[0].id, "b");
    // 2周目のaは祖先集合に引っかかり、それ以上展開しない(葉として打ち切り)。
    assert.equal(tree[0].children[0].children[0].id, "a");
    assert.deepEqual(tree[0].children[0].children[0].children, []);
  });
});
