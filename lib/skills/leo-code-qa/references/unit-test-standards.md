# 单元测试与接口回归质检规范 (Unit & API Test Standards)

本规约定义了 `leo-code-qa` 在单元测试（Unit Test）与接口回归测试（API Test）场景下的质量门禁契约与执行标准。

---

## 一、 单元测试（Unit Test）执行标准

### 1. 契约驱动与伪通过伪造检测（Falsification）
- **反对“伪单测”**：单元测试绝不是仅仅跑通 `assert true`。Agent 必须审查测试用例是否包含**有实质价值的边界断言**（如空指针、超长边界、并发竞争、异常抛出契约）。
- **反向证伪法**：当对某个核心单测的真实有效性存疑时，可通过微小扰动临时变更实现类中的返回值，观察单测是否会真实变红（Failed）。若改动了业务逻辑单测依然是绿的，判定该单测为【无效单测（Tautology Test）】。

### 2. 流行框架自适应调度命令
`leo-code-qa` 会根据工程根目录的依赖配置文件（`package.json`, `pom.xml`, `pytest.ini` 等）自动判定并调度：
- **Node.js / TypeScript**：
  - Vitest: `npx vitest run [path]`
  - Jest: `npx jest [path] --bail`
- **Java (Maven / Gradle)**：
  - Maven: `mvn test -Dtest=<ClassName>`
  - Gradle: `./gradlew test --tests <ClassName>`
- **Python**：
  - Pytest: `uv run pytest [path] -v`

---

## 二、 接口集成测试（API Test）标准

### 1. 纯接口测试协议
在无界面的微服务或纯后端接口联调场景中：
- 优先构造轻量 `curl` 或 Node.js `fetch` 脚本批量发起 HTTP 契约测试；
- 重点覆盖：
  1. **正向主流**：合法参数传入，断言状态码与响应体 Schema；
  2. **逆向防护**：必填项缺失、参数越界、类型错误，断言是否给出规范的业务拦截（非 500 崩溃）；
  3. **幂等性测试**：多次调用同一接口（如创建/支付），断言系统是否能正确防重。

---

## 三、 质量准出红线（Quality Gates）

1. **零未捕获崩溃**：单测运行过程不得发生未处理的内存溢出（OOM）、进程崩溃（SIGSEGV）或未捕获的全局异常；
2. **零回归**：新提交的代码改动不得导致历史既有通过用例发生失败。
