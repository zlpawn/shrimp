#!/usr/bin/env node

/**
 * wechat-dl.mjs
 * 微信公众号文章高保真抓取与结构化 Markdown 本地化导出工具
 * 
 * 核心特性：
 * 1. 模拟微信客户端 Mobile UA，秒级直取服务端原生 HTML（零浏览器依赖）
 * 2. 突破 mmbiz.qpic.cn 防盗链限制，并发下载全量高清原图
 * 3. 基于 Cheerio DOM 引擎深度重构微信特有排版：
 *    - 智能识别并修复被切断的章节大标题（如 01 / 02 孤立序号与标题缝合）
 *    - 还原秀米/壹伴等 flex 自定义表格为标准 GFM Markdown 表格
 *    - 自动识别多级标题（2.1, 3.2.1, 一、二、）并提升为规范的 Markdown 层级
 *    - 剥除文末广告、底栏引导、赞赏及占位 SVG
 * 4. 自动生成规范 YAML Frontmatter（标题、作者、发布日期、原始来源）
 * 5. 支持标准 Markdown 相对图片路径与 Obsidian 双链格式
 */

import fs from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 微信移动端标准 User-Agent（穿透桌面端反爬验证盾的关键）
const WECHAT_MOBILE_UA = 
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.38(0x1800262c) NetType/WIFI Language/zh_CN';

// 文件与目录名非法字符清洗（限制长度防操作系统 ENAMETOOLONG 异常）
function sanitizeFilename(name) {
  let clean = (name || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length > 80) {
    clean = clean.slice(0, 80).trim();
  }
  return clean || 'untitled';
}

// 提取文章中的所有图片 URL（包含 img 标签与 background-image）
function extractImageUrls(html) {
  const urls = [];
  // 1. img 标签中的 data-src 与 src
  const imgRegex = /<img\b([^>]*)>/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const attrs = match[1];
    const dataSrcMatch = attrs.match(/data-src=["']([^"']+)["']/i);
    const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
    let targetUrl = dataSrcMatch ? dataSrcMatch[1] : (srcMatch ? srcMatch[1] : null);

    if (targetUrl) {
      if (targetUrl.startsWith('//')) targetUrl = 'https:' + targetUrl;
      // 统一反转义 &amp; 为 &，确保与 DOM 属性完全一致
      targetUrl = targetUrl.replace(/&amp;/g, '&');
      if ((targetUrl.includes('mmbiz.qpic.cn') || targetUrl.startsWith('http')) && !urls.includes(targetUrl)) {
        urls.push(targetUrl);
      }
    }
  }

  // 2. 内联样式中的 background-image: url(...)
  const bgRegex = /background-image:\s*url\(['"]?(https?:\/\/[^'")]*mmbiz\.qpic\.cn[^'")]*|\/\/[^'")]*mmbiz\.qpic\.cn[^'")]*)['"]?\)/gi;
  while ((match = bgRegex.exec(html)) !== null) {
    let bgUrl = match[1];
    if (bgUrl.startsWith('//')) bgUrl = 'https:' + bgUrl;
    bgUrl = bgUrl.replace(/&amp;/g, '&');
    if (!urls.includes(bgUrl)) {
      urls.push(bgUrl);
    }
  }

  return urls;
}

// 单张图片下载器（突破防盗链）
async function downloadImage(url, destPath) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': WECHAT_MOBILE_UA,
      'Referer': 'https://mp.weixin.qq.com/'
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  await fs.writeFile(destPath, Buffer.from(arrayBuffer));
}

