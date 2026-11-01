# 题型目录

每个题型包含：识别信号、Java 模板（`【变化点】` 标出不同题目要改的地方）、易错点、模板题。讲题和写题型卡都以这里为准；新增题型按同样格式追加 `P14` 起的条目。

## 数据规模 → 允许的复杂度（解题四问第 1 问）

按每秒约 10⁸ 次简单运算估算：

| n 的范围 | 允许的复杂度 | 常见做法 |
|---|---|---|
| n ≤ 10 | O(n!)、O(2ⁿ·n) | 回溯全排列 |
| n ≤ 20 | O(2ⁿ) | 回溯子集、状态压缩 |
| n ≤ 500 | O(n³) | 三重循环、区间 DP |
| n ≤ 5000 | O(n²) | 双重循环、二维 DP |
| n ≤ 10⁵～10⁶ | O(n log n)、O(n) | 排序、二分、堆、双指针、滑动窗口、哈希、前缀和 |
| n 很大或是值域 | O(log n)、O(1) | 二分答案、数学 |

---

## P01 哈希表

**识别信号**
- "找两个数 / 两个元素满足某个关系"，暴力是两重循环
- "是否出现过""出现几次""分组"
- 需要 O(1) 查"之前见过没有"

**模板**

```java
Map<Integer, Integer> seen = new HashMap<>();   // 值 -> 下标（或次数）
for (int i = 0; i < nums.length; i++) {
    int need = target - nums[i];                // 【变化点】要找的"另一半"
    if (seen.containsKey(need)) return new int[] {seen.get(need), i};
    seen.put(nums[i], i);                       // 先查再放，避免自己和自己配对
}
return new int[0];
```

**易错点**：先放后查会让一个元素和自己配对；分组题的 key 要选对（如字母异位词用排序后的字符串）。

**模板题**：1. 两数之和、49. 字母异位词分组、128. 最长连续序列

## P02 双指针

这里指相向双指针（一左一右往中间走）；同向的快慢指针见 P07 链表。

**识别信号**
- 数组**有序**（或可以先排序），找满足条件的一对
- "原地""两端""回文"
- 暴力两重循环，但移动一端就能排除一批答案

**模板**

```java
int l = 0, r = nums.length - 1;
while (l < r) {
    int sum = nums[l] + nums[r];
    if (sum == target) {        // 【变化点】命中时做什么（记录答案、去重后继续）
        l++;
        r--;
    } else if (sum < target) {
        l++;                    // 和小了：左边换大一点的
    } else {
        r--;                    // 和大了：右边换小一点的
    }
}
```

**易错点**：三数之和要跳过重复值；循环条件是 `l < r`，不是 `l <= r`。

**模板题**：167. 两数之和 II、15. 三数之和、11. 盛最多水的容器

## P03 滑动窗口

**识别信号**
- "连续子数组 / 子串"加上"最长 / 最短 / 个数"
- 窗口扩大时条件只会变差（或只会变好），满足单调性
- 暴力是枚举所有区间 O(n²)

**模板**（求最长的合法窗口）

```java
Map<Character, Integer> window = new HashMap<>();
int left = 0, best = 0;
for (int right = 0; right < s.length(); right++) {
    char c = s.charAt(right);
    window.merge(c, 1, Integer::sum);           // 1. 右边进窗口
    while (window.get(c) > 1) {                 // 2.【变化点】窗口不合法就收缩
        char d = s.charAt(left++);
        window.merge(d, -1, Integer::sum);
    }
    best = Math.max(best, right - left + 1);    // 3. 此时窗口合法，更新答案
}
return best;
```

**变化点**：求**最短**满足条件的窗口时，条件是"满足就收缩"，答案在 `while` 循环**里面**更新。

**易错点**：答案更新的位置（循环里还是循环外）；窗口长度是 `right - left + 1`。

**模板题**：3. 无重复字符的最长子串、209. 长度最小的子数组、76. 最小覆盖子串

## P04 前缀和

**识别信号**
- "子数组的和等于 / 能被整除 / 最大"，而且数组里**有负数**（这时滑动窗口不再单调）
- 多次查询区间和

**模板**（和为 k 的子数组个数）

```java
Map<Integer, Integer> count = new HashMap<>();
count.put(0, 1);                                // 空前缀：处理从下标 0 开始的子数组
int prefix = 0, ans = 0;
for (int x : nums) {
    prefix += x;
    ans += count.getOrDefault(prefix - k, 0);   // 【变化点】要找的旧前缀
    count.merge(prefix, 1, Integer::sum);
}
return ans;
```

**易错点**：忘记 `count.put(0, 1)`；区间和 `sum[i..j] = prefix[j + 1] - prefix[i]` 下标差一位。

