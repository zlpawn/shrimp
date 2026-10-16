# gallery-dl 进阶能力与参数速查指南

## 1. 工具生命周期管理 (uv tool)

根据项目规范（`lib/skills/README.md` 原则 2），全面使用 `uv tool` 独立沙箱管理 `gallery-dl`：

- **安装**：`uv tool install gallery-dl`
- **升级 / 自愈**：`uv tool upgrade gallery-dl`
- **版本检查**：`gallery-dl --version`

---

## 2. 核心探测与模拟 (Inspect & Simulate)

- `gallery-dl --simulate "URL"`：模拟提取过程，打印将要下载的图片直链与文件名，**不执行实际磁盘写入**。
- `gallery-dl --extractor-info "URL"`：输出该 URL 匹配的提取器类、支持的配置项与元数据键。
- `gallery-dl --list-keywords "URL"`：列出该提取器提供的所有动态命名占位符（如 `author`, `id`, `title`, `page` 等）。

---

## 3. 下载目的地与命名模板

- **基础输出目录**：
  ```powershell
  gallery-dl --dest "D:\素材\图片" "URL"
  ```
- **自定义目录与文件名格式**（通过 `--filename` 和 `--directory`）：
  ```powershell
  # 按照分类/作者/标题 自动建目录归档
  gallery-dl --directory "{category}/{user[name]}/{title}" --filename "{num:>02}_{filename}.{extension}" "URL"
  ```

---

## 4. 增量下载与去重 (Deduplication)

- **下载记录归档文件**：
  ```powershell
  gallery-dl --download-archive "D:\素材\图片\archive.sqlite3" "URL"
  ```
  已记录在 archive 中的项目将自动跳过，实现无人值守的定时增量备份。

---

## 5. 过滤与范围控制

- **按数量限制**：`--range 1-20`（仅下载前 20 张）。
- **条件过滤**（`--filter`）：
  - 过滤宽画幅高清大图：`--filter "width >= 1920 and height >= 1080"`
  - 按发布日期过滤：`--filter "date >= '2026-01-01'"`
  - 过滤特定扩展名：`--filter "extension in ('jpg', 'png')"`
- **章节/分P过滤**（漫画类站点）：`--chapter-filter "chapter in range(1, 10)"`

---

## 6. 元数据与 Sidecar 保存

- **保存独立元数据文件**：`--write-metadata`（将描述、标签、作者、点赞等导出为 JSON/EXIF/Ugoira 信息）。
- **保留原始时间戳**：`--mtime`（将本地文件修改时间设置为作品在服务器的发布时间）。
