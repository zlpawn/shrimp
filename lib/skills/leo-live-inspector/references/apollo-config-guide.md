# ⚙️ Apollo 配置中心极速直连探查参考手册 (Apollo Config Guide)

本手册为 AI 在使用 `leo-live-inspector` 进行线上配置探查、开关核验与参数排障时提供底层接口协议与实战指导。

---

## 🌐 1. 底层 HTTP 接口协议与多环境地址矩阵

Apollo 客户端在拉取配置时，本质上是通过纯 HTTP REST 接口与目标环境的 **Apollo ConfigService** 通信。AI 可直接调用该接口免鉴权读取微服务的全量实时配置，响应耗时通常 < 100ms。

### 🏢 全环境官方 ConfigService 服务端地址矩阵

| 环境分类 | 环境标识 (`--env`) | Apollo ConfigService 根地址 | 说明 |
| :--- | :--- | :--- | :--- |
| 🟡 **测试环境 (TEST)** | `test` / `qa` | `http://test.config.apollo.ke.com` | 测试环境微服务实时配置中心 |
| 🟠 **预发环境 (PREVIEW)** | `preview` / `prev` / `pre` | `http://prev.config.apollo.ke.com` | 预发/仿真环境微服务配置中心 |
| 🔴 **生产环境 (PROD)** | `prod` (默认) | `http://prod.config.apollo.ke.com`<br>*(备用: `http://apollo.configservice.life.ke.com`)* | 线上生产正式配置中心 |
| 🟢 **开发环境 (DEV)** | `dev` | `http://dev.config.apollo.ke.com` | 本地与开发联调配置中心 |

---

### 核心接口 1：JSON 配置字典接口（最推荐 ⭐⭐⭐⭐⭐）
```http
GET {apolloServer}/configfiles/json/{appId}/{cluster}/{namespace}
```

* **URL 参数说明**：
  * `{apolloServer}`: 根据目标环境选择对应的 ConfigService 地址（如测试环境为 `http://test.config.apollo.ke.com`）；
  * `{appId}`: 微服务的唯一应用 ID（如 `zulin-iot-platform`, `utopia-scs-saas`）；
  * `{cluster}`: 集群名称，默认传入 `default`；
  * `{namespace}`: 命名空间，默认多为 `application` 或 `application.properties`，若有自定义命名空间可直接传入。
* **响应格式**：直接返回扁平 key-value JSON 对象：
  ```json
  {
    "lockAuth.fingerprintCheckSwitch": "true",
    "spring.redis.timeout": "2000",
    "whitelist.ucIds": "[31534062, 31101553]"
  }
  ```

---

### 核心接口 2：Apollo 元数据完整接口
```http
GET {apolloServer}/configs/{appId}/{cluster}/{namespace}
```
* **响应格式**：包含发布 releaseKey、集群名与配置字典：
  ```json
  {
    "appId": "zulin-iot-platform",
    "cluster": "default",
    "namespaceName": "application",
    "configurations": { ... },
    "releaseKey": "20260828193021-..."
  }
  ```

---

## 🚀 2. 脚本快速调用指南 (`scripts/apollo_query.js`)

AI 或用户可直接执行本地脚本进行秒级探查（**内置智能别名与模糊匹配，支持口语化简称**）：

```bash
# 格式: node scripts/apollo_query.js <appId|alias> [namespace|keyKeyword] [keyKeyword] [options]

# 1. 口语化简称自动映射 (如 platform 自动解析为 zulin-iot-platform, saas 解析为 utopia-scs-saas)
node scripts/apollo_query.js platform lockAuth
node scripts/apollo_query.js saas timeout
node scripts/apollo_query.js iot lockVersion
node scripts/apollo_query.js warehouse

# 2. 查询服务全部配置项 (自动扫描 application 与 application.properties 并智能去重)
node scripts/apollo_query.js zulin-iot-platform

# 3. 模糊检索指定配置项 (如查找白名单、超时时间、动态开关)
node scripts/apollo_query.js zulin-iot-platform lockAuth
node scripts/apollo_query.js utopia-scs-saas timeout
node scripts/apollo_query.js zulin-iot-platform switch

# 3. 指定命名空间检索
node scripts/apollo_query.js zulin-iot-platform application.properties weitang

# 4. 以纯 JSON 格式输出 (供自动化脚本解析)
node scripts/apollo_query.js zulin-iot-platform lockAuth --json
```

---

## 🎯 3. 常见运维排障场景

| 排障目标 | 推荐检索关键词 | 典型排查场景 |
| :--- | :--- | :--- |
| **业务开关状态** | `switch`, `enabled`, `open` | 确认新功能开关是否已推送到线上，是否仍处于关闭状态 |
| **白名单/灰度名单** | `white`, `whitelist`, `gray` | 确认特定用户、工号或门店是否在灰度/白名单中 |
| **超时与重试配置** | `timeout`, `retry`, `feign` | 排查接口 504 / Read Timeout 是否由于 Feign/Ribbon 超时设置过短 |
| **连接池与线程池** | `max-active`, `pool`, `threads` | 核对数据库连接池与线程池当前静态配置容量 |
| **第三方接口鉴权** | `app-id`, `secret`, `url` | 核验外部供应商对接域名与 AppId 是否配置正确 |