**模板题**：560. 和为 K 的子数组、303. 区域和检索 - 数组不可变、238. 除自身以外数组的乘积

## P05 二分查找

**识别信号**
- 有序数组里找位置、找边界
- "最小的最大值""最大的最小值""至少 / 至多"——**二分答案**：答案越大越容易满足（或越难），可以二分
- 要求 O(log n)

**模板**（找第一个 ≥ target 的位置）

```java
int lo = 0, hi = nums.length;                   // 左闭右开 [lo, hi)
while (lo < hi) {
    int mid = lo + (hi - lo) / 2;               // 防止溢出
    if (nums[mid] < target) lo = mid + 1;       // 【变化点】判断条件（二分答案时换成 check(mid)）
    else hi = mid;
}
return lo;                                      // 不存在时等于 nums.length
```

**易错点**：区间开闭和循环条件要配套；`(lo + hi) / 2` 可能溢出；最后一个 ≤ target 的位置 = 第一个 > target 的位置 − 1。

**模板题**：704. 二分查找、35. 搜索插入位置、34. 在排序数组中查找元素的第一个和最后一个位置、875. 爱吃香蕉的珂珂

## P06 单调栈

**识别信号**
- "下一个更大 / 更小的元素""左边第一个比它小的"
- "柱状图""接雨水""温度"

**模板**（下一个更大元素）

```java
int[] ans = new int[n];
Arrays.fill(ans, -1);
Deque<Integer> stack = new ArrayDeque<>();      // 存下标；对应的值从栈底到栈顶递减
for (int i = 0; i < n; i++) {
    while (!stack.isEmpty() && nums[stack.peek()] < nums[i]) {   // 【变化点】比较方向
        ans[stack.pop()] = nums[i];             // 栈顶等到了它的"下一个更大"
    }
    stack.push(i);
}
return ans;
```

**易错点**：栈里存下标而不是值；严格小于还是小于等于决定了相等元素怎么处理。

**模板题**：739. 每日温度、496. 下一个更大元素 I、84. 柱状图中最大的矩形

## P07 链表

**识别信号**
- 输入是 `ListNode`
- "反转""合并""倒数第 k 个""环""中点"

**模板**（反转，以及哑节点 + 快慢指针）

```java
// 反转链表
ListNode prev = null, cur = head;
while (cur != null) {
    ListNode next = cur.next;                   // 先记住下一个
    cur.next = prev;                            // 掉头
    prev = cur;
    cur = next;
}
return prev;

// 删除倒数第 n 个节点
ListNode dummy = new ListNode(0, head);         // 哑节点：头节点也能统一处理
ListNode slow = dummy, fast = dummy;
for (int i = 0; i < n; i++) fast = fast.next;   // 【变化点】快指针先走几步
while (fast.next != null) {
    slow = slow.next;
    fast = fast.next;
}
slow.next = slow.next.next;
return dummy.next;
```

**易错点**：改 `next` 之前没保存下一个节点；空链表和单节点；快慢指针判环时 `fast != null && fast.next != null`。

**模板题**：206. 反转链表、21. 合并两个有序链表、19. 删除链表的倒数第 N 个结点、141. 环形链表

## P08 二叉树递归

**识别信号**
- 输入是 `TreeNode`，问深度、路径、是否对称、公共祖先等
- 整棵树的答案能由左右子树的答案拼出来

**模板**（递归三问：空节点返回什么？左右子树给我什么？我怎么拼出自己的答案？）

```java
int maxDepth(TreeNode root) {
    if (root == null) return 0;                 // 1. 空节点返回什么
    int left = maxDepth(root.left);             // 2. 相信递归：拿到左右子树的答案
    int right = maxDepth(root.right);
    return Math.max(left, right) + 1;           // 3.【变化点】用左右答案拼出自己的答案
}
```

**易错点**：想展开递归的每一层（不需要，相信函数定义即可）；全局答案和返回值不是一回事（如直径、最大路径和）。

**模板题**：104. 二叉树的最大深度、226. 翻转二叉树、236. 二叉树的最近公共祖先

## P09 BFS

BFS 即广度优先搜索。

**识别信号**
- "最少步数""最短路径"，且每一步的代价相同
- "层序遍历""一圈一圈扩散"
- 网格上的连通块

**模板**（网格最短步数）

```java
int[][] dirs = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
Deque<int[]> queue = new ArrayDeque<>();
boolean[][] seen = new boolean[m][n];
queue.offer(new int[] {sr, sc});
seen[sr][sc] = true;
int steps = 0;
while (!queue.isEmpty()) {
    for (int size = queue.size(); size > 0; size--) {          // 一次处理一整层
        int[] cur = queue.poll();
        if (cur[0] == tr && cur[1] == tc) return steps;        // 【变化点】到达条件
        for (int[] d : dirs) {
            int r = cur[0] + d[0], c = cur[1] + d[1];
            if (r < 0 || r >= m || c < 0 || c >= n || seen[r][c] || grid[r][c] == 1) continue;
            seen[r][c] = true;                                 // 入队时就标记，避免重复入队
            queue.offer(new int[] {r, c});
        }
    }
    steps++;
}
return -1;
```

