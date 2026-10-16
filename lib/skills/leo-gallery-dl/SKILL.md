---
name: leo-gallery-dl
description: 使用 gallery-dl 进行海量画廊、漫画、插画相册、画师主页、社交媒体帖子图集的高清批量下载与增量归档。集成 uv tool 工具链实现极速安装与自动升级，无缝联动 leo-lantern 浏览器插件导出 Cookie 解锁私密与会员内容，支持先模拟探测后规划执行。当用户提出下载图集、相册、漫画、插画原图或修复 gallery-dl 报错时触发。
---

# Leo gallery-dl 图像相册采集与归档技能

本技能负责各类图集、插画相册、画师主页、漫画及社交媒体帖子图片的高清批量采集与结构化归档，全面采用 `uv tool` 独立沙箱管理，并无缝集成 `leo-lantern` 浏览器插件实现无感登录态打通。

---

## 1. 环境就绪与版本自愈 (uv tool)

遵循项目开发规范（`lib/skills/README.md` 原则 2），采用 `uv tool` 独立管理 `gallery-dl`：

- **版本检查**：
  ```powershell
  gallery-dl --version
  ```
- **安装工具**（未安装时执行）：
  ```powershell
  uv tool install gallery-dl
  ```
- **版本自愈（Self-Healing）**：
  - 触发条件：网站反爬规则更新、解析器报错（如 `No suitable extractor` 或 `HTTP 403 Forbidden`）或上游站点接口变动时。
  - 修复命令：
    ```powershell
    uv tool upgrade gallery-dl
    ```

---

## 2. 默认策略 (Defaults)

- **默认存储根目录**：`D:\素材\图片`（或按用户具体任务指定的存放路径）。
- **画质策略**：优先拉取平台提供的**原始无损/最高分辨率原图**，而非网页展示预览图。
- **流程规范**：遵循**先探测模拟、后规划、再执行**原则（尤其针对图集数量未知、画师主页或大批量相册时）。
- **去重与增量**：支持并推荐使用 `--download-archive` 避免重复下载已有资源。
- **元数据保留**：按需生成侧车元数据（`--write-metadata`），保留作品信息与标签。
- **安全红线**：严禁在终端输出或对话中打印 Cookie 的敏感凭据。

---

## 3. Cookie 与登录态联动 (Leo Lantern 闭环)

针对 Pixiv、Twitter/X、Instagram、Danbooru、微博等需要登录、年龄验证（R18）或会员权限的站点，优先联动 `leo-lantern` 导出 Chrome 当前登录态：

1. **自动导出指定站点 Cookie**：
   ```powershell
   # 导出 Twitter/X Cookie
   node D:\agent-transfer\lib\skills\leo-lantern\scripts\cli\index.mjs cookies --domain x.com --format txt --out "D:\素材\图片\_cookies\x.com.txt"

   # 导出 Pixiv Cookie
   node D:\agent-transfer\lib\skills\leo-lantern\scripts\cli\index.mjs cookies --domain pixiv.net --format txt --out "D:\素材\图片\_cookies\pixiv.net.txt"

   # 导出 微博 Cookie
   node D:\agent-transfer\lib\skills\leo-lantern\scripts\cli\index.mjs cookies --domain weibo.com --format txt --out "D:\素材\图片\_cookies\weibo.com.txt"
   ```

2. **带 Cookie 执行采集**：
   ```powershell
   gallery-dl --cookies "D:\素材\图片\_cookies\<domain>.txt" --dest "D:\素材\图片" "URL"
   ```

---

## 4. 探测与规划流程 (Inspect First)

在批量下载（尤其是画师全部作品、大型漫画章节、主页帖子）前，先进行模拟探测：

```powershell
# 1. 模拟运行（不下载任何图片，只输出预估的直链和文件名列表）
gallery-dl --simulate "URL"

# 2. 查看提取器详细信息与参数支持
gallery-dl --extractor-info "URL"
```

向用户明确展示计划：
- 识别到的站点与提取器类型
- 预估抓取的图集/图片数量
- 目标存放目录与分类命名规则
- 是否需要 Cookie 或过滤条件

---

## 5. 常用命令模板

### (1) 单张/单个作品图集原图下载
```powershell
gallery-dl --dest "D:\素材\图片" "URL"
```

### (2) 画师主页/大型画廊增量下载（带去重与目录结构）
```powershell
gallery-dl --dest "D:\素材\图片" `
  --download-archive "D:\素材\图片\archive.sqlite3" `
  --write-metadata `
  --mtime `
  "URL"
```

### (3) 带登录态的批量抓取
```powershell
gallery-dl --cookies "D:\素材\图片\_cookies\target_cookies.txt" `
  --dest "D:\素材\图片" `
  --download-archive "D:\素材\图片\archive.sqlite3" `
  "URL"
```

### (4) 限制范围与条件过滤
```powershell
# 仅下载最新的 10 篇帖子/作品
gallery-dl --range 1-10 --dest "D:\素材\图片" "URL"

# 过滤仅下载大于 2000px 宽度的原画
gallery-dl --filter "width >= 2000" --dest "D:\素材\图片" "URL"
```

---

## 6. 配置文件管理 (`gallery-dl.conf`)

当需要固化复杂的多站点配置、代理、全局请求头或自定义文件名模板时，推荐在 `D:\素材\图片\gallery-dl.conf` 维护配置，并通过 `--config` 载入：

```powershell
gallery-dl --config "D:\素材\图片\gallery-dl.conf" "URL"
```
