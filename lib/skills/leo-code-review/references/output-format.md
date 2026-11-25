# Output Formatting Specification (输出格式规范)

All reviews conducted by `leo-code-review` must be presented to the user in **concise, high-density, professional Chinese (中文)**.

---

## 1. Zero-Issue Silence Rule (零问题闭嘴规则)

When no issues score $\ge 80$ points, or when all candidates have been falsified:
- **STRICTLY PROHIBITED**: Adding subjective nitpicks, unsolicited design advice, minor formatting comments, or "encouraging words" to fill up space.
- **OUTPUT**: Exactly one clean, reassuring confirmation line:

```markdown
✅ 未发现高置信度缺陷与需求偏差。（已对本地改动进行高信噪比 Bug 审查与需求一致性核验）
```

---

## 2. Issues Found Output Template (发现问题时的报告格式)

If issues with confidence $\ge 80$ are confirmed, sort them strictly by severity:
1. **【P0 - 致命/阻塞】** (Crash, data corruption, critical requirement missing, security exploit)
2. **【P1 - 高危缺陷】** (Logic inversion, unhandled runtime error, silent failure, placeholder stub)
3. **【P2 - 边界隐患】** (Demonstrable edge-case fault, race condition with concrete trigger path)

### Markdown Template:

```markdown
### 🔍 本地改动审查报告 (审查目标: <改动类型，如 工作区改动 / 分支对比>)

共发现 **N** 处高置信度缺陷：

---

#### 1. [置信度: 95/100] 【P0 - 致命】 `src/auth/token.js:42` — Token 刷新后未持久化导致死锁
- **类别**：功能逻辑漏洞 / 需求实现偏差 / 静默异常吞咽 / 虚假桩实现
- **触发路径 / 偏差证据**：
  当用户 Access Token 过期时，`refreshToken()` 成功生成新 Token，但未写回 `sessionStore`。下一个并发请求进入后判定凭证失效并抛出 401，导致死锁。
- **最小修复**：
  ```diff
  - await this.cache.set(key, newToken);
  + await Promise.all([this.cache.set(key, newToken), this.sessionStore.update(key, newToken)]);
  ```

---

#### 2. [置信度: 85/100] 【P1 - 高危】 `src/worker/task.js:78` — 存在未实现的占位桩代码
- **类别**：虚假桩实现与需求漏项
- **触发路径 / 偏差证据**：
  用户明确要求“支持重试间隔退避与失败告警”，但改动中该函数直接 `return true; // TODO: retry`，属于未完成的假实现。
- **最小修复**：
  补齐退避重试逻辑或显式抛出未支持异常，禁止伪装成功。
```

---

## 3. Formatting Rules
- Do NOT use GitHub PR comment syntax (`gh pr comment`, `@mention`).
- Ensure code snippets in `最小修复` are minimal and drop-in ready.
- Keep descriptions clear, technical, and free of conversational fluff.