**易错点**：出队时才标记会导致重复入队；按层计数要先取 `queue.size()`。

**模板题**：102. 二叉树的层序遍历、200. 岛屿数量、994. 腐烂的橘子

## P10 回溯

**识别信号**
- "所有组合 / 排列 / 子集 / 方案"
- n 很小（≤ 20）
- 需要列出全部答案，而不是只求个数或最值

**模板**（做选择 → 递归 → 撤销选择）

```java
List<List<Integer>> ans = new ArrayList<>();
List<Integer> path = new ArrayList<>();

void backtrack(int[] nums, int start) {
    ans.add(new ArrayList<>(path));             // 【变化点】什么时候收集答案（子集：每个节点都收）
    for (int i = start; i < nums.length; i++) { // 【变化点】可选范围（组合用 start，排列用 used[]）
        path.add(nums[i]);                      // 做选择
        backtrack(nums, i + 1);
        path.remove(path.size() - 1);           // 撤销选择
    }
}
```

**易错点**：收集答案时直接 `ans.add(path)`，没有复制；去重要先排序，再跳过同一层的相同元素。

**模板题**：78. 子集、46. 全排列、39. 组合总和

## P11 动态规划

**识别信号**
- 求"最大 / 最小 / 方案数 / 能否"
- 当前选择影响后面，暴力递归里有大量重复的子问题
- "爬楼梯""打家劫舍""子序列""背包"

**模板**（四步：状态含义 → 转移方程 → 初始值 → 计算顺序）

```java
// 打家劫舍：dp[i] = 前 i 家能偷到的最大金额
int n = nums.length;
int[] dp = new int[n + 1];
dp[1] = nums[0];                                // 初始值（dp[0] = 0）
for (int i = 2; i <= n; i++) {
    dp[i] = Math.max(dp[i - 1], dp[i - 2] + nums[i - 1]);   // 【变化点】转移：不偷第 i 家 / 偷第 i 家
}
return dp[n];
```

**变化点**：两个序列的题（如最长公共子序列）用二维 `dp[i][j]`，表示前 i 个和前 j 个。

**易错点**：说不清 `dp[i]` 的含义就开始写；`dp` 下标和原数组下标差一位；初始值漏写。

**模板题**：70. 爬楼梯、198. 打家劫舍、300. 最长递增子序列、1143. 最长公共子序列

## P12 堆

Java 里用优先队列 `PriorityQueue` 实现。

**识别信号**
- "第 K 大 / 前 K 个 / 最小的 K 个"
- 不断取出当前最小 / 最大值（如合并 K 个有序链表）

**模板**（第 K 大）

```java
PriorityQueue<Integer> heap = new PriorityQueue<>();   // 小顶堆，堆顶是目前第 K 大
for (int x : nums) {
    heap.offer(x);
    if (heap.size() > k) heap.poll();           // 【变化点】超过 K 个就踢掉最小的
}
return heap.peek();
```

**易错点**：求第 K 大用小顶堆、第 K 小用大顶堆（`(a, b) -> b - a`，注意溢出时改用 `Integer.compare`）。

**模板题**：215. 数组中的第K个最大元素、347. 前 K 个高频元素、23. 合并 K 个升序链表

## P13 图与拓扑排序

**识别信号**
- "课程依赖""先后顺序""能否完成"——有向图里有没有环
- "连通""省份数量"

**模板**（拓扑排序判断能否完成）

```java
List<List<Integer>> graph = new ArrayList<>();
for (int i = 0; i < n; i++) graph.add(new ArrayList<>());
int[] indegree = new int[n];
for (int[] e : edges) {                          // 课程表：[a, b] 表示先修 b 再修 a
    graph.get(e[1]).add(e[0]);                   // 【变化点】边的方向
    indegree[e[0]]++;
}
Deque<Integer> queue = new ArrayDeque<>();
for (int i = 0; i < n; i++) if (indegree[i] == 0) queue.offer(i);
int done = 0;
while (!queue.isEmpty()) {
    int u = queue.poll();
    done++;
    for (int v : graph.get(u)) if (--indegree[v] == 0) queue.offer(v);
}
return done == n;                                // 有环时，环上的点入度永远减不到 0
```

**易错点**：边的方向建反；忘了入度为 0 的点要先全部入队。

**模板题**：207. 课程表、210. 课程表 II、547. 省份数量