// 并发下载图片池
async function downloadImagesPool(imageUrls, imagesDir, concurrency = 6) {
  const imageMap = new Map();
  const queue = imageUrls.map((url, index) => {
    let ext = 'png';
    const fmtMatch = url.match(/wx_fmt=([a-zA-Z0-9]+)/i);
    if (fmtMatch) {
      ext = fmtMatch[1].toLowerCase();
      if (ext === 'jpeg') ext = 'jpg';
    }
    const filename = `img_${String(index + 1).padStart(3, '0')}.${ext}`;
    const destPath = path.join(imagesDir, filename);
    const relPath = `images/${filename}`;
    return { url, filename, destPath, relPath, index: index + 1 };
  });

  let completed = 0;
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      try {
        await downloadImage(item.url, item.destPath);
        imageMap.set(item.url, item.relPath);
        completed++;
        process.stdout.write(`  📥 图片下载中 [${completed}/${imageUrls.length}] -> ${item.filename}\r`);
      } catch (err) {
        console.warn(`\n  ⚠️ 图片下载失败 (${item.filename}): ${err.message}`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, imageUrls.length) }, () => worker());
  await Promise.all(workers);
  if (imageUrls.length > 0) {
    console.log(`\n  ✅ ${completed}/${imageUrls.length} 张图片已全部无损下载并脱机本地化`);
  }
  return imageMap;
}

/**
 * 微信专属高保真 DOM 清洗与 Markdown 重构引擎
 */
