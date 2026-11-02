// leetcode.com 接口封装。接口与字段于 2026-11-01 用浏览器抓包确认，样本见 tests/fixtures.mjs。
const BASE = "https://leetcode.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export class LcError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

const Q_ME = "query me { userStatus { isSignedIn username } }";
const Q_SEARCH = `query search($searchKeyword: String, $limit: Int, $skip: Int, $categorySlug: String, $filters: QuestionFilterInput, $sortBy: QuestionSortByInput) {
  problemsetQuestionListV2(searchKeyword: $searchKeyword, limit: $limit, skip: $skip, categorySlug: $categorySlug, filters: $filters, sortBy: $sortBy) {
    questions { questionFrontendId title titleSlug difficulty paidOnly status topicTags { name slug } }
  }
}`;
const Q_QUESTION = `query question($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId questionFrontendId title titleSlug content difficulty isPaidOnly
    exampleTestcaseList metaData hints status topicTags { name slug } codeSnippets { langSlug code }
  }
}`;
const Q_SOLUTIONS = `query solutions($questionSlug: String!, $orderBy: ArticleOrderByEnum, $tagSlugs: [String!], $first: Int, $skip: Int) {
  ugcArticleSolutionArticles(questionSlug: $questionSlug, orderBy: $orderBy, tagSlugs: $tagSlugs, first: $first, skip: $skip, userInput: "", searchScope: CONTENT) {
    edges { node { title slug topicId author { userName } reactions { count reactionType } } }
  }
}`;
const Q_SOLUTION = "query solution($topicId: ID!) { ugcArticleSolutionArticle(topicId: $topicId) { content } }";
const Q_HISTORY = `query history($questionSlug: String!, $offset: Int!, $limit: Int!) {
  questionSubmissionList(questionSlug: $questionSlug, offset: $offset, limit: $limit) { hasNext submissions { statusDisplay lang timestamp } }
}`;
const Q_PROGRESS = `query progress($filters: UserProgressQuestionListInput) {
  userProgressQuestionList(filters: $filters) { totalNum questions { frontendId titleSlug difficulty lastSubmittedAt questionStatus topicTags { slug } } }
}`;

const trimEmpty = (list) => {
  const out = [...(list || [])];
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
};

export function parseSearch(body) {
  return body.data.problemsetQuestionListV2.questions.map((q) => ({
    id: q.questionFrontendId,
    title: q.title,
    slug: q.titleSlug,
    difficulty: q.difficulty,
    paidOnly: q.paidOnly,
    status: q.status,
    tags: q.topicTags.map((t) => t.slug),
  }));
}

export function parseQuestion(q) {
  if (!q) throw new LcError("not_found", "题目不存在");
  if (!q.content) throw new LcError("paid_only", `${q.questionFrontendId}. ${q.title} 是会员题，当前账号看不到题面`);
  return {
    id: q.questionFrontendId,
    questionId: q.questionId,
    title: q.title,
    slug: q.titleSlug,
    url: `${BASE}/problems/${q.titleSlug}/`,
    difficulty: q.difficulty,
    status: q.status,
    tags: q.topicTags.map((t) => t.slug),
    contentHtml: q.content,
    images: [...q.content.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]),
    exampleTestcases: q.exampleTestcaseList || [],
    metaData: JSON.parse(q.metaData || "{}"),
    javaTemplate: q.codeSnippets?.find((s) => s.langSlug === "java")?.code ?? null,
    hints: q.hints || [],
  };
}

export function parseJudge(raw, kind) {
  const common = {
    kind,
    compileError: raw.full_compile_error || null,
    runtimeError: raw.full_runtime_error || raw.runtime_error || null,
    runtime: raw.status_runtime,
    memory: raw.status_memory,
  };
  if (kind === "run") {
    // 运行（interpret）时答案错误，status_msg 仍是 "Accepted"，要看 correct_answer
    const wrong = raw.status_msg === "Accepted" && raw.correct_answer === false;
    return {
      ...common,
      status: wrong ? "Wrong Answer" : raw.status_msg,
      passed: raw.status_msg === "Accepted" && raw.correct_answer === true,
      output: trimEmpty(raw.code_answer),
      expected: trimEmpty(raw.expected_code_answer),
      stdout: trimEmpty(raw.std_output_list),
    };
  }
  return {
    ...common,
    status: raw.status_msg,
    passed: raw.status_msg === "Accepted",
    submissionId: raw.submission_id,
    totalCorrect: raw.total_correct,
    totalTestcases: raw.total_testcases,
    lastTestcase: raw.last_testcase || null,
    output: raw.code_output || null,
    expected: raw.expected_output || null,
    stdout: raw.std_output || null,
    runtimePercentile: raw.runtime_percentile,
    memoryPercentile: raw.memory_percentile,
  };
}

const day = (ms) => new Date(ms).toLocaleDateString("sv"); // 本地日期 YYYY-MM-DD
const sinceMs = (since) => (since ? Date.parse(`${since}T00:00:00`) : Infinity);

