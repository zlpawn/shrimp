# 动态质量体检卡与报告规范 (Quality Card & Report Template)

遵循 `leo-code-pipeline` 生态的统一规范：
1. **默认交付（零污染原则）**：在对话窗口中直接输出高信噪比的**【动态质量体检卡】**，不向工作区产生任何临时垃圾文件；
2. **增量落盘防丢**：测试执行过程中，每发现并确认一条 Bug，通过 `scripts/report_collector.mjs` 追加写入 `~/.shrimp/skills/leo-code-qa/reports/` 目录；
3. **语言规范**：所有交付物一律使用中文。

---

## 动态质量体检卡模板（聊天窗口即时呈现）

```markdown
### 🛡️ 代码质检体检卡 (leo-code-qa)

- **执行模式**：[E2E 浏览器黑盒 | 单元测试 | 接口契约 | 组合联调]
- **测试状态**：[🟢 全部通过 | 🟡 发现非阻断缺陷 | 🔴 存在严重阻断 Bug]
- **质量评分**：XX / 100
- **本地报告留底**：`~/.shrimp/skills/leo-code-qa/reports/qa-report-<timestamp>.md`

| 维度 | 执行项 | 结果 | 关键备注 |
| :--- | :--- | :---: | :--- |
| **覆盖范围** | git diff 涉及模块 | N 个 | 涵盖 X 个页面，Y 个 API 接口 |
| **三端核验** | Console / Network / 日志 | [PASS / FAIL] | [无假成功 / 拦截到 200 假成功] |
| **数据持久态** | 刷新页面二次比对 | [PASS / FAIL] | [数据真实落库 / 存在内存假持久] |
| **缺陷汇总** | Critical: A, High: B, Med: C | - | 共 N 条已两遍稳定复现 |

#### 🚨 关键缺陷摘要（如有）
1. **[BUG-001] [High] 某某页面新增数据刷新后丢失**
   - 现象：前端提示成功，刷新页面列表为空；
   - 根因证据：接口虽然返回 200，但响应体为 `{"code": 50001, "msg": "DB error"}`；
   - 现场截图：`~/.shrimp/skills/leo-code-qa/reports/evidence-001.png`

---
> 💡 **后续建议**：[根据测试结果给出的针对性修复建议]
```
