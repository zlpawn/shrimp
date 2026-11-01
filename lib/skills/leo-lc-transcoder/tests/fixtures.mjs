// 2026-11-01 用浏览器抓取的 leetcode.com 真实响应，删去了与解析无关的字段。

export const SEARCH_3 = {
  data: {
    problemsetQuestionListV2: {
      questions: [
        {
          questionFrontendId: "3",
          title: "Longest Substring Without Repeating Characters",
          titleSlug: "longest-substring-without-repeating-characters",
          difficulty: "MEDIUM",
          paidOnly: false,
          status: "SOLVED",
          topicTags: [
            { name: "Hash Table", slug: "hash-table" },
            { name: "String", slug: "string" },
            { name: "Sliding Window", slug: "sliding-window" },
          ],
        },
        {
          questionFrontendId: "30",
          title: "Substring with Concatenation of All Words",
          titleSlug: "substring-with-concatenation-of-all-words",
          difficulty: "HARD",
          paidOnly: false,
          status: null,
          topicTags: [{ name: "Sliding Window", slug: "sliding-window" }],
        },
      ],
    },
  },
};

// 搜 "206" 时，2060 排在 206 前面，用来测试按题号精确匹配
export const SEARCH_206 = {
  data: {
    problemsetQuestionListV2: {
      questions: [
        { questionFrontendId: "2060", title: "Check if an Original String Exists Given Two Encoded Strings", titleSlug: "check-if-an-original-string-exists-given-two-encoded-strings", difficulty: "HARD", paidOnly: false, status: null, topicTags: [] },
        { questionFrontendId: "206", title: "Reverse Linked List", titleSlug: "reverse-linked-list", difficulty: "EASY", paidOnly: false, status: "SOLVED", topicTags: [{ name: "Linked List", slug: "linked-list" }, { name: "Recursion", slug: "recursion" }] },
      ],
    },
  },
};

export const QUESTION_206 = {
  data: {
    question: {
      questionId: "206",
      questionFrontendId: "206",
      title: "Reverse Linked List",
      titleSlug: "reverse-linked-list",
      content:
        '<p>Given the <code>head</code> of a singly linked list, reverse the list, and return <em>the reversed list</em>.</p>\n<p><strong class="example">Example 1:</strong></p>\n<img alt="" src="https://assets.leetcode.com/uploads/2021/02/19/rev1ex1.jpg" style="width: 542px; height: 222px;" />\n<pre><strong>Input:</strong> head = [1,2,3,4,5]\n<strong>Output:</strong> [5,4,3,2,1]</pre>\n<img alt="" src="https://assets.leetcode.com/uploads/2021/02/19/rev1ex2.jpg" style="width: 182px; height: 222px;" />',
      difficulty: "Easy",
      isPaidOnly: false,
      exampleTestcaseList: ["[1,2,3,4,5]", "[1,2]", "[]"],
      metaData: '{\n  "name": "reverseList",\n  "params": [\n    {\n      "name": "head",\n      "type": "ListNode"\n    }\n  ],\n  "return": {\n    "type": "ListNode"\n  }\n}',
      hints: [],
      status: "ac",
      topicTags: [
        { name: "Linked List", slug: "linked-list" },
        { name: "Recursion", slug: "recursion" },
      ],
      codeSnippets: [
        { langSlug: "cpp", code: "class Solution {\npublic:\n    ListNode* reverseList(ListNode* head) {\n        \n    }\n};" },
        { langSlug: "java", code: "class Solution {\n    public ListNode reverseList(ListNode head) {\n        \n    }\n}" },
      ],
    },
  },
};

export const QUESTION_PAID = {
  data: {
    question: {
      questionId: "1102",
      questionFrontendId: "1150",
      title: "Check If a Number Is Majority Element in a Sorted Array",
      titleSlug: "check-if-a-number-is-majority-element-in-a-sorted-array",
      content: null,
      difficulty: "Easy",
      isPaidOnly: true,
      exampleTestcaseList: [],
      metaData: "{}",
      hints: [],
      status: null,
      topicTags: [],
      codeSnippets: null,
    },
  },
};

export const ME_OK = { data: { userStatus: { isSignedIn: true, username: "tester" } } };

export const INTERPRET = { interpret_id: "runcode_1793538465.3095_TtOXjX5wV1", test_case: "[3,2,4]\n6" };

export const CHECK_PENDING = { state: "PENDING" };

export const CHECK_RUN_OK = {
  status_code: 10, lang: "java", run_success: true, status_runtime: "0 ms", memory: 42024000,
  code_answer: ["[0,1]", "[1,2]", ""], code_output: [], std_output_list: ["", "", ""],
  expected_code_answer: ["[0,1]", "[1,2]", ""], correct_answer: true, compare_result: "11",
  total_correct: 2, total_testcases: 2, status_memory: "42 MB", pretty_lang: "Java",
  submission_id: "runcode_1793538439.691717_I11GXGp3IW", status_msg: "Accepted", state: "SUCCESS",
};

