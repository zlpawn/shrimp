# 🌐 域名环境自动嗅探与分级安全管控规范 (Environment Detection Rules)

在调用 `leo-live-runner` 的任何写操作接口（如 `POST /internal/live-runner/execute`）之前，AI **必须自动识别用户提供的目标域名所属的环境（线上 / 预发 / 测试 / 本地）**，并根据环境危险级别采取分级安全管控策略。

---

## 🔍 1. 域名环境自动识别矩阵 (Pattern Matching Matrix)

AI 需根据用户输入的域名或 IP 地址，执行如下优先级的模式匹配：

| 环境分类 | 匹配规则 / 关键词模式 | 典型域名示例 | 危险等级 |
| :--- | :--- | :--- | :--- |
| 🔴 **生产环境 (PROD)** | 1. 显式包含 `prod`, `online`, `release`<br>2. 属于内网/公网正式域名（如 `*.intra.ke.com`, `*.ke.com`, `*.lianjia.com`），且**全域名中不包含**任何 `preview`/`pre`/`test`/`qa`/`dev`/`staging`/`gray`/`sim`/`beta`/`canary` 等关键字 | `iot.beijia.ke.com`<br>`iot-platform.intra.ke.com`<br>`order-service-prod.ke.com`<br>`api.ke.com` | **🚨 极高 (CRITICAL)** |
| 🟠 **预发/仿真 (PRE / STAGING)** | 1. **全域名任意位置包含 `preview`**（前缀 `preview-`、后缀 `-preview`、子域 `.preview.`、中缀等）<br>2. 包含边界环境词：`pre-`, `-pre`, `.pre.`, `staging`, `sim` (仿真), `gray` (灰度), `beta`, `canary` | `preview-utopia-scs-algo.home.ke.com`<br>`algo-preview.home.ke.com`<br>`utopia.preview.ke.com`<br>`iot-platform-pre.intra.ke.com`<br>`staging.order.ke.com`<br>`sim-scs.intra.ke.com` | **⚠️ 高 (HIGH)** |
| 🟡 **测试环境 (TEST / QA / DEV)** | 包含关键词：`test`, `qa`, `uat`, `fat`, `sit`, `dev`（以 `-`, `.`, `/` 分隔） | `zulin-iot-platform.mvp.ttb.test.ke.com`<br>`iot-platform-test.intra.ke.com`<br>`dev-order.intra.ke.com` | **🟡 中 (MEDIUM)** |
| 🟢 **本地/开发 (LOCAL)** | `localhost`, `127.0.0.1`, 或直接指定私有 IP 端口（如 `10.x.x.x:8080`） | `localhost:8080`<br>`127.0.0.1:9090` | **🟢 低 (LOW)** |

---

## ⚡ 2. 动态运行时探针二次校验 (Active Probing)

若域名规则存在歧义（或用户未显式给出标准域名），AI 可在发起执行前先请求宿主配置接口进行环境探测：

```http
GET http://<user-domain>/internal/live-runner/config
```

* 检查响应体中的环境标识（如 `profiles: ["prod"]` 或响应 Header `X-Env: prod`）；
* 一旦探测到目标包含 `prod` 或 `production`，即刻提升至最高安全等级。

---

## 🛡️ 3. 分级交互与强制确认规范 (Human-in-the-Loop Policies)

### 🔴 A. 生产环境 (PROD) - 极度严格管控
当检测到目标为生产环境时：
1. **源码全量回显**：必须将完整 Java 代码（含全部 SQL、Service 调用）完整打印；
2. **强制事务**：涉及数据库更新的代码必须包含 `@Transactional(rollbackFor = Exception.class)`；
3. **强制生产环境二次确认**：AI 必须使用如下高亮格式警示用户：
   > 🚨 **【高危操作告警 - 目标环境: 线上生产环境 (PROD)】**
   > * **目标域名**：`http://<user-domain>`
   > * **变更范围**：`[说明受影响的表名、数据量或调用的方法]`
   > 
   > ⚠️ **生产环境直接修改数据存在极高业务风险！请您仔细核对上方代码无误后，明确回复“确认在生产环境执行”，我将为您发起调用。**
4. **未收到明确包含“确认”、“生产”等字样的许可，绝对禁止发起调用！**

---

### 🟠 B. 预发环境 (PRE / STAGING) - 强制明确确认
当检测到目标为预发环境时（含 `preview` 或 `pre-` 等特征）：
1. **源码全量回显**：必须完整打印 Java 代码与 SQL 操作范围；
2. **强制预发确认**：AI 必须使用高亮橙色预警并等待用户明确回复：
   > ⚠️ **【重要安全预警 - 目标环境: 预发环境 (PRE/STAGING)】**
   > * **目标域名**：`http://<user-domain>`
   > * **变更范围**：`[说明受影响的表名、数据量或调用的方法]`
   > 
   > ⚠️ **当前操作将直接作用于预发环境，可能影响预发集成测试与压测联调数据！请您仔细核对上方代码无误后，明确回复“确认在预发环境执行”，我将为您发起调用。**
3. **未获得用户明确确认前，绝对禁止发起任何写操作或调用！**

---

### 🟡 C. 测试 / 本地环境 (TEST / LOCAL) - 标准提示
> 🟢 **【目标环境: 测试/本地环境 (TEST/LOCAL)】**
> * **目标域名**：`http://<user-domain>`
> * 请核对上方代码，确认无误后为您发起调用。
