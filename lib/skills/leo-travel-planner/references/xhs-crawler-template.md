# 小红书素人避坑与一嗨租车抓取模板 (Crawler Templates)

本指南提供在 `leo-travel-planner` 中通过 `ego-browser` 交互抓取小红书素人笔记与一嗨租车信息的标准化代码片段与防坑法则。

---

## 1. 小红书素人避坑笔记检索模板

### 核心过滤逻辑
* **营销号黑名单**：剔除带有 `定制游`、`小团`、`纯玩团`、`私信`、`拼车领队`、`包车师傅`、`旅行社`、`报团`、`滴滴我`、`点击购买` 等词汇的笔记；
* **素人白名单标签**：保留带有 `真实`、`踩坑`、`劝退`、`血泪教训`、`排队`、`暗冰`、`自驾`、`机位`、`穿衣` 等词汇的高价值经验。

### 标准抓取脚本（含滑块验证码探测与人机接管机制）

```bash
ego-browser nodejs <<'EOF'
const task = await useOrCreateTaskSpace('leo-travel-xhs')

// 检索关键词设计：地点 + 核心痛点词 (如 '喀纳斯 9月 避坑 真实自驾')
const keyword = '喀纳斯 避坑 真实经历'
await openOrReuseTab('https://www.xiaohongshu.com/search_result?keyword=' + encodeURIComponent(keyword), { wait: true, timeout: 20 })
await wait(3)

// 1. 检查是否存在安全拦截或滑块验证码
const hasCaptcha = await js(String.raw`(() => {
  const text = document.body.innerText;
  return text.includes('验证码') || text.includes('安全验证') || text.includes('滑动验证') || !!document.querySelector('.captcha-modal, div[id*="captcha"], .geetest_panel');
})()`);

if (hasCaptcha) {
  cliLog(JSON.stringify({ status: 'NEED_USER_HANDOFF', message: '检测到小红书安全验证，请在浏览器中滑动完成验证后通知继续' }));
  // 切给用户人工接管处理
  await handOffTaskSpace(task.id);
  return;
}

// 2. 正常提取前 6 条素人笔记卡片
const notes = await js(String.raw`(() => {
  const cards = Array.from(document.querySelectorAll('section.note-item, .note-card, div.feeds-container section'));
  const blackList = ['私信', '定制游', '纯玩团', '小团', '拼车', '包车师傅', '旅行社', '报团', '私聊', '点击下单'];
  
  const results = [];
  for (const card of cards) {
    const title = card.querySelector('.title, a.title, .footer .title')?.innerText || '';
    const author = card.querySelector('.author, .user-name, .name')?.innerText || '';
    const likes = card.querySelector('.like-wrapper, .count, .likes')?.innerText || '';
    const href = card.querySelector('a')?.href || '';
    
    // 过滤黑名单
    const isCommercial = blackList.some(bw => title.includes(bw) || author.includes(bw));
    if (title && href && !isCommercial) {
      results.push({ title, author, likes, href });
    }
    if (results.length >= 6) break;
  }
  return results;
})()`);

cliLog(JSON.stringify(notes, null, 2))
await completeTaskSpace(task.id, { keep: false })
EOF
```

---

## 2. 一嗨租车门店与车型检索模板

### 核心要素
* 锁定机场/高铁站等核心交通枢纽取还车门店（如 `乌鲁木齐地窝堡机场店`、`乌鲁木齐站店`）；
* 提取车系、级别（轿车 vs SUV vs 商务车）、动力形式（燃油 / 混动 / 纯电）与日均价格。

### 标准抓取脚本（Heredoc）

```bash
ego-browser nodejs <<'EOF'
const task = await useOrCreateTaskSpace('leo-travel-ehi')

// 打开一嗨官方自驾预订页
await openOrReuseTab('https://booking.1hai.cn/order/firstStep', { wait: true, timeout: 20 })
await wait(3)

// 读取当前可选车型与价格列表
const carOptions = await js(String.raw`(() => {
  const items = Array.from(document.querySelectorAll('.car-item, div[class*="carCard"], div[class*="vehicle"], .ant-card'));
  return items.slice(0, 10).map(el => {
    const text = el.innerText;
    return text.replace(/\n+/g, ' | ');
  }).filter(t => t.includes('¥') || t.includes('车'));
})()`);

cliLog('Car options:\n' + JSON.stringify(carOptions, null, 2))
await completeTaskSpace(task.id, { keep: false })
EOF
```

---

## 3. 结果可追溯性校验规则
* 所有从小红书抓取得到的笔记，必须记录 `title`、`author` 和 `href`；
* 输出到用户方案时，严格采用超链接格式：
  ```markdown
  * [小红书·{author}: {title}]({href})
  ```
* 严禁出现无链接来源的口头经验建议。
