# 🛡️ Leo Live Runner 动态代码安全沙箱规约手册

动态执行引擎在编译前内置了细粒度、单一职责的 **六大安全规则族（参考 Alibaba Druid WallFilter 标准）**。
AI 在生成动态代码时，必须严格遵守以下安全红线，否则会被引擎在编译前秒级阻断（Fail-Fast）。

---

## 1. 🗄️ SQL DML 安全规则 (`SqlSafetyRule`)
* **强制 WHERE 条件**：`UPDATE` 和 `DELETE` 语句必须显式携带具体的 `WHERE` 条件，严禁全表更新或全表物理删除。
* **严禁恒真注入**：严禁出现 `1=1`、`'1'='1'`、`'a'='a'`、`OR 1=1` 等恒真逃逸语句。
* **SELECT 分页建议**：对于无 `WHERE` 条件的 `SELECT` 语句，必须携带 `LIMIT` 分页限制。

---

## 2. 🧱 SQL DDL 严禁规约 (`SqlDdlSafetyRule`)
* **严禁库表删除与清空**：严禁生成 `DROP DATABASE`、`DROP TABLE`、`DROP INDEX`、`TRUNCATE TABLE`。
* **严禁结构与索引变更**：严禁生成 `ALTER TABLE`、`CREATE INDEX`、`DROP INDEX`、`RENAME TABLE`。
* **严禁权限与用户篡改**：严禁生成 `GRANT`、`REVOKE`、`CREATE USER`、`DROP USER`。

---

## 3. 🔴 Redis 高危操作禁令 (`RedisSafetyRule`)
* **严禁阻塞单线程**：严禁使用 `KEYS *` 或 `.keys(...)`，必须改用 `SCAN` 或精确 key 查找。
* **严禁缓存清空与停机**：严禁执行 `FLUSHALL`、`FLUSHDB`、`SHUTDOWN`。
* **严禁篡改配置与拓扑**：严禁执行 `CONFIG SET`、`CONFIG REWRITE`、`SLAVEOF`、`REPLICAOF`、`MONITOR`。

---

## 4. 🌱 Spring 容器与配置保护 (`SpringConfigSecurityRule`)
* **严禁篡改 Environment**：禁止调用 `ConfigurableEnvironment.getPropertySources().remove(...)`、`addFirst(...)` 等。
* **严禁恶意销毁 Bean**：禁止调用 `DefaultListableBeanFactory.destroySingleton(...)`、`removeBeanDefinition(...)`。
* **严禁篡改系统属性**：禁止调用 `System.setProperty(...)`、`System.clearProperty(...)`。
* **严禁关闭上下文**：禁止调用 `ApplicationContext.close()`、`stop()`、`refresh()`。

---

## 5. 💻 系统与 JVM 进程安全 (`SystemSecurityRule`)
* **严禁退出 JVM**：禁止调用 `System.exit(...)`。
* **严禁系统命令执行**：禁止调用 `Runtime.getRuntime().exec(...)` 或 `ProcessBuilder`。
* **严禁底层 Unsafe 逃逸**：禁止引入或使用 `sun.misc.Unsafe` / `jdk.internal.misc.Unsafe`。
* **严禁篡改 SecurityManager**：禁止调用 `System.setSecurityManager(...)`。

---

## 6. 🧵 线程与死锁安全 (`ThreadSecurityRule`)
* **严禁暴力杀死线程**：禁止调用 `Thread.stop()` 或 `Thread.currentThread().stop()`，防止监视锁损坏。
* **严禁挂起线程**：禁止调用 `Thread.suspend()` 或 `Thread.resume()`，防止死锁。
