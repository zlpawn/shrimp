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

### 🌟 双引擎联动自愈架构 (Dual-Engine Self-Healing)
1. **一级通道（Fast-Path 极速直连）**：
   * 已收录的微服务直接向内网 Kibana 网关（如 `https://fast108-kibana-logcenter-intra.intra.ke.com/internal/search/es`）发起原生 HTTP POST；
   * 单次检索耗时仅需 **100~200ms**，日常使用无需拉起浏览器。
   * 请求头必须携带：
     ```json
     {
       "content-type": "application/json",
       "kbn-xsrf": "kibana",
       "kbn-version": "7.7.0"
     }
     ```

2. **二级通道（跨平台双智能自愈探针）**：
   * **🍎 macOS 探针（`ego-browser`）**：自动唤起原生 `ego-browser` 访问 `https://fast.ke.com/#/search` 门户解析最新 cluster 与 index；
   * **🪟 Windows / 通用探针（`Leo Lantern Chrome 扩展`）**：通过本地 `19527` 端口静默借用用户日常 Chrome 提取 cluster 与 index（支持运行 `scripts/setup_chrome_ext.bat` 10 秒一键挂载）；
   * **自动纠错缓存**：探针提取成功后，自动覆写更新本地缓存 `~/.shrimp/skills/live-runner/service_map.json` 并重试直连，实现 **100% 无人干预的自动纠错自愈**。

3. **跨分片大查询保障 (`wait_for_completion_timeout`)**：
   * 当检索跨多天（如 `48h`、`7d`）日志时，ES 集群并发扫描多达 40+ 个 Shards；
   * 必须在请求参数中设置 `wait_for_completion_timeout: '10s'`，防止 Kibana 在 1 秒时判定为 Async Search 导致前台漏读 Hits 列表。

4. **最后人工干预兜底机制 (Last-Resort Fallback)**：
   * **触发前提**：仅当“一级通道（直连）”与“二级通道（跨平台探针自愈）”**全部失败**时，AI 才可提示用户人工提供 `cluster` 域名与 `index` 索引模式；
   * 用户提供后，可直接通过 `node scripts/fast_query.js <index> <query>` 检索，结果会自动固化写入本地缓存，后续无需再次人工输入。