function convertWechatHtmlToMarkdown(contentHtml, imageMap, formatMode = 'standard') {
  const $ = cheerio.load(contentHtml, { decodeEntities: false });

  // 1. 清理 DOM 噪音（脚本、样式、SVG装饰、底栏分享卡片）
  $('script, style, noscript, iframe').remove();
  $('.rich_media_area_extra, #js_bottom_share_card, .reward_area').remove();

  // 2. 深度重构微信自定义表格 (壹伴 / 秀米 flex 表格)
  $('section[data-mpa-table="1"], section[data-mpa-table]').each((_, tableEl) => {
    const $table = $(tableEl);
    const rows = [];
    $table.find('section[data-mpa-table-row]').each((_, rowEl) => {
      const cells = [];
      $(rowEl).find('section[data-mpa-table-cell]').each((_, cellEl) => {
        const text = $(cellEl).text().replace(/\s+/g, ' ').trim();
        cells.push(text);
      });
      if (cells.length > 0) rows.push(cells);
    });

    if (rows.length >= 2) {
      const colCount = Math.max(...rows.map(r => r.length));
      let mdTable = '\n\n';
      // 表头
      const headerRow = rows[0];
      while (headerRow.length < colCount) headerRow.push('');
      mdTable += '| ' + headerRow.join(' | ') + ' |\n';
      mdTable += '| ' + headerRow.map(() => '---').join(' | ') + ' |\n';
      // 数据行
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        while (row.length < colCount) row.push('');
        mdTable += '| ' + row.join(' | ') + ' |\n';
      }
      mdTable += '\n\n';
      $table.replaceWith(mdTable);
    }
  });

  // 3. 预处理标准 HTML <table>
  $('table').each((_, tableEl) => {
    const $table = $(tableEl);
    const rows = [];
    $table.find('tr').each((_, tr) => {
      const cells = [];
      $(tr).find('th, td').each((_, td) => {
        cells.push($(td).text().replace(/\s+/g, ' ').trim());
      });
      if (cells.length > 0) rows.push(cells);
    });
    if (rows.length >= 1) {
      const colCount = Math.max(...rows.map(r => r.length));
      let mdTable = '\n\n';
      const headerRow = rows[0];
      while (headerRow.length < colCount) headerRow.push('');
      mdTable += '| ' + headerRow.join(' | ') + ' |\n';
      mdTable += '| ' + headerRow.map(() => '---').join(' | ') + ' |\n';
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        while (row.length < colCount) row.push('');
        mdTable += '| ' + row.join(' | ') + ' |\n';
      }
      mdTable += '\n\n';
      $table.replaceWith(mdTable);
    }
  });

  // 4. 图片替换为 Markdown 语法
  $('img').each((i, imgEl) => {
    const $img = $(imgEl);
    let dataSrc = $img.attr('data-src') || $img.attr('src');
    if (dataSrc) {
      dataSrc = dataSrc.replace(/&amp;/g, '&');
      if (imageMap.has(dataSrc)) {
        const relPath = imageMap.get(dataSrc);
        const filename = path.basename(relPath);
        const mdImg = formatMode === 'obsidian' 
          ? `\n\n![[${filename}]]\n\n` 
          : `\n\n![](${relPath})\n\n`;
        $img.replaceWith(mdImg);
        return;
      }
    }
    $img.remove();
  });

  // 5. 代码块处理
  $('pre').each((_, pre) => {
    const $pre = $(pre);
    const code = $pre.text();
    $pre.replaceWith(`\n\n\`\`\`\n${code.trim()}\n\`\`\`\n\n`);
  });

  // 6. 行内代码
  $('code').each((_, code) => {
    const $code = $(code);
    $code.replaceWith(` \`${$code.text().trim()}\` `);
  });

  // 7. 格式修饰
  $('strong, b').each((_, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    if (text) $el.replaceWith(`**${text}**`);
  });

  $('em, i').each((_, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    if (text) $el.replaceWith(`*${text}*`);
  });

  // 8. 引用块
  $('blockquote').each((_, el) => {
    const $el = $(el);
    const lines = $el.text().trim().split('\n');
    $el.replaceWith('\n\n' + lines.map(l => `> ${l.trim()}`).join('\n') + '\n\n');
  });

  // 9. 容器标签折叠换行
  $('br').replaceWith('\n');
  $('p, section, div, h1, h2, h3, h4, h5, h6').each((_, el) => {
    const $el = $(el);
    $el.append('\n\n');
  });

  // 10. 提取纯文本并进行智能排版重构
  let rawText = $.text();

  // 字符实体清理
  rawText = rawText
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\u200B/g, ''); // 移除零宽字符

  const lines = rawText.split('\n');
  const refinedLines = [];
  let currentTable = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) {
      if (currentTable.length > 0) {
        refinedLines.push(currentTable.join('\n'));
        currentTable = [];
      }
      continue;
    }

    // 保持 Markdown 表格的连续性
    if (line.startsWith('|')) {
      currentTable.push(line);
      continue;
    } else if (currentTable.length > 0) {
      refinedLines.push(currentTable.join('\n'));
      currentTable = [];
    }

    // 智能识别：章节大编号独立成行 (如 "01", "02")，自动缝合下一行的标题
    if (/^\d{2}$/.test(line)) {
      let nextIdx = i + 1;
      while (nextIdx < lines.length && !lines[nextIdx].trim()) nextIdx++;
      if (nextIdx < lines.length) {
        const next = lines[nextIdx].trim();
        if (next && !next.startsWith('#') && !next.startsWith('!')) {
          refinedLines.push(`\n## ${line} ${next}\n`);
          i = nextIdx;
          continue;
        }
      }
    }

    // 智能识别：多级数字标题 (如 "2.1 为什么...", "3.2.1 业务层...")
    if (/^(\d+\.\d+(\.\d+)?)\s+(.+)$/.test(line)) {
      const parts = line.match(/^(\d+\.\d+(\.\d+)?)\s+(.+)$/);
      const level = parts[1].split('.').length === 2 ? '###' : '####';
      refinedLines.push(`\n${level} ${line.replace(/^#+\s*/, '')}\n`);
      continue;
    }

    // 智能识别：中文数字编号标题 (如 "一. AI 的执行速度...", "二、...")
    if (/^[一二三四五六七八九十]+[、.]\s*(.+)$/.test(line)) {
      refinedLines.push(`\n#### ${line}\n`);
      continue;
    }

    // 智能识别：文章开头的导读与发文信息 (如 "这是2026年的第 41 篇文章")
    if (/^这是\d+年的第\s*\d+\s*篇文章/.test(line) || /^[（(]\s*本文阅读时间/.test(line)) {
      refinedLines.push(`> 💡 *${line}*`);
      continue;
    }

    // 过滤底部的微信互动/点赞/阅读原文等噪声
    if (/^(欢迎留言一起参与讨论|阅读原文|喜欢此内容的人还喜欢|预览时标签不可点)/.test(line)) {
      continue;
    }

    refinedLines.push(line);
  }

  if (currentTable.length > 0) {
    refinedLines.push(currentTable.join('\n'));
  }

  let finalMarkdown = refinedLines.join('\n\n');
  // 规范化空行
  finalMarkdown = finalMarkdown.replace(/\n{3,}/g, '\n\n').trim();
  return finalMarkdown;
}

