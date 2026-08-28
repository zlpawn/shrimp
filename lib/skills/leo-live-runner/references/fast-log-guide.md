# 📘 FAST / Kibana 日志与全链路 Trace 排障参考手册

本手册为 AI 在使用 `leo-live-runner` 进行线上排障时提供底层 ES DSL 语法、Lucene 常用查询模式及排障方法论。

---

## 🧭 常用 Lucene 检索语法速查

| 排查目标 | 推荐 Lucene 语法 | 说明 |
| :--- | :--- | :--- |
| **精确短语匹配** | `"开始执行房源封禁"` | 必须加双引号，避免中文分词导致的全局倒排检索扩散 |
| **接口 URI 过滤** | `data_uri:"/risk/house/ban"` | 精准过滤 HTTP 控制器请求路由 |
| **HTTP 入参/出参** | `data_bltag:request_in` 或 `data_bltag:request_out` | 分别过滤网关层/过滤器记录的真实出入参 JSON |
| **异常堆栈过滤** | `loglevel:ERROR` 或 `logLevel:ERROR` | 抓取业务与框架未捕获异常 |
| **TraceId 追溯** | `"361922-10.22.53.98-4130-1787830157652-8055"` | 全链路还原上游请求至下游 Dubbo/MySQL/Redis 调用链 |
| **多条件组合** | `data_uri:"/order/cancel" AND loglevel:ERROR` | 组合查询特定接口下的报错日志 |

---

## ⚡ 底层查询引擎架构与优化细节

1. **接口直连**：
   * 脚本通过 `ego-browser` 注入环境，直接向 Kibana 网关 `https://fast108-kibana-logcenter-intra.intra.ke.com/internal/search/es` 发起 POST 请求；
   * 请求头必须携带：
     ```json
     {
       "content-type": "application/json",
       "kbn-xsrf": "kibana",
       "kbn-version": "7.7.0"
     }
     ```

2. **跨分片大查询保障 (`wait_for_completion_timeout`)**：
   * 当检索跨多天（如 `48h`、`7d`）日志时，ES 集群并发扫描多达 40+ 个 Shards；
   * 必须在请求参数中设置 `wait_for_completion_timeout: '10s'`，防止 Kibana 在 1 秒时判定为 Async Search 导致前台漏读 Hits 列表。

3. **自学习持久化存储**：
   * 字典统一保存于 `~/.shrimp/skills/live-runner/service_map.json`；
   * 支持全公司任意微服务的首次探针探测与长期缓存复用。
