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

// 题解正文里的换行是转义后的字面量 \n，按 JSON 字符串解码；解不开就原样返回
export function decodeContent(raw) {
  if (raw.includes("\n") || !raw.includes("\\n")) return raw;
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw;
  }
}

export function javaBlocks(markdown) {
  return [...markdown.matchAll(/```(\w+)[^\n]*\n([\s\S]*?)```/g)]
    .filter((m) => m[1].toLowerCase() === "java")
    .map((m) => m[2].trimEnd());
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
