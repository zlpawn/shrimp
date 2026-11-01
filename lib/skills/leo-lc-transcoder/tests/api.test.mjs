import test from "node:test";
import assert from "node:assert/strict";
import { createApi, parseJudge, decodeContent, javaBlocks } from "../scripts/sites/leetcode-com/api.mjs";
import * as F from "./fixtures.mjs";

const CREDS = { LEETCODE_SESSION: "sess", csrftoken: "csrf" };
const CHECK_PATH = (id) => `GET /submissions/detail/${id}/check/`;

// 按 "方法 路径" 路由；GraphQL 请求按查询名路由为 "GQL 查询名"。
// 每个路由是响应队列，最后一个响应会被重复使用。
function setup(routes, deps = {}) {
  const calls = [];
  const sleeps = [];
  async function fetchImpl(url, init = {}) {
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    let key = `${method} ${new URL(url).pathname}`;
    if (key === "POST /graphql/") key = `GQL ${/query (\w+)/.exec(body.query)[1]}`;
    calls.push({ key, url, init, body });
    const queue = routes[key];
    if (!queue) throw new Error(`unexpected request ${key}`);
    const r = queue.length > 1 ? queue.shift() : queue[0];
    const status = r.status ?? 200;
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
    };
  }
  const api = createApi(CREDS, { fetchImpl, sleep: async (ms) => sleeps.push(ms), ...deps });
  return { api, calls, sleeps };
}

test("search 解析题目列表，并带上 cookie 和 csrf 请求头", async () => {
  const { api, calls } = setup({ "GQL search": [{ body: F.SEARCH_3 }] });
  const list = await api.search("3");
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], {
    id: "3",
    title: "Longest Substring Without Repeating Characters",
    slug: "longest-substring-without-repeating-characters",
    difficulty: "MEDIUM",
    paidOnly: false,
    status: "SOLVED",
    tags: ["hash-table", "string", "sliding-window"],
  });
  assert.equal(calls[0].body.variables.searchKeyword, "3");
  assert.match(calls[0].init.headers.cookie, /LEETCODE_SESSION=sess; csrftoken=csrf/);
  assert.equal(calls[0].init.headers["x-csrftoken"], "csrf");
});

test("show 按题号精确匹配 slug，并解析图片、模板和 metaData", async () => {
  const { api, calls } = setup({ "GQL search": [{ body: F.SEARCH_206 }], "GQL question": [{ body: F.QUESTION_206 }] });
  const q = await api.show("206");
  assert.equal(calls[1].body.variables.titleSlug, "reverse-linked-list");
  assert.equal(q.id, "206");
  assert.equal(q.url, "https://leetcode.com/problems/reverse-linked-list/");
  assert.deepEqual(q.images, [
    "https://assets.leetcode.com/uploads/2021/02/19/rev1ex1.jpg",
    "https://assets.leetcode.com/uploads/2021/02/19/rev1ex2.jpg",
  ]);
  assert.ok(q.javaTemplate.startsWith("class Solution {\n    public ListNode reverseList"));
  assert.equal(q.metaData.name, "reverseList");
  assert.deepEqual(q.exampleTestcases, ["[1,2,3,4,5]", "[1,2]", "[]"]);
  assert.deepEqual(q.tags, ["linked-list", "recursion"]);
});

test("show 传 slug 时不再搜索；会员题报 paid_only", async () => {
  const { api, calls } = setup({ "GQL question": [{ body: F.QUESTION_PAID }] });
  await assert.rejects(api.show("check-if-a-number-is-majority-element-in-a-sorted-array"), { code: "paid_only" });
  assert.equal(calls.length, 1);
});

test("run 默认用示例用例，轮询到结果；答案错误时改写为 Wrong Answer", async () => {
  const { api, calls, sleeps } = setup({
    "GQL question": [{ body: F.QUESTION_206 }],
    "POST /problems/reverse-linked-list/interpret_solution/": [{ body: F.INTERPRET }],
    [CHECK_PATH(F.INTERPRET.interpret_id)]: [{ body: F.CHECK_PENDING }, { body: F.CHECK_RUN_WRONG }],
  });
  const r = await api.run("reverse-linked-list", "class Solution {}");
  const post = calls.find((c) => c.key.endsWith("/interpret_solution/"));
  assert.deepEqual(post.body, {
    lang: "java",
    question_id: "206",
    typed_code: "class Solution {}",
    data_input: "[1,2,3,4,5]\n[1,2]\n[]",
  });
  assert.equal(post.init.headers.referer, "https://leetcode.com/problems/reverse-linked-list/");
  assert.equal(r.kind, "run");
  assert.equal(r.status, "Wrong Answer");
  assert.equal(r.passed, false);
  assert.deepEqual(r.output, ["[0,1]"]);
  assert.deepEqual(r.expected, ["[1,2]"]);
  assert.deepEqual(r.stdout, []);
  assert.equal(sleeps.length, 2);
});

