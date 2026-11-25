# 业务“假成功”拦截规则与契约字典 (Fake Success Rules)

前后端分离架构中，前端常因仅判断 HTTP 状态码为 200，而忽略了响应体内部的业务错误码，导致页面弹出“操作成功”虚假提示，给用户造成数据已保存的假象。

`leo-code-qa` 在执行网络抓包核验（端 2）时，必须针对 HTTP 200 的响应体进行深度业务码比对。

---

## 一、 常见业务假成功判定模式

当 HTTP 响应状态码为 `200 OK` 时，若响应体 JSON 满足以下任意特征，**必须判定为【接口假成功（Fake Success）Bug】**：

### 1. 标准 Code 字段异常
- `code` 不等于 `0`、`200`、`"0"`、`"200"`、`"OK"`、`"SUCCESS"`：
  ```json
  // 假成功示例
  {
    "code": 50001,
    "msg": "数据库写入异常：Duplicate entry 'test' for key 'PRIMARY'",
    "data": null
  }
  ```
- `status` 字段显式包含失败语义：
  - `status: "error"` / `status: "failed"` / `status: false`
- `success` 布尔字段为 `false`：
  ```json
  // 假成功示例
  {
    "success": false,
    "errorCode": "BIZ_RULE_ERROR",
    "errorMessage": "当前账户余额不足"
  }
  ```

### 2. GraphQL 局部异常（200 OK with errors）
- 响应根节点包含 `errors` 数组且长度大于 0：
  ```json
  {
    "data": null,
    "errors": [
      { "message": "Cannot return null for non-nullable field", "path": ["createUser"] }
    ]
  }
  ```

### 3. 空包或降级兜底假象
- 接口返回 HTTP 200，但数据体为空对象 `{}` 或关键主键为 `null`（如新建资源接口未返回新生成的 `id`）。
- 接口返回网关/网关超时兜底 HTML 页面（如包含 `<html><title>502 Bad Gateway</title>...</html>`，但 Content-Type 被误标或状态码返回 200）。

---

## 二、 假成功缺陷记录标准

当捕获到假成功时，缺陷报告必须严格提取以下四项证据：
1. **接口 URL 与 Method**：如 `POST /api/v1/users`
2. **请求 Payload**：发送的关键业务参数
3. **HTTP 状态码 vs 响应体实际内容**：强调 `HTTP 200` 与响应体内 `code: 50001, msg: "..."` 的矛盾
4. **前端界面表现**：记录页面是否错误地展示了绿色“成功”Toast 或进行了页面跳转
