# 跨语言智能过滤预设 (Ignore Presets)

在网络同步场景中，**千万不能无脑同步所有文件**。零散且庞大的依赖文件（如 `node_modules`）或频繁变动的临时文件不仅会严重消耗带宽，还会导致 IDE 全局索引与同步器频繁卡顿。

`leo-workspace-router` 会根据目标工程自动合并以下过滤规则（也可以手动传入自定义规则）：

---

## 1. 基础通用黑名单 (Common / Always Ignored)

无论什么语言，默认必须忽略：
```text
.git/
.svn/
.DS_Store
Thumbs.db
*.tmp
*.log
.idea/
.vscode/
*.swp
```

---

## 2. 编程语言专属预设 (Language Specific)

### Node.js / 前端
```text
node_modules/
.next/
.nuxt/
dist/
build/
.cache/
.npm/
.yarn/
```

### Python
```text
__pycache__/
*.pyc
*.pyo
*.pyd
.venv/
venv/
env/
.pytest_cache/
.mypy_cache/
*.egg-info/
```

### Go
```text
bin/
vendor/
```

### Rust
```text
target/
```

### Java
```text
target/
.gradle/
build/
*.class
*.jar
```

---

## 3. 在 Mutagen 中的注入方式

在创建同步任务时，脚本会自动将预设转化为 `--ignore` 参数：
```bash
--ignore=".git" \
--ignore="node_modules" \
--ignore="__pycache__" \
--ignore=".venv" \
--ignore=".DS_Store" \
--ignore="*.log"
```
确保仅传输关键的业务源码，享受毫秒级传输体验。