// 一道题的提交按 since 分成「以前」和「本轮」两组；subs 是接口原样返回的（新的在前）
export function splitHistory(subs, since) {
  const all = subs.map((s) => ({ at: Number(s.timestamp) * 1000, status: s.statusDisplay, lang: s.lang })).sort((a, b) => a.at - b.at);
  const summarize = (list) => {
    if (!list.length) return null;
    const firstAc = list.findIndex((s) => s.status === "Accepted");
    return {
      submissions: list.length,
      accepted: firstAc >= 0,
      firstTryAccepted: firstAc === 0,
      failsBeforeAccepted: firstAc >= 0 ? firstAc : list.length,
      first: day(list[0].at),
      last: day(list.at(-1).at),
      list: list.map((s) => ({ date: day(s.at), status: s.status, lang: s.lang })),
    };
  };
  const cut = sinceMs(since);
  return { since: since || null, before: summarize(all.filter((s) => s.at < cut)), current: summarize(all.filter((s) => s.at >= cut)) };
}

export function summarizeProgress(questions, since) {
  const solved = questions.filter((q) => q.questionStatus === "SOLVED");
  const count = (list, key) => list.reduce((m, x) => ((m[key(x)] = (m[key(x)] || 0) + 1), m), {});
  const tags = Object.entries(count(solved.flatMap((q) => q.topicTags), (t) => t.slug)).sort((a, b) => b[1] - a[1]).slice(0, 15);
  const last = questions.map((q) => q.lastSubmittedAt).filter(Boolean).sort().at(-1) || null;
  const cut = sinceMs(since);
  return {
    since: since || null,
    attempted: questions.length,
    solved: solved.length,
    solvedByDifficulty: count(solved, (q) => q.difficulty),
    lastSubmitted: last && day(Date.parse(last)),
    touchedSinceStart: since ? questions.filter((q) => q.lastSubmittedAt && Date.parse(q.lastSubmittedAt) >= cut).length : null,
    topTags: Object.fromEntries(tags),
  };
}

const ESCAPES = { n: "\n", t: "\t", r: "\r", "'": "'", '"': '"', "\\": "\\", "/": "/" };

