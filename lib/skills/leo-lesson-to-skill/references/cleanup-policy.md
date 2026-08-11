# 基于 Manifest 的安全清理

清理是独立的授权步骤。发布成功不等于用户同意删除临时文件。

## 1. Manifest

`run_manifest.json` 必须位于本次唯一 `temp_root`，结构见 [run-manifest.schema.json](../schemas/run-manifest.schema.json)。

所有路径使用规范化绝对路径。`permanent_assets` 记录正式 Skill、备份和用户要求保留的证据；`temporary_files` 逐项记录归属和状态。

## 2. 删除资格

一个目标只有同时满足以下条件才允许删除：

- 位于本次运行的真实 `temp_root` 内；
- `created_by_run == true`；
- 是常规文件；
- 不是 Symlink、Junction 或 Reparse Point；
- 不存在于 `permanent_assets`；
- 用户已看到预览并明确授权本次清理。

目录不作为逐项文件删除目标。不得使用通配符或递归盲删。

## 3. 预览

先运行：

```text
python scripts/lesson_skill_guard.py cleanup --manifest <Manifest路径>
```

输出符合删除资格的绝对路径和总字节数。把这份清单展示给用户。

## 4. 执行

用户明确同意该清单后运行：

```text
python scripts/lesson_skill_guard.py cleanup \
  --manifest <Manifest路径> --approve DELETE
```

逐项删除并立即更新文件级状态 `deleted`、`retained` 或 `failed`，同时记录 `deleted_at` 和 `error`。

全部成功且永久资产复验存在后设为 `cleaned`。用户跳过设为 `completed_cleanup_skipped`；部分失败设为 `cleanup_failed`。

不要自动删除覆盖发布时产生的备份；备份属于永久资产，需单独授权。
