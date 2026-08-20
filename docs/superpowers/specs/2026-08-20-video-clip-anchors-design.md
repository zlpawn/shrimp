# 视频片段锚点与集合设计

## Goal

把视频知识库从「单条视频的转写/检索库」补成可复用的媒体中台：视频按集合圈定，知识点通过片段锚点指向本地视频的一段时间，任意工具页用同一个底部播放条 seek 到该片段。易经六十四卦是第一个消费者，不是这套能力的全部。

## Background

现有视频知识库已经能：下载并保留本地视频/音频、Whisper 转写（带时间戳）、分块、向量入库、按 `video_id` 检索、按类型提供整文件资产。缺失两件通用事：

1. 入库没有集合字段。检索只能搜全部或单条视频，无法圈出 `iching-up` 这类系列。
2. 没有「知识点 ↔ 视频片段」层。工具页无法稳定问「这个对象对应哪一段」，只能临时全文检索，卦名单字误伤严重。

易经详情页需要的是：一集连讲很多卦时，按「先卦辞、后每一爻」挂讲解切片，点卡片后在本地视频上 seek 播放该段。课程、笔记等后续场景应走同一套锚点和播放器。

## Out of scope

- 自动为 64 卦生成全部锚点并上线为默认解说
- 让模型改写 UP 主口播成为新的卦解/课文
- 页内逐字卡拉 OK 字幕
- 多集合交叉检索、占卜式现搜
- 在详情页重做一套 B 站播放器；B 站只在本地视频缺失时作为退路
- 服务端裁剪出独立片段文件；第一期用完整本地文件 + 前端 seek
- 把经文写进锚点表，或把锚点写进 `iching-data.ts`

## Architecture

三层，互不拥有对方的领域对象：

```
工具页（易经 / 以后的笔记、课程）
        │  查询 object_type + object_id + collection
        ▼
锚点层  clip-anchors（知识点 ↔ 片段）
        │  video_id + start/end
        ▼
媒体层  video-kb（集合、转写、chunk、本地文件）
        │
        ▼
播放层  共用底部播放条（打开本地视频，seek 到 start，到 end 停）
```

- 媒体层继续只认识视频。
- 锚点层只认识出处，不认识卦辞原文。
- 播放层只认识「请播这个片段」，不认识是哪一卦。

## 1. 媒体层：集合

### 数据

`lib/video-kb/meta-store.mjs` 的 `videos` 表新增：

- `collection TEXT NOT NULL DEFAULT 'default'`

向量 chunk 同步写入 `collection`，便于按集合过滤检索。旧视频没有集合时归入 `default`，用现有 `ensureColumn` 方式迁移，不做破坏性重建。

集合 ID 规则：小写字母、数字、连字符，例如 `iching-up`、`rust-course`。第一期一个视频只属于一个集合。

### API / UI

- `POST /v1/video-kb/ingest` 增加 `collection`；面板入库表单增加集合输入，可复用最近用过的值。
- `GET /v1/video-kb/videos?collection=` 可过滤。
- `POST /v1/video-kb/search` 增加 `collection`；与现有 `video_id` 可同时用，两者都是收窄条件。
- `PATCH /v1/video-kb/videos/:id` 允许改集合。

没有 `collection` 的请求保持旧行为（搜全部），避免破坏现有检索页。易经讲解检索必须显式传集合。

## 2. 锚点层

新建独立存储，不塞进 `iching-data.ts`，也不把领域字段写进 LanceDB chunk。建议与 video-kb 元数据同库或同目录的 SQLite 表 `clip_anchors`：