---

## 🛠️ 4. 【测试环境】Apollo 配置动态修改与两阶段发布协议 (`scripts/apollo_modify.js`)

测试环境中，微服务常常需要临时修改开关、白名单或联调参数。为避免手动登录控制台的繁琐流程，同时杜绝误改串改隐患，`leo-live-inspector` 提供了高可靠的配置写入与两阶段发布能力。

### 4.1 底层 REST 接口协议 (Portal 内部直连)
* **Portal 门户地址**：`http://test-apollo.portal.life.ke.com`
* **更新/新增配置项**：
  ```http
  PUT /apps/{appId}/envs/TEST/clusters/{clusterName}/namespaces/{namespaceName}/item
  Content-Type: application/json;charset=UTF-8
  Cookie: jt_apollo_login_token={token}

  {
    "key": "liveRunner.access.ucIdWhitelist",
    "value": "[31534062,12]",
    "comment": "AI 辅助更新配置",
    "tableViewOperType": "update"
  }
  ```
* **发布生效 (Release)**：
  ```http
  POST /apps/{appId}/envs/TEST/clusters/{clusterName}/namespaces/{namespaceName}/releases
  Content-Type: application/json;charset=UTF-8
  Cookie: jt_apollo_login_token={token}

  {
    "releaseTitle": "20260904...-release",
    "releaseComment": "AI 自动化发布: 业务开关修改",
    "releaseAttribute": "3"
  }
  ```
  > ⚠️ **发布属性 (`releaseAttribute`) 规范**：
  > - `1`: 业务变更 (CHANGE)
  > - `2`: 业务降级 (DEGRADE)
  > - `3`: **业务开关 (SWITCH)** ➔ **系统默认且强制推荐值**，用于控制功能开关、降级开关与白名单。

### 4.2 严格风控闭环与使用规范
1. **阶段 1：安全预览 (Pre-flight / Dry-Run)**
   ```bash
   node scripts/apollo_modify.js iot liveRunner.access.ucIdWhitelist "[31534062,12]"
   ```
   - 脚本自动拉取微服务所有命名空间，精准定位目标 Key；
   - 对比当前线上旧值与目标新值，输出 Diff 差异对比；
   - **AI 必须暂停并等待用户明确确认**。
2. **阶段 2：执行发布 (Commit / Post-flight)**
   ```bash
   node scripts/apollo_modify.js iot liveRunner.access.ucIdWhitelist "[31534062,12]" --confirm
   ```
   - 带 `--confirm` 参数提交变更；
   - 创建发布单（属性固定为业务开关 SWITCH）；
   - 自动直连 `http://test.config.apollo.ke.com` 回查 ConfigService 确认热生效。
3. **凭证管理与自愈**：
   - 核心 Cookie：`jt_apollo_login_token`（作用域 `test-apollo.portal.life.ke.com`）；
   - 自动读取 `~/.shrimp/skills/live-inspector/test_apollo_cookie.json`；
   - 失效时指引用户使用 Chrome 扩展 **Leo cookie.txt Locally** 复制 `jt_apollo_login_token`。严禁引导安装 `ego-browser`。

---

## 🛡️ 5. 【生产环境】配置变更参谋模式实战指南 (Production Change Advisor)

生产环境的 Apollo 配置变更直接决定微服务链路的稳定性和线上业务资产安全。本节规范 AI 作为**“高阶参谋助手”**协助工程师完成线上配置变更的标准操作程序（SOP）。

### 5.1 铁律：生产环境零直写 (Zero Direct Mutation)
* **原则**：AI 绝对禁止以任何自动化脚本或 HTTP 写接口直接篡改或发布生产配置。
* **原因**：
  1. **避免绕过审批与风控审计**：生产 Apollo 发布受到工单绑定、变更窗口以及权限分级等规范约束；
  2. **避免越权与资损**：任何生产超时截断、重试爆炸或白名单污染均可直接引发线上重大事故。

### 5.2 参谋标准产物：《线上配置变更建议单》
当收到用户的线上配置修改诉求时，AI 先通过 `node scripts/apollo_query.js <app> <key>` 探查出当前最新配置，随后输出包含以下要素的标准建议书：
1. **元信息定位**：清晰标明目标应用 (`appId`)、集群 (`default`) 与所属命名空间 (`namespaceName`)；
2. **可视 Diff 对比**：展示【当前线上值 vs 建议目标值】的清晰比对；
3. **发布属性建议**：优先推荐【业务开关 (SWITCH, 3)】，符合生产审计要求；
4. **风险排雷与影响评估**：校验 JSON 语法、评估下游调用链与回退可行性；
5. **官方 Portal 命名空间直达链接 (Deep-Link)**：
   ```text
   http://apollo.portal.life.ke.com/#/appid={appId}&env=PROD&cluster=default&namespace={namespace}
   ```
   *用户只需一键点击，免去在控制台复杂微服务列表中寻找具体 Namespace 的时间。*
