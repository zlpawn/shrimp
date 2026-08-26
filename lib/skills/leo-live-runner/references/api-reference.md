# 📡 Leo Live Runner HTTP 接口完整规范与协议说明

所有接口默认挂载在宿主服务的 `/internal/live-runner` 前缀下。

---

## 🔐 1. 安全认证与 SPI 插件机制

框架支持通过 `LiveRunnerAccessValidator` SPI 接口进行自定义权限校验（如 JWT、SSO、IP 白名单、自定义 Header 等）。

- **未配置自定义 Validator**：默认走 `DefaultWarnAccessValidator`，打印 WARN 告警日志并默认放行（便于开发调试）；
- **已配置自定义 Validator**：按自定义规则校验请求头、客户端 IP 或 Token。请求时可根据业务自定义规则携带对应 Header（如 `Authorization: Bearer <token>` 或 `X-Admin-Token: <secret>`）。

---

## 📦 2. 统一扁平企业响应结构 (`LiveRunnerResponse<T>`)

所有接口统一返回标准 JSON 结构：

```json
{
  "code": 200,
  "success": true,
  "data": { ... },
  "msg": "执行日志或错误堆栈",
  "costMs": 18
}
```

### 字段说明：
- **`code`** (`int`): HTTP / 业务状态码（`200` 成功，`500` 业务/SQL异常或超时，`403` 鉴权失败，`404` 脚本未找到）；
- **`success`** (`boolean`): 是否执行成功（`true` / `false`）；
- **`data`** (`Object`): 动态 Java 方法 return 的真实对象（支持 Map、List、POJO 实体、String、Number、null 等）；
- **`msg`** (`String`): `LiveLogger`（`log.println`）捕获的完整执行步骤排障日志，或发生异常时的错误信息 + 完整异常堆栈；
- **`costMs`** (`long`): 本次执行的真实耗时（毫秒）。

---

## 🚀 3. 核心接口详细列表

### 3.1 一键即写即跑 (`POST /internal/live-runner/execute`) ⭐⭐⭐⭐⭐
> **生产多 Pod 集群首选**：一次请求同时携带源码与参数，当场编译、执行、卸载并返回日志。天然免疫负载均衡（SLB）多 Pod 分发问题！

- **URL**: `POST http://<user-domain>/internal/live-runner/execute`
- **Query 参数 (可选)**:
  - `method` (`string`, 可选): 指定调用的方法名（不传则自动识别单方法或 `run`/`execute`）；
  - `timeout` (`int`, 可选): 超时时间（秒，默认 60）；
- **请求体 (JSON)**:
```json
{
  "scriptSource": "package com.leo.dynamic;\nimport io.github.zlpawn.liverunner.core.LiveLogger;\nimport org.springframework.jdbc.core.JdbcTemplate;\nimport org.springframework.transaction.annotation.Transactional;\npublic class OneShotTask {\n    private JdbcTemplate jdbcTemplate;\n    @Transactional(rollbackFor = Exception.class)\n    public Object run(String orderId, LiveLogger log) {\n        log.println(\">>> 开始修复订单: \" + orderId);\n        int rows = jdbcTemplate.update(\"UPDATE t_order SET status = 2 WHERE id = ?\", Long.parseLong(orderId));\n        log.println(\">>> 影响行数: \" + rows);\n        return \"SUCCESS_UPDATED_\" + rows;\n    }\n}",
  "params": {
    "orderId": "1001"
  }
}
```
- **响应体 (JSON)**:
```json
{
  "code": 200,
  "success": true,
  "data": "SUCCESS_UPDATED_1",
  "msg": ">>> 开始修复订单: 1001\n>>> 影响行数: 1\n",
  "costMs": 28
}
```

---

### 3.2 注册动态代码 (`POST /internal/live-runner/register`)
> 预热并编译源码，以 `scriptKey` 为唯一标识常驻内存，不立即执行。适合作为长期动态 API 服务。

- **URL**: `POST http://<user-domain>/internal/live-runner/register`
- **请求体 (JSON)**:
```json
{
  "scriptKey": "order-api",
  "scriptSource": "package com.leo.dynamic;\npublic class OrderApi {\n    public Object query(String id) { return \"STATUS_OK\"; }\n    public Object cancel(String id) { return \"CANCEL_OK\"; }\n}",
  "remark": "订单动态 API 族"
}
```
- **响应体 (JSON)**:
```json
{
  "code": 200,
  "success": true,
  "data": {
    "scriptKey": "order-api",
    "version": 1,
    "md5": "e10adc3949ba59abbe56e057f20f883e",
    "availableMethods": ["query", "cancel"],
    "compileCostMs": 142
  },
  "msg": "Script registered successfully",
  "costMs": 142
}
```

---

### 3.3 调用动态代码 (`POST /internal/live-runner/invoke/{scriptKey}`)
> 调用单方法类或默认 `run`/`execute` 方法。直接传递纯业务 JSON 参数。

- **URL**: `POST http://<user-domain>/internal/live-runner/invoke/order-api`
- **请求体 (JSON)**:
```json
{
  "orderId": "1001",
  "targetStatus": "PAID"
}
```
- **响应体 (JSON)**:
```json
{
  "code": 200,
  "success": true,
  "data": {
    "orderId": "1001",
    "status": "PAID"
  },
  "msg": ">>> Step 1: 订单已更新\n",
  "costMs": 12
}
```

---

### 3.4 二级子路径调用指定方法 (`POST /internal/live-runner/invoke/{scriptKey}/{methodName}`)
> 精确调用动态类中的具体 public 方法（如 `query`, `update`, `cancel`）。

- **URL**: `POST http://<user-domain>/internal/live-runner/invoke/order-api/query`
- **请求体 (JSON)**:
```json
{
  "id": "1001"
}
```
- **响应体 (JSON)**:
```json
{
  "code": 200,
  "success": true,
  "data": "STATUS_OK",
  "msg": "SUCCESS",
  "costMs": 8
}
```

---

### 3.5 查看内存中已注册脚本列表 (`GET /internal/live-runner/list`)
- **URL**: `GET http://<user-domain>/internal/live-runner/list`
- **响应体 (JSON)**:
```json
{
  "code": 200,
  "success": true,
  "data": [
    {
      "scriptKey": "order-api",
      "version": 1,
      "md5": "e10adc3949ba59abbe56e057f20f883e",
      "remark": "订单动态 API 族",
      "registerTime": "2026-08-21T00:00:00.000+08:00",
      "lastInvokeTime": "2026-08-21T00:05:12.000+08:00",
      "invokeCount": 15
    }
  ],
  "msg": "SUCCESS",
  "costMs": 0
}
```

---

### 3.6 彻底卸载与释放 Metaspace 内存 (`DELETE /internal/live-runner/unregister/{scriptKey}`)
- **URL**: `DELETE http://<user-domain>/internal/live-runner/unregister/order-api`
- **响应体 (JSON)**:
```json
{
  "code": 200,
  "success": true,
  "data": null,
  "msg": "Script unregistered and ClassLoader unloaded.",
  "costMs": 0
}
```