// 注意：答案错误时 status_msg 仍是 "Accepted"，correct_answer 为 false
export const CHECK_RUN_WRONG = {
  status_code: 10, lang: "java", run_success: true, status_runtime: "0 ms", memory: 41224000,
  code_answer: ["[0,1]", ""], code_output: [], std_output_list: ["", ""],
  expected_code_answer: ["[1,2]", ""], correct_answer: false, compare_result: "0",
  total_correct: 0, total_testcases: 1, status_memory: "41.2 MB", pretty_lang: "Java",
  submission_id: "runcode_1793538465.3095_TtOXjX5wV1", status_msg: "Accepted", state: "SUCCESS",
};

export const CHECK_RUN_COMPILE_ERROR = {
  status_code: 20, lang: "java", run_success: false,
  compile_error: "Line 3: error: ';' expected",
  full_compile_error: "Line 3: error: ';' expected\n        return new int[]{0, 1}\n                              ^",
  status_runtime: "N/A", memory: 0, code_answer: [], code_output: [], std_output_list: [""],
  total_correct: null, total_testcases: null, status_memory: "N/A", pretty_lang: "Java",
  submission_id: "runcode_1793538487.7014673_YFJGexjgS5", status_msg: "Compile Error", state: "SUCCESS",
};

// 2026-11-01 自检时抓取：head 为空时访问 head.next.next
export const CHECK_RUN_RUNTIME_ERROR = {
  status_code: 15, lang: "java", run_success: false,
  runtime_error: 'Line 3: java.lang.NullPointerException: Cannot read field "next" because "<parameter1>" is null',
  full_runtime_error: 'java.lang.NullPointerException: Cannot read field "next" because "<parameter1>" is null\n  at line 3, Solution.reverseList\n  at line 56, __DriverSolution__.__helper__\n  at line 86, __Driver__.main',
  status_runtime: "N/A", code_answer: [], expected_code_answer: ["[]", ""], correct_answer: false,
  total_correct: 0, status_memory: "N/A", pretty_lang: "Java", status_msg: "Runtime Error", state: "SUCCESS",
};

export const SUBMIT = { submission_id: 2186991119 };

export const CHECK_SUBMIT_WRONG = {
  status_code: 11, lang: "java", run_success: true, status_runtime: "N/A", memory: 46724000,
  question_id: "1", compare_result: "1010000001", code_output: "[0,1]", std_output: "",
  last_testcase: "[3,2,4]\n6", expected_output: "[1,2]", finished: true,
  total_correct: 38, total_testcases: 66, runtime_percentile: null, status_memory: "N/A",
  memory_percentile: null, pretty_lang: "Java", submission_id: "2186991119",
  input_formatted: "[3,2,4], 6", input: "[3,2,4]\n6", status_msg: "Wrong Answer", state: "SUCCESS",
};

export const CHECK_SUBMIT_OK = {
  status_code: 10, lang: "java", run_success: true, status_runtime: "2 ms", memory: 46580000,
  question_id: "1", code_output: "", std_output: "", last_testcase: "", expected_output: "",
  finished: true, total_correct: 66, total_testcases: 66, runtime_percentile: 99.4165,
  status_memory: "46.6 MB", memory_percentile: 88.0619, pretty_lang: "Java",
  submission_id: "2186990503", status_msg: "Accepted", state: "SUCCESS",
};

export const SOLUTIONS_TWO_SUM = {
  data: {
    ugcArticleSolutionArticles: {
      edges: [
        {
          node: {
            title: "✅3 Method's || C++ || JAVA || PYTHON || Beginner Friendly🔥🔥🔥",
            slug: "3-methods-c-java-python-beginner-friendl-x595",
            topicId: 3619262,
            author: { userName: "rahulvarma5297" },
            reactions: [{ count: 12288, reactionType: "UPVOTE" }, { count: 15, reactionType: "THUMBS_DOWN" }],
          },
        },
        {
          node: {
            title: "【Video】Step by Step Easy Solution",
            slug: "video-step-by-step-easy-solution-by-niit-i4q6",
            topicId: 6754748,
            author: { userName: "niits" },
            reactions: [{ count: 4557, reactionType: "UPVOTE" }, { count: 4, reactionType: "THUMBS_DOWN" }],
          },
        },
      ],
    },
  },
};

// 正文里的换行是转义后的字面量 \n（反斜杠 + n），这里按原样保留
export const SOLUTION_DETAIL_1 = {
  data: {
    ugcArticleSolutionArticle: {
      content: "# Solution 3: (One-pass Hash Table)\\n```C++ []\\nclass Solution {};\\n```\\n```Java []\\nclass Solution {\\n    public int[] twoSum(int[] nums, int target) {\\n        return new int[]{};\\n    }\\n}\\n\\n```\\n```Python3 []\\nclass Solution:\\n    pass\\n```",
    },
  },
};

export const SOLUTION_DETAIL_2 = {
  data: { ugcArticleSolutionArticle: { content: "Use HashMap.\\n```java\\nclass Solution {}\\n```" } },
};