/**
 * 抓取单篇微信公众号文章
 */
export async function downloadWechatArticle(url, options = {}) {
  const outputBaseDir = path.resolve(options.outputDir || 'wechat-articles');
  const formatMode = options.format || 'standard';

  console.log(`\n==================================================`);
  console.log(`🌐 正在请求文章: ${url}`);

  const res = await fetch(url, {
    headers: {
      'User-Agent': WECHAT_MOBILE_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh-Hans;q=0.9'
    }
  });

  if (!res.ok) {
    throw new Error(`网络请求失败: HTTP ${res.status} ${res.statusText}`);
  }

  const html = await res.text();

  if (html.includes('secitptpage/verify')) {
    throw new Error('微信返回了安全验证页面 (secitptpage/verify)，可能需要临时使用 ego-browser 进行验证');
  }

  const $doc = cheerio.load(html, { decodeEntities: false });

  // 1. 标题提取（多级可靠兜底）
  const rawTitle = $doc('#activity-name').text().trim() 
                || $doc('meta[property="og:title"]').attr('content')
                || $doc('title').text().trim() 
                || '未命名微信文章';
  const cleanTitle = sanitizeFilename(rawTitle);

  // 2. 作者 / 公众号名称提取（多级兜底）
  let author = $doc('#js_name').text().trim()
            || $doc('.profile_nickname').text().trim()
            || $doc('meta[property="og:article:author"]').attr('content')
            || '';
  if (!author) {
    const nickMatch = html.match(/var\s+nickname\s*=\s*["']([^"']+)["']/);
    if (nickMatch) author = nickMatch[1].trim();
  }

  // 3. 发布时间提取（支持 10/13 位时间戳及多种字符串）
  const timeMatch = html.match(/var\s+publish_time\s*=\s*["']([^"']+)["']/)
                 || html.match(/var\s+ct\s*=\s*["']?(\d+)["']?/)
                 || html.match(/createTime\s*:\s*["']?(\d+)["']?/);
  let pubDate = '';
  if (timeMatch) {
    const val = timeMatch[1].trim();
    if (/^\d{10}$/.test(val)) {
      pubDate = new Date(parseInt(val, 10) * 1000).toISOString().split('T')[0];
    } else if (/^\d{13}$/.test(val)) {
      pubDate = new Date(parseInt(val, 10)).toISOString().split('T')[0];
    } else {
      pubDate = val;
    }
  } else {
    pubDate = new Date().toISOString().split('T')[0];
  }

  // 4. 正文容器提取（Cheerio 保证即使内部嵌套多层复杂 div 也 100% 完整提取）
  const contentHtml = $doc('#js_content').html();
  if (!contentHtml) {
    throw new Error('未能在网页中找到正文容器 (#js_content)，该链接可能是空文章、动态视频号或已删除');
  }

  console.log(`📌 文章标题: ${rawTitle}`);
  console.log(`✍️  公众号: ${author || '未知'}`);
  console.log(`📅 发布时间: ${pubDate}`);

  // 5. 创建输出目录
  const folderName = `${pubDate}-${cleanTitle}${author ? '-' + sanitizeFilename(author) : ''}`;
  const articleDir = path.join(outputBaseDir, folderName);
  const imagesDir = path.join(articleDir, 'images');
  await fs.mkdir(imagesDir, { recursive: true });

  // 6. 图片提取与下载
  const imageUrls = extractImageUrls(contentHtml);
  console.log(`🖼️  检测到图片: ${imageUrls.length} 张`);
  const imageMap = await downloadImagesPool(imageUrls, imagesDir, 4);

  // 7. 高保真重构为 Markdown
  const markdownBody = convertWechatHtmlToMarkdown(contentHtml, imageMap, formatMode);

  // 8. 构造标准 YAML Frontmatter
  const frontmatter = [
    '---',
    `title: "${rawTitle.replace(/"/g, '\\"')}"`,
    author ? `author: "${author.replace(/"/g, '\\"')}"` : null,
    `date: "${pubDate}"`,
    `source: "${url}"`,
    'tags:',
    '  - 微信公众号',
    author ? `  - ${author}` : null,
    '---',
    '',
    `# ${rawTitle}`,
    '',
    `> **来源**: [${rawTitle}](${url})  `,
    `> **公众号**: ${author || '未知'} | **发布时间**: ${pubDate}`,
    '',
    '---',
    '',
    markdownBody,
    ''
  ].filter(line => line !== null).join('\n');

  // 9. 保存 Markdown 文件
  const mdPath = path.join(articleDir, 'index.md');
  await fs.writeFile(mdPath, frontmatter, 'utf-8');

  // 10. 保存 100% 像素级原版离线 HTML (内联全部微信原生 CSS，彻底规避 file:// 协议无效问题)
  const $html = cheerio.load(html, { decodeEntities: false });
  // 移除所有脚本、iframe 以及导致本地 CORS 报错的 preload / modulepreload 标签
  $html('script, noscript, iframe, link[rel="modulepreload"], link[rel="preload"], link[rel="dns-prefetch"]').remove();
  
  // 核心修复 1：微信默认将 #js_content 设置为 visibility: hidden 和 opacity: 0，必须解除隐藏
  $html('#js_content').removeAttr('style');

  // 核心修复 2：并发全量下载所有外部 CSS 样式表并内联为 <style>，彻底解决 file:// 下协议相对路径 (//res.wx.qq.com) 报 net::ERR_INVALID_URL 导致排版全崩的问题
  const links = $html('link[rel="stylesheet"]').toArray();
  const cssPromises = links.map(async (el, i) => {
    let href = $html(el).attr('href');
    if (!href) return null;
    if (href.startsWith('//')) href = 'https:' + href;
    try {
      const cssRes = await fetch(href, {
        headers: {
          'User-Agent': WECHAT_MOBILE_UA,
          'Referer': 'https://mp.weixin.qq.com/'
        }
      });
      if (cssRes.ok) {
        const cssText = await cssRes.text();
        return `\n/* === [${i + 1}] ${path.basename(href)} === */\n` + cssText;
      }
    } catch {
      // 忽略单个 CSS 下载异常
    }
    return null;
  });

  const cssList = await Promise.all(cssPromises);
  const combinedCss = cssList.filter(Boolean).join('\n');
  $html('link[rel="stylesheet"]').remove();

  if (combinedCss) {
    $html('head').append(`<style>\n${combinedCss}\n</style>`);
  }

  // 核心修复 3：补齐缺失的元信息（发布日期、作者显式化、原文外链）
  if (pubDate) {
    $html('#publish_time').text(pubDate);
  }
  $html('#js_author_name').removeAttr('style');
  $html('#js_author_name_text').removeAttr('style');
  if (url) {
    $html('#meta_content').append(`
      <span class="rich_media_meta rich_media_meta_text" style="margin-left: 10px;">
        <a href="${url}" target="_blank" style="color: #576b95; text-decoration: none;">🔗 原文链接</a>
      </span>
    `);
  }

  // 本地图片相对路径替换（自动解码 &amp; 匹配）
  $html('img').each((_, imgEl) => {
    const $img = $html(imgEl);
    let dataSrc = $img.attr('data-src') || $img.attr('src');
    if (!dataSrc) return;
    dataSrc = dataSrc.replace(/&amp;/g, '&');
    if (imageMap.has(dataSrc)) {
      $img.attr('src', imageMap.get(dataSrc));
      $img.removeAttr('data-src');
      $img.removeAttr('data-type');
      $img.removeAttr('data-w');
      $img.removeAttr('data-ratio');
      $img.removeAttr('style');
      $img.css('max-width', '100%');
      $img.css('height', 'auto');
      $img.css('display', 'block');
      $img.css('margin', '16px auto');
    }
  });

  // 处理内联 background-image 中的微信图片路径
  $html('[style*="background-image"]').each((_, el) => {
    let style = $html(el).attr('style');
    if (!style) return;
    for (const [remoteUrl, localRel] of imageMap.entries()) {
      if (style.includes(remoteUrl)) {
        style = style.replaceAll(remoteUrl, localRel);
      }
    }
    $html(el).attr('style', style);
  });

  // 视口与桌面阅读优雅居中强化
  $html('head').append(`
    <style>
      #js_content, #js_article, .rich_media_content {
        visibility: visible !important;
        opacity: 1 !important;
        display: block !important;
      }
      body {
        max-width: 760px;
        margin: 30px auto;
        padding: 0 20px;
        background: #fff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        line-height: 1.8;
        color: #333;
      }
      img { max-width: 100% !important; height: auto !important; border-radius: 6px; margin: 16px auto; display: block; }
    </style>
  `);
  const htmlPath = path.join(articleDir, 'article.html');
  await fs.writeFile(htmlPath, $html.html(), 'utf-8');

  // 保存图床映射供后续多端中继同步使用 (如 Craft / 飞书 / Notion)
  const imageMapPath = path.join(articleDir, 'image-map.json');
  await fs.writeFile(imageMapPath, JSON.stringify(imageMap, null, 2), 'utf-8');

  console.log(`\n🎉 导出成功:`);
  console.log(`   🌐 像素级原版 HTML: file://${htmlPath}`);
  console.log(`   📄 结构化 Markdown: file://${mdPath}`);
  console.log(`   📁 本地资源目录:   file://${imagesDir}`);
  return {
    title: rawTitle,
    author,
    pubDate,
    articleDir,
    mdPath,
    htmlPath,
    imageMapPath,
    imageCount: imageUrls.length
  };
}

// 辅助函数：从任意文本中提取微信文章链接
export function extractWechatUrlsFromText(text) {
  const urlRegex = /https?:\/\/mp\.weixin\.qq\.com\/s(?:\/[a-zA-Z0-9_\-]+|\?[^"'\s\)]+)/g;
  const matches = text.match(urlRegex) || [];
  return Array.from(new Set(matches));
}

const SKILL_NAME = 'leo-wechat-to-html';
const SHRIMP_SKILL_DIR = path.join(os.homedir(), '.shrimp', 'skills', SKILL_NAME);
const VAULT_CONFIG_FILE = path.join(SHRIMP_SKILL_DIR, 'vault');
const DEFAULT_ARTICLES_DIR = path.join(SHRIMP_SKILL_DIR, 'articles');

// 读取已持久化保存的用户知识库路径
export function getSavedVaultDir() {
  if (existsSync(VAULT_CONFIG_FILE)) {
    try {
      const p = readFileSync(VAULT_CONFIG_FILE, 'utf-8').trim();
      if (p) return path.resolve(p.replace(/^~(?=$|\/|\\)/, os.homedir()));
    } catch {}
  }
  return null;
}

// 持久化保存用户指定的知识库路径到 ~/.shrimp/skills/xxx-skill/vault
export function saveVaultDir(vaultPath) {
  mkdirSync(SHRIMP_SKILL_DIR, { recursive: true });
  const resolved = path.resolve(vaultPath.trim().replace(/^~(?=$|\/|\\)/, os.homedir()));
  writeFileSync(VAULT_CONFIG_FILE, resolved, 'utf-8');
  console.log(`✅ 知识库目录已保存至配置: ${VAULT_CONFIG_FILE} -> ${resolved}`);
  return resolved;
}

// 智能解析默认知识库目录：
// 1. 若配置了 ~/.shrimp/skills/xxx-skill/vault 则优先使用该知识库路径
// 2. 兜底使用本地目录 ~/.shrimp/skills/xxx-skill/articles
export function resolveDefaultOutputDir() {
  if (process.env.KNOWLEDGE_VAULT_DIR) {
    return process.env.KNOWLEDGE_VAULT_DIR;
  }
  const savedVault = getSavedVaultDir();
  if (savedVault) {
    return savedVault;
  }
  return DEFAULT_ARTICLES_DIR;
}

// 命令行入口
async function main() {
  const args = process.argv.slice(2);
  let urls = [];
  let outputDir = null;
  let format = 'standard';
  let filePath = null;
  let useStdin = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--set-vault') {
      const targetVault = args[++i];
      if (!targetVault) {
        console.error('❌ 请提供知识库路径，例如: --set-vault "~/Documents/Obsidian Vault/Articles"');
        process.exit(1);
      }
      saveVaultDir(targetVault);
      process.exit(0);
    } else if (arg === '--get-vault') {
      const currentVault = getSavedVaultDir();
      console.log(currentVault ? `📂 当前已持久化配置的知识库路径: ${currentVault}` : `ℹ️ 未配置外部知识库，默认使用本地目录: ${DEFAULT_ARTICLES_DIR}`);
      process.exit(0);
    } else if (arg === '-o' || arg === '--output' || arg === '--output-dir') {
      outputDir = args[++i];
    } else if (arg === '-f' || arg === '--file') {
      filePath = args[++i];
    } else if (arg === '--format') {
      format = args[++i] || 'standard';
    } else if (arg === '-s' || arg === '--stdin') {
      useStdin = true;
    } else if (arg === '-h' || arg === '--help') {
      console.log(`
微信公众号文章下载器 (wechat-dl)

用法:
  node wechat-dl.mjs <url1> [url2...] [选项]
  node wechat-dl.mjs --file links.txt [选项]
  cat craft_note.md | node wechat-dl.mjs --stdin [选项]

选项:
  -o, --output <dir>       指定保存目录 (默认: ./wechat-articles)
  -f, --file <path>        指定包含链接的文本文件 (每行一个链接或包含链接的 Markdown)
  -s, --stdin              从标准输入中读取文本并自动提取所有公众号链接
  --format <standard|obsidian>  图片引用语法 (standard: ![](images/..) | obsidian: ![[..]])
  -h, --help               显示帮助信息
`);
      process.exit(0);
    } else if (arg.startsWith('http')) {
      urls.push(arg);
    }
  }

  // 从文件读取
  if (filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const found = extractWechatUrlsFromText(content);
      urls.push(...found);
      console.log(`📖 从文件 ${filePath} 提取到 ${found.length} 个微信文章链接`);
    } catch (err) {
      console.error(`❌ 读取文件失败: ${err.message}`);
      process.exit(1);
    }
  }

  // 从标准输入读取
  if (useStdin) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const inputContent = Buffer.concat(chunks).toString('utf-8');
    const found = extractWechatUrlsFromText(inputContent);
    urls.push(...found);
    console.log(`📥 从标准输入读取并提取到 ${found.length} 个微信文章链接`);
  }

  // 去重
  urls = Array.from(new Set(urls));

  if (urls.length === 0) {
    console.error('❌ 未指定任何微信文章链接。使用 -h 查看帮助。');
    process.exit(1);
  }

  if (!outputDir) {
    outputDir = resolveDefaultOutputDir();
  }

  console.log(`📋 共待抓取 ${urls.length} 篇文章，输出目录: ${path.resolve(outputDir)}`);

  const results = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`\n[${i + 1}/${urls.length}] 处理中...`);
    try {
      const res = await downloadWechatArticle(url, { outputDir, format });
      results.push({ url, status: 'success', ...res });
    } catch (err) {
      console.error(`❌ 抓取失败 [${url}]:`, err.message);
      results.push({ url, status: 'error', error: err.message });
    }
  }

  console.log(`\n==================================================`);
  console.log(`🏁 任务处理完成！成功: ${results.filter(r => r.status === 'success').length} / ${urls.length}`);
}

if (process.argv[1] && process.argv[1].endsWith('wechat-dl.mjs')) {
  main().catch(err => {
    console.error('执行出错:', err);
    process.exit(1);
  });
}