test("run 使用自定义输入；编译错误时返回完整报错", async () => {
  const { api, calls } = setup({
    "GQL question": [{ body: F.QUESTION_206 }],
    "POST /problems/reverse-linked-list/interpret_solution/": [{ body: F.INTERPRET }],
    [CHECK_PATH(F.INTERPRET.interpret_id)]: [{ body: F.CHECK_RUN_COMPILE_ERROR }],
  });
  const r = await api.run("reverse-linked-list", "x", "[1]");
  assert.equal(calls.find((c) => c.key.endsWith("/interpret_solution/")).body.data_input, "[1]");
  assert.equal(r.status, "Compile Error");
  assert.equal(r.passed, false);
  assert.match(r.compileError, /';' expected/);
});

test("parseJudge：运行时错误带出完整报错", () => {
  const r = parseJudge(F.CHECK_RUN_RUNTIME_ERROR, "run");
  assert.equal(r.status, "Runtime Error");
  assert.equal(r.passed, false);
  assert.match(r.runtimeError, /NullPointerException[\s\S]*Solution\.reverseList/);
  assert.equal(r.compileError, null);
});

test("parseJudge：运行通过", () => {
  const r = parseJudge(F.CHECK_RUN_OK, "run");
  assert.equal(r.status, "Accepted");
  assert.equal(r.passed, true);
  assert.deepEqual(r.output, ["[0,1]", "[1,2]"]);
});

test("submit 不带 data_input，答案错误时给出失败用例", async () => {
  const { api, calls } = setup({
    "GQL question": [{ body: F.QUESTION_206 }],
    "POST /problems/reverse-linked-list/submit/": [{ body: F.SUBMIT }],
    [CHECK_PATH(F.SUBMIT.submission_id)]: [{ body: F.CHECK_SUBMIT_WRONG }],
  });
  const r = await api.submit("reverse-linked-list", "class Solution {}");
  const post = calls.find((c) => c.key.endsWith("/submit/"));
  assert.equal("data_input" in post.body, false);
  assert.equal(r.kind, "submit");
  assert.equal(r.status, "Wrong Answer");
  assert.equal(r.passed, false);
  assert.equal(r.totalCorrect, 38);
  assert.equal(r.totalTestcases, 66);
  assert.equal(r.lastTestcase, "[3,2,4]\n6");
  assert.equal(r.output, "[0,1]");
  assert.equal(r.expected, "[1,2]");
});

test("parseJudge：提交通过", () => {
  const r = parseJudge(F.CHECK_SUBMIT_OK, "submit");
  assert.equal(r.passed, true);
  assert.equal(r.runtimePercentile, 99.4165);
  assert.equal(r.lastTestcase, null);
});

test("403 视为登录失效", async () => {
  const { api } = setup({ "GQL search": [{ status: 403, body: "<!DOCTYPE html><title>Just a moment...</title>" }] });
  await assert.rejects(api.search("1"), { code: "auth" });
});

test("返回 HTML 时等待后重试", async () => {
  const { api, sleeps } = setup({ "GQL search": [{ body: "<!DOCTYPE html>" }, { body: F.SEARCH_3 }] });
  assert.equal((await api.search("3")).length, 2);
  assert.deepEqual(sleeps, [5000]);
});

test("连续 3 次返回异常后报 bad_response；429 报 rate_limited", async () => {
  const html = setup({ "GQL search": [{ body: "<!DOCTYPE html>" }] });
  await assert.rejects(html.api.search("3"), { code: "bad_response" });
  assert.equal(html.calls.length, 3);
  const limited = setup({ "GQL search": [{ status: 429, body: "slow down" }] });
  await assert.rejects(limited.api.search("3"), { code: "rate_limited" });
});

test("GraphQL 返回 errors 时报 graphql", async () => {
  const { api } = setup({ "GQL search": [{ body: { errors: [{ message: "bad field" }] } }] });
  await assert.rejects(api.search("3"), { code: "graphql", message: "bad field" });
});

