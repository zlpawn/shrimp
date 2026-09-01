# ⚙️ Apollo 配置中心极速直连探查参考手册 (Apollo Config Guide)

本手册为 AI 在使用 `leo-live-inspector` 进行线上配置探查、开关核验与参数排障时提供底层接口协议与实战指导。

---

## 🌐 1. 底层 HTTP 接口协议规范

Apollo 客户端在拉取配置时，本质上是通过纯 HTTP REST 接口与 **Apollo ConfigService** 通信。AI 可直接调用该接口免鉴权读取微服务的全量实时配置，响应耗时通常 < 100ms。

### 核心接口 1：JSON 配置字典接口（最推荐 ⭐⭐⭐⭐⭐）
```http
GET http://apollo.configservice.life.ke.com/configfiles/json/{appId}/{cluster}/{namespace}
```

* **URL 参数说明**：
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
GET http://apollo.configservice.life.ke.com/configs/{appId}/{cluster}/{namespace}
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
