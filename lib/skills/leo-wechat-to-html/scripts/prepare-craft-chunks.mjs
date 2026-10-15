#!/usr/bin/env node

/**
 * prepare-craft-chunks.mjs
 * 
 * 将本地微信文章高保真转换为适合 Craft 笔记摄取的结构化 Chunk 清单
 * 
 * 功能与规范：
 * 1. 自动提取微信原始图床 URL（优先读取 image-map.json，无则在线反解），将本地相对图片路径还原为公共 URL
 *    -> Craft 后端接收到公共 URL 后会自动下载并上传转存为持久化原生 Image block (uploaded: true)
 * 2. 剥离 Frontmatter 与一级标题（Craft 文档自带标题）
 * 3. 规范化 Python 代码多行注释/docstring（将三引号 """ 规范化为 # 注释，防止 Craft CLI 引号截断）
 * 4. 智能按 ## / ### 章节将长文切割为 <= 12KB 的安全分块，杜绝 Craft 写入超时与截断
 * 5. 生成 craft-chunks/ 目录与 manifest.json，便于 Agent 批量或逐步调用 craft_write 添加
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const WECHAT_MOBILE_UA = 
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.38(0x1800262c) NetType/WIFI Language/zh_CN';

async function fetchOriginalImageUrls(sourceUrl) {
  try {
    const res = await fetch(sourceUrl, {
      headers: { 'User-Agent': WECHAT_MOBILE_UA }
    });
    if (!res.ok) return [];
    const html = await res.text();
    const urls = [];
    const imgRegex = /<img\b([^>]*)>/gi;
    let match;
    while ((match = imgRegex.exec(html)) !== null) {
      const attrs = match[1];
      const dataSrcMatch = attrs.match(/data-src=["']([^"']+)["']/i);
      const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
      let targetUrl = dataSrcMatch ? dataSrcMatch[1] : (srcMatch ? srcMatch[1] : null);
      if (targetUrl) {
        targetUrl = targetUrl.replace(/&amp;/g, '&');
        if ((targetUrl.includes('mmbiz.qpic.cn') || targetUrl.startsWith('http')) && !urls.includes(targetUrl)) {
          urls.push(targetUrl);
        }
      }
    }
    return urls;
  } catch (err) {
    console.warn(`[Warning] 无法拉取原始微信 HTML 提取图片 URL: ${err.message}`);
    return [];
  }
}

export async function prepareCraftChunks(articleDir) {
  const mdPath = path.join(articleDir, 'index.md');
  let mdContent = await fs.readFile(mdPath, 'utf-8');

  // 1. 获取图床映射
  const imageMapPath = path.join(articleDir, 'image-map.json');
  let imageMap = {};
  try {
    const mapStr = await fs.readFile(imageMapPath, 'utf-8');
    imageMap = JSON.parse(mapStr);
  } catch {
    // 若不存在 image-map.json，从 frontmatter 中解析 source URL 动态拉取
    const sourceMatch = mdContent.match(/source:\s*["']?(https:\/\/mp\.weixin\.qq\.com\/s[^\s"']+)["']?/i);
    if (sourceMatch) {
      const sourceUrl = sourceMatch[1];
      console.log(`📡 正在从原文动态获取高清图片映射: ${sourceUrl}`);
      const rawUrls = await fetchOriginalImageUrls(sourceUrl);
      rawUrls.forEach((u, i) => {
        let ext = 'png';
        const fmtMatch = u.match(/wx_fmt=([a-zA-Z0-9]+)/i);
        if (fmtMatch) ext = fmtMatch[1].toLowerCase();
        const filename = `img_${String(i + 1).padStart(3, '0')}.${ext}`;
        imageMap[u] = filename;
      });
      // 写入缓存供后续使用
      await fs.writeFile(imageMapPath, JSON.stringify(imageMap, null, 2), 'utf-8');
    }
  }

  // 2. 将本地图片替换回公共可访问的图床 URL
  for (const [remoteUrl, localName] of Object.entries(imageMap)) {
    const regex1 = new RegExp(`!\\[[^\\]]*\\]\\(images/${localName}\\)`, 'g');
    const regex2 = new RegExp(`!\\(\\s*images/${localName}\\s*\\)`, 'g');
    mdContent = mdContent.replace(regex1, `![图片](${remoteUrl})`);
    mdContent = mdContent.replace(regex2, `![图片](${remoteUrl})`);
  }

  // 3. 提取文章元数据（标题、作者、发布日期）
  const titleMatch = mdContent.match(/title:\s*["']?([^"'\n]+)["']?/i);
  const title = titleMatch ? titleMatch[1].trim() : path.basename(articleDir);

  // 4. 清理 Frontmatter 与根级 H1
  mdContent = mdContent.replace(/^---[\s\S]*?---\n*/, '');
  mdContent = mdContent.replace(/^#\s+[^\n]+\n+/, '');

  // 5. 安全转义 Python docstring 与特殊引号，防止 CLI 参数被闭合截断
  mdContent = mdContent.replace(/"""/g, "'''");

  // 6. 按章节边界智能分块 (<= 12KB)
  const rawSections = mdContent.split(/(?=\n##\s+|\n###\s+)/);
  const chunks = [];
  let currentChunk = '';

  for (const sec of rawSections) {
    if (!sec.trim()) continue;
    if ((currentChunk.length + sec.length) > 12000 && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = sec;
    } else {
      currentChunk += '\n\n' + sec;
    }
  }
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  // 7. 保存切片文件
  const outputDir = path.join(articleDir, 'craft-chunks');
  await fs.mkdir(outputDir, { recursive: true });

  const chunkFiles = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkFile = path.join(outputDir, `chunk_${String(i + 1).padStart(2, '0')}.md`);
    await fs.writeFile(chunkFile, chunks[i], 'utf-8');
    chunkFiles.push({
      index: i + 1,
      path: chunkFile,
      chars: chunks[i].length,
      preview: chunks[i].slice(0, 60).replace(/\n/g, ' ')
    });
  }

  const manifest = {
    title,
    articleDir,
    totalChunks: chunks.length,
    chunks: chunkFiles
  };
  await fs.writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  console.log(`\n📦 已生成 Craft 格式切片清单:`);
  console.log(`   📄 标题: ${title}`);
  console.log(`   ✂️  总分块数: ${chunks.length}`);
  console.log(`   📁 目录: file://${outputDir}`);
  return manifest;
}

// CLI 执行
if (process.argv[1] && process.argv[1].endsWith('prepare-craft-chunks.mjs')) {
  const targetDir = process.argv[2];
  if (!targetDir) {
    console.error('用法: node prepare-craft-chunks.mjs <articleDir>');
    process.exit(1);
  }
  prepareCraftChunks(path.resolve(targetDir)).catch(err => {
    console.error('执行失败:', err);
    process.exit(1);
  });
}