// 题解正文里的换行等字符是转义后的字面量（\n、\'），而双引号不一定转义，所以不能用 JSON.parse，逐个替换转义序列
export function decodeContent(raw) {
  if (raw.includes("\n") || !raw.includes("\\n")) return raw;
  return raw.replace(/\\(u[0-9a-fA-F]{4}|[ntr'"\\/])/g, (_, c) => (c.length === 5 ? String.fromCharCode(parseInt(c.slice(1), 16)) : ESCAPES[c]));
}

// 没标语言的代码块里，有 Java 方法签名的算 Java（C++ 的 public: 不算）。
// ponytail: 启发式判断，C# 题解也可能被认成 Java；遇到误判再按语言特征细分
const looksLikeJava = (code) =>
  /\b(?:public|private|protected)\s+(?:static\s+)?[\w<>[\],.\s]+?\s+\w+\s*\(/.test(code) && !/\bpublic:/.test(code);

// 围栏必须在行首，信息串里不能有反引号（CommonMark），否则 ```❌ TLE ❌``` 这种单行写法会打乱配对
const FENCE = /^[ \t]*```[ \t]*(\w*)[^\n`]*\n([\s\S]*?)^[ \t]*```/gm;

// 老题解常用 4 空格缩进的代码块（没有 ``` 围栏）
function indentedBlocks(markdown) {
  const lines = markdown.replace(FENCE, "\n").split("\n");
  const blocks = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const indented = /^( {4}|\t)/.test(lines[i]);
    if (cur && (indented || lines[i].trim() === "")) {
      cur.push(lines[i]);
      continue;
    }
    if (cur) blocks.push(cur);
    cur = indented && (i === 0 || lines[i - 1].trim() === "") ? [lines[i]] : null;
  }
  if (cur) blocks.push(cur);
  return blocks.map((b) => b.map((l) => l.replace(/^( {4}|\t)/, "")).join("\n").trimEnd());
}

export function javaBlocks(markdown) {
  const fenced = [...markdown.matchAll(FENCE)]
    .filter((m) => m[1].toLowerCase() === "java" || (m[1] === "" && looksLikeJava(m[2])))
    .map((m) => m[2].trimEnd());
  return [...fenced, ...indentedBlocks(markdown).filter(looksLikeJava)];
}

export function createApi(creds, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = 1500, maxPolls = 40 } = {}) {
  const headers = (referer) => ({
    "content-type": "application/json",
    cookie: `LEETCODE_SESSION=${creds.LEETCODE_SESSION}; csrftoken=${creds.csrftoken}`,
    "x-csrftoken": creds.csrftoken,
    origin: BASE,
    referer,
    "user-agent": UA,
  });

  async function request(pathname, { method = "GET", body, referer = `${BASE}/problemset/` } = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(BASE + pathname, {
        method,
        headers: headers(referer),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 401 || res.status === 403) {
        throw new LcError("auth", "LeetCode 拒绝了请求：登录态失效，或被 Cloudflare 拦截");
      }
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        // 连续运行太快时 LeetCode 会返回 HTML 页面
      }
      if (res.ok && json) return json;
      if (attempt >= 2) {
        throw new LcError(res.status === 429 ? "rate_limited" : "bad_response", `LeetCode 返回异常（HTTP ${res.status}），请稍后再试`, text.slice(0, 200));
      }
      await sleep(5000 * (attempt + 1));
    }
  }

  async function gql(query, variables = {}) {
    const body = await request("/graphql/", { method: "POST", body: { query, variables } });
    if (body.errors?.length) throw new LcError("graphql", body.errors[0].message);
    return body;
  }

  async function search(keyword, limit = 10) {
    return parseSearch(
      await gql(Q_SEARCH, {
        searchKeyword: String(keyword),
        limit,
        skip: 0,
        categorySlug: "all-code-essentials",
        filters: { filterCombineType: "ALL" },
        sortBy: { sortField: "CUSTOM", sortOrder: "ASCENDING" },
      }),
    );
  }

  async function slugOf(idOrSlug) {
    const key = String(idOrSlug);
    if (!/^\d+$/.test(key)) return key;
    const hit = (await search(key, 20)).find((q) => q.id === key);
    if (!hit) throw new LcError("not_found", `找不到题号 ${key}`);
    return hit.slug;
  }

  async function show(idOrSlug) {
    return parseQuestion((await gql(Q_QUESTION, { titleSlug: await slugOf(idOrSlug) })).data.question);
  }

  async function judge(q, endpoint, payload, kind) {
    const started = await request(`/problems/${q.slug}/${endpoint}/`, { method: "POST", body: payload, referer: q.url });
    const id = started.interpret_id || started.submission_id;
    if (!id) throw new LcError("bad_response", "LeetCode 没有返回判题编号", JSON.stringify(started).slice(0, 200));
    for (let i = 0; i < maxPolls; i++) {
      await sleep(pollMs);
      const raw = await request(`/submissions/detail/${id}/check/`, { referer: q.url });
      if (raw.state === "SUCCESS") return parseJudge(raw, kind);
    }
    throw new LcError("judge_timeout", "等待判题结果超时，请稍后重试");
  }

  return {
    // 以前的提交只作参考，不能算进本轮的掌握度和一次提交通过
    async history(idOrSlug, since) {
      const slug = await slugOf(idOrSlug);
      const subs = [];
      for (let offset = 0; ; offset += 20) {
        const page = (await gql(Q_HISTORY, { questionSlug: slug, offset, limit: 20 })).data.questionSubmissionList;
        subs.push(...page.submissions);
        if (!page.hasNext) break;
      }
      return { slug, ...splitHistory(subs, since) };
    },
    async overview(since) {
      const questions = [];
      for (let skip = 0; ; skip += 50) {
        const page = (await gql(Q_PROGRESS, { filters: { skip, limit: 50 } })).data.userProgressQuestionList;
        questions.push(...page.questions);
        if (!page.questions.length || questions.length >= page.totalNum) break;
      }
      return summarizeProgress(questions, since);
    },
    async whoami() {
      const s = (await gql(Q_ME)).data.userStatus;
      return { signedIn: s.isSignedIn, username: s.username };
    },
    search,
    show,
    async run(idOrSlug, code, input) {
      const q = await show(idOrSlug);
      const dataInput = input ?? q.exampleTestcases.join("\n");
      return judge(q, "interpret_solution", { lang: "java", question_id: q.questionId, typed_code: code, data_input: dataInput }, "run");
    },
    async submit(idOrSlug, code) {
      const q = await show(idOrSlug);
      return judge(q, "submit", { lang: "java", question_id: q.questionId, typed_code: code }, "submit");
    },
    async solutions(idOrSlug, top = 5) {
      const slug = await slugOf(idOrSlug);
      const body = await gql(Q_SOLUTIONS, { questionSlug: slug, orderBy: "MOST_VOTES", tagSlugs: ["java"], first: top, skip: 0 });
      const list = [];
      for (const { node } of body.data.ugcArticleSolutionArticles.edges) {
        const detail = await gql(Q_SOLUTION, { topicId: String(node.topicId) });
        const content = decodeContent(detail.data.ugcArticleSolutionArticle.content || "");
        list.push({
          title: node.title,
          author: node.author?.userName ?? null,
          upvotes: node.reactions.find((r) => r.reactionType === "UPVOTE")?.count ?? 0,
          topicId: String(node.topicId),
          url: `${BASE}/problems/${slug}/solutions/${node.topicId}/${node.slug}/`,
          content,
          javaCode: javaBlocks(content),
        });
      }
      return list;
    },
  };
}
