import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseFrames, buildHtml, main } from "../scripts/viz.mjs";
import { freshHome } from "./helpers.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAYER = fs.readFileSync(path.join(ROOT, "assets", "player.html"), "utf8");
const HAS_JAVA = spawnSync("java", ["-version"]).status === 0;

const DEMO = `public class Demo {
    static class TreeNode { int val; TreeNode left, right; TreeNode(int v) { val = v; } }
    public static void main(String[] args) {
        int[] nums = {2, 7, 11, 15};
        int l = 0, r = nums.length - 1;
        while (l < r) {
            T.frame("比较两端", T.range("nums", nums, l, r, "L", l, "R", r), T.vars("sum", nums[l] + nums[r])); // @mark
            if (nums[l] + nums[r] > 9) r--; else break;
        }
        TreeNode root = new TreeNode(1);
        root.left = new TreeNode(2);
        T.frame("树", T.tree("root", root, root.left));
        java.util.ArrayDeque<String> st = new java.util.ArrayDeque<>();
        st.push("f(3)");
        st.push("f(2)");
        T.frame("栈和表", T.stack("calls", st), T.grid("dp", new int[][] {{1, 2}, {3, 4}}, 1, 0));
    }
}
`;

test("parseFrames 分出轨迹帧和普通输出", () => {
  const { frames, output } = parseFrames('hello\n@@T {"line":3,"note":"a","views":[]}\r\n\n');
  assert.deepEqual(frames, [{ line: 3, note: "a", views: [] }]);
  assert.deepEqual(output, ["hello"]);
});

test("buildHtml 嵌入数据并转义，不引用外部资源", () => {
  const html = buildHtml(PLAYER, { title: "3. <无重复>", code: "class A {}", frames: [{ line: 1, note: "</script>$&", views: [] }] });
  assert.match(html, /<title>3\. &lt;无重复&gt;<\/title>/);
  assert.ok(html.includes("\\u003c/script>$&"));
  assert.ok(!html.includes("/*__LC_DATA__*/null"));
  assert.doesNotMatch(html, /(src|href)="https?:/);
});

test("运行 Java 演示程序，记录数组、变量、树、栈和表", { skip: !HAS_JAVA && "本机没有 java" }, () => {
  freshHome();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-viz-test-"));
  const src = path.join(dir, "Demo.java");
  fs.writeFileSync(src, DEMO);
  const out = path.join(dir, "out", "demo.html");
  const r = main([src, "--out", out, "--title", "演示"]);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.data.frames, 5);

  const html = fs.readFileSync(out, "utf8");
  const data = JSON.parse(/const DATA = (.*);\n/.exec(html)[1]);
  const markLine = DEMO.split("\n").findIndex((s) => s.includes("// @mark")) + 1;
  const [f0, , f2, f3, f4] = data.frames;

  assert.equal(data.title, "演示");
  assert.equal(data.code, DEMO);
  assert.equal(f0.line, markLine);
  assert.equal(f0.note, "比较两端");
  assert.equal(f0.views[0].kind, "array");
  assert.deepEqual(f0.views[0].items, [2, 7, 11, 15]);
  assert.deepEqual(f0.views[0].range, [0, 3]);
  assert.deepEqual(f0.views[0].marks, { L: 0, R: 3 });
  assert.deepEqual(f0.views[1], { values: { sum: 17 }, kind: "vars", name: "变量" });
  assert.equal(f2.views[1].values.sum, 9);

  const tree = f3.views[0];
  assert.equal(tree.kind, "tree");
  assert.equal(tree.root.val, 1);
  assert.equal(tree.root.left.val, 2);
  assert.equal(tree.root.right, null);
  assert.deepEqual(tree.hl, [tree.root.left.id]);

  assert.deepEqual(f4.views[0].items, ["f(2)", "f(3)"]);
  assert.deepEqual(f4.views[1].cells, [[1, 2], [3, 4]]);
  assert.deepEqual(f4.views[1].cur, [1, 0]);
});

test("没有调用 T.frame 时报 no_frames；编译失败时报 java_failed", { skip: !HAS_JAVA && "本机没有 java" }, () => {
  freshHome();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lc-viz-test-"));
  const empty = path.join(dir, "Empty.java");
  fs.writeFileSync(empty, "public class Empty { public static void main(String[] a) { System.out.println(1); } }");
  assert.equal(main([empty, "--out", path.join(dir, "e.html")]).error.code, "no_frames");
  const broken = path.join(dir, "Broken.java");
  fs.writeFileSync(broken, "public class Broken { public static void main(String[] a) { int x = } }");
  assert.equal(main([broken, "--out", path.join(dir, "b.html")]).error.code, "java_failed");
});

test("缺少 --out 时返回用法", () => {
  assert.equal(main(["Demo.java"]).error.code, "usage");
});