test("判题一直 PENDING 时报 judge_timeout", async () => {
  const { api } = setup(
    {
      "GQL question": [{ body: F.QUESTION_206 }],
      "POST /problems/reverse-linked-list/submit/": [{ body: F.SUBMIT }],
      [CHECK_PATH(F.SUBMIT.submission_id)]: [{ body: F.CHECK_PENDING }],
    },
    { maxPolls: 3 },
  );
  await assert.rejects(api.submit("reverse-linked-list", "x"), { code: "judge_timeout" });
});

test("solutions 按票数取 Java 题解，解码正文并抽出 Java 代码", async () => {
  const { api, calls } = setup({
    "GQL solutions": [{ body: F.SOLUTIONS_TWO_SUM }],
    "GQL solution": [{ body: F.SOLUTION_DETAIL_1 }, { body: F.SOLUTION_DETAIL_2 }],
  });
  const list = await api.solutions("two-sum", 2);
  assert.deepEqual(calls[0].body.variables, { questionSlug: "two-sum", orderBy: "MOST_VOTES", tagSlugs: ["java"], first: 2, skip: 0 });
  assert.equal(calls[1].body.variables.topicId, "3619262");
  assert.equal(list[0].upvotes, 12288);
  assert.equal(list[0].author, "rahulvarma5297");
  assert.equal(list[0].url, "https://leetcode.com/problems/two-sum/solutions/3619262/3-methods-c-java-python-beginner-friendl-x595/");
  assert.ok(list[0].content.includes("\n```Java []\n"));
  assert.deepEqual(list[0].javaCode, ["class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        return new int[]{};\n    }\n}"]);
  assert.deepEqual(list[1].javaCode, ["class Solution {}"]);
});

test("decodeContent 只解码转义过的正文", () => {
  assert.equal(decodeContent("a\\nb"), "a\nb");
  assert.equal(decodeContent("a\nb \\n"), "a\nb \\n");
  assert.deepEqual(javaBlocks("```python\nx\n```\n```JAVA []\ny\n```"), ["y"]);
});

// 2026-11-01 真实题解（3. 无重复字符的最长子串）里出现的写法：\' 不是合法 JSON 转义，双引号也没转义
test("decodeContent 处理 \\' 和未转义的双引号", () => {
  assert.equal(decodeContent(`let\\'s say "A"\\nnext`), `let's say "A"\nnext`);
  assert.equal(decodeContent("path \\\\n stays\\n"), "path \\n stays\n");
  assert.equal(decodeContent("\\u00e9\\n"), "é\n");
});

test("javaBlocks 识别没标语言、但内容是 Java 的代码块", () => {
  const md = [
    "**Java**",
    "```",
    "class Solution {",
    "    public int lengthOfLongestSubstring(String s) {",
    "        return 0;",
    "    }",
    "}",
    "```",
    "**C++**",
    "```",
    "class Solution {",
    "public:",
    "    int lengthOfLongestSubstring(string s) { return 0; }",
    "};",
    "```",
    "```",
    "while (j < n) {}",
    "```",
  ].join("\n");
  assert.deepEqual(javaBlocks(md), ["class Solution {\n    public int lengthOfLongestSubstring(String s) {\n        return 0;\n    }\n}"]);
});

// 70. 爬楼梯的高票解里有一行 ```❌ TLE ❌```，它不是代码块的开头，不能打乱后面围栏的配对
test("javaBlocks 不把单行的 ```...``` 当成代码块开头", () => {
  const md = "Brute force: ```❌ TLE ❌```\n```❌ TLE ❌```\n```C++ []\nint a;\n```\n```Java []\nclass Solution {}\n```";
  assert.deepEqual(javaBlocks(md), ["class Solution {}"]);
});

// 老题解（如 200. 岛屿数量、206. 反转链表的高票解）用 4 空格缩进的代码块，有的只有方法没有类
test("javaBlocks 识别 4 空格缩进的 Java 代码块", () => {
  const md = [
    "**Java Solution 1**",
    "",
    "    public class Solution {",
    "        char[][] g;",
    "",
    "        public int numIslands(char[][] grid) {",
    "            return 0;",
    "        }",
    "    }",
    "",
    "---",
    "",
    "    def numIslands(self, grid):",
    "        return 0",
    "",
    "Recursive:",
    "",
    "    public ListNode reverseList(ListNode head) {",
    "        return null;",
    "    }",
  ].join("\n");
  assert.deepEqual(javaBlocks(md), [
    "public class Solution {\n    char[][] g;\n\n    public int numIslands(char[][] grid) {\n        return 0;\n    }\n}",
    "public ListNode reverseList(ListNode head) {\n    return null;\n}",
  ]);
});