```
clip_anchors(
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  object_type TEXT NOT NULL,     -- hexagram | line | term | note | ...
  object_id TEXT NOT NULL,       -- 谦 | 谦/初六 | rust-ownership | ...
  video_id TEXT NOT NULL,
  start_seconds REAL NOT NULL,
  end_seconds REAL NOT NULL,
  quote TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'primary',  -- primary | mention
  confidence REAL NOT NULL DEFAULT 0,
  confirmed INTEGER NOT NULL DEFAULT 0,  -- 0/1
  source TEXT NOT NULL DEFAULT 'manual', -- manual | rule | model
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

唯一约束建议：`(collection, object_type, object_id, video_id, start_seconds, end_seconds)`，避免重复挂同一段。

查询语义是「这个对象有哪些已确认片段」，不是「再对全文做一次 embedding 搜索」。

### 角色

- `primary`：这段主讲该对象。详情页默认只展示它。
- `mention`：路过提到（「和前面乾卦一样」）。默认不挂到乾的详情页。

### 易经对象约定

这是消费者约定，不是锚点层的特殊分支：

- 卦辞：`object_type=hexagram`，`object_id=谦`
- 爻辞：`object_type=line`，`object_id=谦/初六`
- 大象若能从卦辞段分开，再用 `object_type=image`；分不开则并进卦辞段

顺序：先卦辞段，后按初爻到上爻切。缺的爻保持空，不用整卦段冒充。

### 索引怎么来

第一期 API 先支持手动/半自动写入和按对象读取。自动切边界可以后做，但标准先定：

1. 规则在转写里找专名、上下卦搭配、换爻口吻。
2. 模型只确认边界（`object` + `start/end` + `confidence`），不生成解说正文。
3. `confidence < 0.85` 或角色是 mention 的，不自动出现在详情页。
4. 相邻爻交接允许 10–15 秒重叠，避免切开例子开头。

## 3. 播放层

共用一个底部播放条，全面板单例：

- 输入：`video_id`、`start_seconds`、`end_seconds`、可选标题/摘录
- 行为：请求 `/v1/video-kb/assets/:id/video`，`currentTime = start`，在 `end` 暂停
- 卡片不内嵌 `<video>`。卡片只显示时间范围、一句摘录、播放按钮
- 本地文件不存在时，播放条显示缺失，并可提供原 URL 作为退路（不作为主路径）

现有资产接口已经能按整文件流式输出视频。第一期不新增服务端切片接口；Range 请求若当前缺失，作为播放 seek/拖动的修复项补上，而不是另做 clip 文件。

## 4. 易经消费

详情页在卦辞和每一爻下增加「讲解」区：

- 请求锚点：`collection=iching-up` + 对应 object
- 有 `primary` 且（`confirmed=1`，或 `confidence >= 0.85`）的卡片才展示
- 点播放：唤起底部播放条，不跳转 B 站，不打开整集时间轴作为主界面
- 经文数据与锚点分离；没有锚点时讲解区为空，不阻塞读经

## 5. API 草案

媒体层（扩展现有）：

```
POST /v1/video-kb/ingest          { ..., collection }
GET  /v1/video-kb/videos          ?collection=
POST /v1/video-kb/search          { query, collection?, video_id?, top_k }
PATCH /v1/video-kb/videos/:id     { collection?, display_title? }
```

锚点层（新增）：

```
GET  /v1/clip-anchors             ?collection=&object_type=&object_id=&confirmed=
POST /v1/clip-anchors             创建或覆盖一条锚点
PATCH /v1/clip-anchors/:id        改时间范围/确认状态/角色
DELETE /v1/clip-anchors/:id
```

播放仍走现有：

```
GET /v1/video-kb/assets/:video_id/video
```

## Error handling

- 未知集合：检索返回空列表，不报 500
- 锚点指向的 `video_id` 已删除：读取时标记 `asset_missing`，播放条显示缺失，不删除锚点（方便以后重新 ingest 同一视频）
- `end_seconds <= start_seconds`：拒绝写入
- 未确认且 `confidence < 0.85` 的锚点：列表 API 可返回，但易经详情默认不渲染
- 旧客户端不传 collection：ingest 写入 `default`，search 不按集合过滤

## Testing

- meta-store：新列默认 `default`；upsert 保留/更新 collection；按集合 list
- vector-store search：`collection` 过滤只返回该集合 chunk；与 `video_id` 组合有效
- clip-anchors：创建/按对象查询/确认过滤/mention 不进默认详情查询
- 播放器逻辑（纯函数即可）：start/end 规范化、到 end 应暂停、缺资产不抛未捕获异常
- 易经详情：有卦辞锚点、无爻锚点时只渲染卦辞卡片；不把 primary 以外的 mention 渲染出来

## 第一期落地顺序

1. videos / chunks 增加 collection，ingest 与 search 接通
2. clip_anchors 存储与 CRUD API
3. 底部共用播放条 + 资产 seek 播放
4. 易经详情页读取卦辞/爻辞锚点并唤起播放条

自动从转写切 64 卦边界可以作为第一期之后的跟进，不阻塞集合和播放器。
