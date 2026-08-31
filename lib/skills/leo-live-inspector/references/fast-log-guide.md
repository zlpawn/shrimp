# 📘 FAST / Kibana 日志与全链路 Trace 排障参考手册

本手册为 **AI Agent** 在执行线上排障时提供底层 ES DSL 语法、意图参数组装及排障方法论。

---

## 🧭 AI 内部调用意图映射速查

AI 在接收到用户自然语言排查需求时，自动在后台组装以下参数静默执行：

| 用户自然语言场景 | AI 后台自动组装与执行的指令 | 内部检索逻辑与 DSL |
| :--- | :--- | :--- |
| **查最新实时日志** | `node scripts/fast_query.js -a iot-platform -t 15m -n 10` | `sort: [{ timestamp: { order: "desc" } }]` |
| **精准定位异常堆栈** | `node scripts/fast_query.js -a utopia-scs-saas --level ERROR -t 1h` | 自动匹配 `(loglevel:ERROR OR logLevel:ERROR OR level:ERROR)` |
| **TraceId 全生命周期回溯** | `node scripts/fast_query.js -a iot-platform --traceId "361922-..."` | 自动升序 `sort: [{ timestamp: { order: "asc" } }]` 并扩充 48h 跨度 |
| **接口入参/出参抓取** | `node scripts/fast_query.js -a iot-platform --uri "/api/sync/lock" --bltag request_out` | 过滤 `data_uri:"/api/sync/lock" AND data_bltag:request_out` |
| **精确历史时段排障** | `node scripts/fast_query.js -a iot-platform --from "2026-08-31 14:00:00" --to "2026-08-31 14:30:00"` | 精确过滤 `timestamp` 范围 |
| **超长报文与堆栈瘦身** | `node scripts/fast_query.js -a iot-platform '*' 1h 20 --slim` | 截断超出 260 字符的超长 JSON |

---

## ⚡ 底层查询引擎架构与自愈细节

### 🌟 双引擎联动自愈架构 (Dual-Engine Self-Healing)
1. **一级通道（Fast-Path 极速直连）**：
   * 已收录的微服务直接向内网 Kibana 网关（如 `https://fast108-kibana-logcenter-intra.intra.ke.com/internal/search/es`）发起原生 HTTP POST；
   * 单次检索耗时仅需 **100~200ms**，日常使用无需拉起浏览器。
   * 请求头携带：
     ```json
     {
       "content-type": "application/json",
       "kbn-xsrf": "kibana",
       "kbn-version": "7.7.0"
     }
     ```

2. **二级通道（跨平台双智能自愈探针）**：
   * **🍎 macOS 探针（`ego-browser`）**：自动唤起原生 `ego-browser` 访问 `https://fast.ke.com/#/search` 门户解析最新 cluster 与 index；
   * **🪟 Windows / 通用探针（`Leo Lantern Chrome 扩展`）**：通过本地 `19527` 端口静默借用用户日常 Chrome 提取 cluster 与 index；
   * **自动纠错缓存**：探针提取成功后，自动覆写更新本地缓存 `~/.shrimp/skills/live-runner/service_map.json` 并重试直连，实现 **100% 全自动无人干预自愈**。

3. **排序与时序保障 (`sort`)**：
   * 查日志默认倒序 `desc`，拿到最新事件；
   * 查 TraceId 自动正序 `asc`，保障 AI 能顺畅提取步骤并绘制准确的 Mermaid 时序交互图。
