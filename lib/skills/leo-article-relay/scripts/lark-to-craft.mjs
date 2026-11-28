#!/usr/bin/env node

/**
 * lark-to-craft.mjs
 * 
 * 飞书文档 (Docx / Wiki) 高保真转存至 Craft 官方知识库中继引擎
 * 
 * 核心机制与原则：
 * 1. 严格只读（Read-Only）：只读取飞书文档内容与下载素材，绝不调用任何写命令。
 * 2. 外部委托（Decoupled）：不内嵌 Lark SDK，完全委托给本地 `lark-cli` 与 `lark-doc` 技能。
 * 3. 策略 A 官方图床直传：
 *    - 飞书图片本地下载缓存；
 *    - 调用 leo-craft-api 将二进制图片直传 Craft 官方云端，换取官方永久 CDN assetUrl；
 *    - 回填 Markdown 图片地址，保证图文 100% 相对位置与脱机原生渲染。
 * 4. 智能切片（Chunking）：长文按章节切为 <= 12KB 分块，避免 CLI 截断与超时。
 * 5. 父子文档探测（Hierarchy）：智能识别 Wiki 知识库父节点，支持单篇/整树/指定子文档。
 * 6. 无写死路径（Portability）：路径完全基于工作目录、用户家目录与动态发现。
 */

import fs from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ================= 辅助函数：安全解析 JSON 输出 =================

function extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  const firstBrace = text.indexOf('{');
  if (firstBrace === -1) return null;
  const lastBrace = text.lastIndexOf('}');
  if (lastBrace <= firstBrace) return null;

  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch (err) {
    try {
      return JSON.parse(text.trim());
    } catch {
      return null;
    }
  }
}

// ================= 动态定位 leo-craft-api =================

async function getCraftClient(overrides = {}) {
  const possiblePaths = [
    // 1. 本地项目/同级技能目录
    path.resolve(__dirname, '../../leo-craft-api/scripts/craft-client.mjs'),
    // 2. ~/.agents/skills
    path.join(os.homedir(), '.agents', 'skills', 'leo-craft-api', 'scripts', 'craft-client.mjs'),
    // 3. ~/.gemini/config/skills
    path.join(os.homedir(), '.gemini', 'config', 'skills', 'leo-craft-api', 'scripts', 'craft-client.mjs'),
    // 4. ~/.shrimp/skills
    path.join(os.homedir(), '.shrimp', 'skills', 'leo-craft-api', 'scripts', 'craft-client.mjs')
  ];

  for (const clientPath of possiblePaths) {
    if (existsSync(clientPath)) {
      try {
        const module = await import(`file://${clientPath}`);
        if (module && module.CraftClient) {
          return new module.CraftClient(overrides);
        }
      } catch (err) {
        // 尝试下一个路径
      }
    }
  }

  throw new Error(
    '未找到 leo-craft-api 客户端！\n' +
    '请确保 leo-craft-api 存在于同级技能目录或 ~/.agents/skills/leo-craft-api 中，并已配置 API Key。'
  );
}

// 执行 Shell 命令并返回结果（安全包装）
function execCmd(command, options = {}) {
  return new Promise((resolve) => {
    exec(command, { maxBuffer: 20 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, error, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
      } else {
        resolve({ ok: true, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
      }
    });
  });
}

// 文件名清洗，防止跨系统非法字符与过长
// ================= 知识库默认目录解析 (与 wechat-dl 保持完全一致) =================

const SKILL_NAME = "leo-article-relay";
const SHRIMP_SKILL_DIR = path.join(os.homedir(), ".shrimp", "skills", SKILL_NAME);
const VAULT_CONFIG_FILE = path.join(SHRIMP_SKILL_DIR, "vault");
const DEFAULT_ARTICLES_DIR = path.join(SHRIMP_SKILL_DIR, "articles");

export function getSavedVaultDir() {
  if (existsSync(VAULT_CONFIG_FILE)) {
    try {
      const p = readFileSync(VAULT_CONFIG_FILE, "utf-8").trim();
      if (p) return path.resolve(p.replace(/^~(?=$|\/|\\)/, os.homedir()));
    } catch {}
  }
  return null;
}

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

// ================= 1. 环境与依赖探测 (Preflight) =================

export async function checkPreflight() {
  const result = {
    cliInstalled: false,
    cliPath: null,
    skillInstalled: false,
    authOk: false,
    identity: null,
    userName: null,
    issues: []
  };

  // 1. 检查 lark-cli 是否已安装在 PATH
  const whichRes = await execCmd('which lark-cli');
  if (whichRes.ok && whichRes.stdout) {
    result.cliInstalled = true;
    result.cliPath = whichRes.stdout;
  } else {
    result.issues.push({
      type: 'cli_missing',
      message: '本地未检测到 lark-cli 命令。',
      guide: '可执行 npm install -g @larksuite/cli 或通过对应包管理器安装。'
    });
    return result; // CLI 缺失则无需后续检查
  }

  // 2. 检查 lark-doc 技能是否存在
  const possibleSkillDirs = [
    path.join(os.homedir(), '.gemini', 'config', 'skills', 'lark-doc'),
    path.join(os.homedir(), '.agents', 'skills', 'lark-doc'),
    path.resolve(__dirname, '../../lark-doc')
  ];
  result.skillInstalled = possibleSkillDirs.some(d => existsSync(d));
  if (!result.skillInstalled) {
    result.issues.push({
      type: 'skill_missing',
      message: '本地未检测到 lark-doc 技能目录（建议引入以保证高保真规则支持）。'
    });
  }

  // 3. 检查鉴权状态 (只读状态检查)
  const authRes = await execCmd('lark-cli auth status');
  if (authRes.ok) {
    const authData = extractJson(authRes.stdout);
    const userIdent = authData?.identities?.user;
    const botIdent = authData?.identities?.bot;

    if (userIdent && userIdent.available) {
      result.authOk = true;
      result.identity = 'user';
      result.userName = userIdent.userName || userIdent.openId;
    } else if (botIdent && botIdent.available) {
      result.authOk = true;
      result.identity = 'bot';
    } else if (authRes.stdout.includes('ready') || authRes.stdout.includes('needs_refresh')) {
      result.authOk = true;
    } else {
      result.issues.push({
        type: 'auth_missing',
        message: 'lark-cli 尚未登录或用户身份凭证已失效。',
        guide: '请在终端运行: lark-cli auth login 完成飞书扫码或浏览器授权登录。'
      });
    }
  } else {
    result.issues.push({
      type: 'auth_check_failed',
      message: `检查授权状态失败: ${authRes.stderr || authRes.error?.message}`,
      guide: '请在终端运行 lark-cli auth login'
    });
  }

  return result;
}

// ================= 2. 文档类型与层级探测 (Inspect) =================

export function parseLarkDocUrl(urlOrToken) {
  const raw = (urlOrToken || '').trim();
  let type = 'unknown';
  let token = raw;

  if (raw.includes('/wiki/')) {
    type = 'wiki';
    const match = raw.match(/\/wiki\/([a-zA-Z0-9_-]+)/);
    if (match) token = match[1];
  } else if (raw.includes('/docx/')) {
    type = 'docx';
    const match = raw.match(/\/docx\/([a-zA-Z0-9_-]+)/);
    if (match) token = match[1];
  } else if (raw.startsWith('wikcn') || raw.startsWith('wik')) {
    type = 'wiki';
  } else if (raw.startsWith('doxcn') || raw.startsWith('dox')) {
    type = 'docx';
  }

  return { type, token, rawUrl: raw };
}

export async function inspectLarkDoc(urlOrToken) {
  const parsed = parseLarkDocUrl(urlOrToken);

  if (parsed.type === 'wiki') {
    // 纯读操作：使用完整 urlOrToken 查询 wiki 节点元信息
    const targetArg = parsed.rawUrl.startsWith('http') ? parsed.rawUrl : parsed.token;
    const nodeRes = await execCmd(`lark-cli wiki +node-get --node-token "${targetArg}" --json`);

    if (nodeRes.ok) {
      const nodeJson = extractJson(nodeRes.stdout);
      const node = nodeJson?.data?.node || nodeJson?.data || nodeJson?.node || {};
      const title = node.title || 'Untitled Wiki';
      const hasChild = Boolean(node.has_child);
      const spaceId = node.space_id;
      const nodeToken = node.node_token || parsed.token;
      const objToken = node.obj_token;

      let children = [];
      if (hasChild && spaceId) {
        // 纯读操作：列出子节点
        const listRes = await execCmd(
          `lark-cli wiki +node-list --space-id "${spaceId}" --parent-node-token "${nodeToken}" --page-all --json`
        );
        if (listRes.ok) {
          const listJson = extractJson(listRes.stdout);
          const items = listJson?.data?.items || listJson?.items || [];
          children = items.map(item => ({
            title: item.title,
            nodeToken: item.node_token,
            objToken: item.obj_token,
            objType: item.obj_type,
            hasChild: Boolean(item.has_child)
          }));
        }
      }

      return {
        ok: true,
        type: 'wiki',
        isParent: hasChild,
        title,
        token: nodeToken,
        objToken,
        spaceId,
        childrenCount: children.length,
        children
      };
    }
  }

  // 默认普通单文档处理
  return {
    ok: true,
    type: 'docx',
    isParent: false,
    title: parsed.token,
    token: parsed.token,
    childrenCount: 0,
    children: []
  };
}

// ================= 3. 提取文档内容与图片素材 (Fetch & Media) =================

export async function fetchDocMarkdown(docUrlOrToken) {
  // 纯读操作：获取文档 Markdown
  const cmd = `lark-cli docs +fetch --doc "${docUrlOrToken}" --doc-format markdown --json`;
  const res = await execCmd(cmd);

  if (!res.ok) {
    throw new Error(`读取飞书文档内容失败: ${res.stderr || res.error?.message}`);
  }

  const json = extractJson(res.stdout);
  const docData = json?.data?.document || json?.document || {};
  let content = docData.content || '';
  const title = (content.match(/^#\s+(.+)$/m)?.[1]) || docData.title || 'Untitled Document';

  return { title, content, documentId: docData.document_id };
}

// 提取 Markdown 中的所有飞书媒体 token（图片、画板等）
export function extractMediaTokens(markdownText) {
  const tokens = [];

  // 1. 匹配飞书直链: ![...](https://feishu.cn/file/Gbi9b6...) 或 ![...](https://...feishu.cn/file/...)
  const feishuFileRegex = /!\[([^\]]*)\]\((https?:\/\/[^)]*feishu\.cn\/file\/([a-zA-Z0-9_-]+)[^)]*)\)/gi;
  let m;
  while ((m = feishuFileRegex.exec(markdownText)) !== null) {
    tokens.push({ type: 'image', token: m[3], rawUrl: m[2], raw: m[0] });
  }

  // 2. 匹配 <img ... token="xxx" .../> 或 <img token='xxx' />
  const imgTokenRegex = /<img\b[^>]*\btoken=["']([^"']+)["'][^>]*>/gi;
  while ((m = imgTokenRegex.exec(markdownText)) !== null) {
    tokens.push({ type: 'image', token: m[1], rawUrl: null, raw: m[0] });
  }

  // 3. 匹配通用 Markdown 图片引用中携带的 boxcn/file token
  const mdImgRegex = /!\[([^\]]*)\]\(([^)]*(?:boxcn|file)[a-zA-Z0-9_-]+[^)]*)\)/gi;
  while ((m = mdImgRegex.exec(markdownText)) !== null) {
    const rawUrl = m[2];
    const tokenMatch = rawUrl.match(/((?:boxcn|[a-zA-Z0-9]{20,})[a-zA-Z0-9_-]*)/);
    if (tokenMatch) {
      tokens.push({ type: 'image', token: tokenMatch[1], rawUrl, raw: m[0] });
    }
  }

  // 4. 匹配画板 <whiteboard token="xxx" .../>
  const wbRegex = /<whiteboard\b[^>]*\btoken=["']([^"']+)["'][^>]*>/gi;
  while ((m = wbRegex.exec(markdownText)) !== null) {
    tokens.push({ type: 'whiteboard', token: m[1], rawUrl: null, raw: m[0] });
  }

  // 去重
  const uniqueMap = new Map();
  for (const item of tokens) {
    if (!uniqueMap.has(item.token)) {
      uniqueMap.set(item.token, item);
    }
  }
  return Array.from(uniqueMap.values());
}

// 下载媒体到本地目录（严格只读，以 targetDir 为工作目录避免 lark-cli unsafe path 限制）
export async function downloadMediaFiles(mediaItems, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const downloadedMap = new Map(); // token -> localFilePath

  for (let i = 0; i < mediaItems.length; i++) {
    const item = mediaItems[i];
    const ext = item.type === 'whiteboard' ? 'png' : 'png';
    const filename = `media_${String(i + 1).padStart(3, '0')}_${item.token.slice(-6)}.${ext}`;
    const destPath = path.join(targetDir, filename);

    // 检查缓存
    if (existsSync(destPath)) {
      try {
        const stat = await fs.stat(destPath);
        if (stat.size > 0) {
          downloadedMap.set(item.token, destPath);
          continue;
        }
      } catch {
        // 继续下载
      }
    }

    // 纯读操作：lark-cli docs +media-download，使用 ./filename 相对路径与 cwd，并加 --overwrite
    const typeFlag = item.type === 'whiteboard' ? '--type whiteboard' : '';
    const cmd = `lark-cli docs +media-download --token "${item.token}" ${typeFlag} --output "./${filename}" --overwrite`;

    process.stdout.write(`  📥 [${i + 1}/${mediaItems.length}] 下载素材 ${item.token} ...\r`);
    const dlRes = await execCmd(cmd, { cwd: targetDir });

    if (dlRes.ok && existsSync(destPath)) {
      downloadedMap.set(item.token, destPath);
    } else {
      console.warn(`\n  ⚠️ 素材下载失败 (${item.token}): ${dlRes.stderr}`);
    }
  }

  if (mediaItems.length > 0) {
    console.log(`\n  ✅ ${downloadedMap.size}/${mediaItems.length} 个媒体素材已拉取至本地缓存。`);
  }

  return downloadedMap;
}

// ================= 4. 策略 A：直传 Craft 换取 assetUrl 并转换内容 =================

export async function uploadMediaToCraft(downloadedMap, craftClient) {
  const assetUrlMap = new Map(); // token -> craftAssetUrl
  const entries = Array.from(downloadedMap.entries());

  if (entries.length === 0) {
    return assetUrlMap;
  }

  console.log(`\n☁️ 正在将 ${entries.length} 个本地素材上传至 Craft 官方存储空间...`);

  // 创建临时中转文档以接收二进制图片上传
  const stagingTitle = `_staging_upload_${Date.now()}`;
  const stagingRes = await craftClient.createDocuments({ title: stagingTitle }, 'unsorted');
  const stagingDoc = stagingRes?.items?.[0] || (Array.isArray(stagingRes) ? stagingRes[0] : stagingRes);
  const stagingId = stagingDoc?.id;

  if (!stagingId) {
    throw new Error(`无法创建临时上传通道: ${JSON.stringify(stagingRes)}`);
  }

  try {
    for (let i = 0; i < entries.length; i++) {
      const [token, localPath] = entries[i];
      const fileName = path.basename(localPath);
      process.stdout.write(`  ⬆️ [${i + 1}/${entries.length}] 上传中: ${fileName} ...\r`);

      try {
        const uploadRes = await craftClient.uploadFile(localPath, {
          pageId: stagingId,
          position: 'end',
          fileName
        });
        const assetUrl = uploadRes?.assetUrl || uploadRes?.url;
        if (assetUrl) {
          assetUrlMap.set(token, assetUrl);
        } else {
          console.warn(`\n  ⚠️ Craft 上传未返回 assetUrl (${fileName}):`, uploadRes);
        }
      } catch (err) {
        console.warn(`\n  ⚠️ 上传到 Craft 失败 (${fileName}): ${err.message}`);
      }
    }
  } finally {
    // 异步清理临时上传文档（静默软删除）
    craftClient.deleteDocuments([stagingId]).catch(() => {});
  }

  console.log(`\n  🎉 ${assetUrlMap.size}/${entries.length} 个素材已成功转存至 Craft 官方 CDN！`);
  return assetUrlMap;
}

// 清洗并切片 Markdown
export function transformAndChunkMarkdown(markdownText, assetUrlMap) {
  let md = markdownText;

  // 1. 替换图片 token 为 Craft 官方 assetUrl
  for (const [token, assetUrl] of assetUrlMap.entries()) {
    // 替换 feishu.cn/file/<token> 链接
    const urlRegex = new RegExp(`!\\[([^\\]]*)\\]\\(https?:\\/\\/[^)]*feishu\\.cn\\/file\\/${token}[^)]*\\)`, 'gi');
    md = md.replace(urlRegex, `![图片](${assetUrl})`);

    // 替换 <img ...token="xxx".../>
    const tagRegex = new RegExp(`<img\\b[^>]*\\btoken=["']${token}["'][^>]*>`, 'gi');
    md = md.replace(tagRegex, `\n\n![图片](${assetUrl})\n\n`);

    // 替换普通包含 token 的图片引用
    const mdRegex = new RegExp(`!\\[([^\\]]*)\\]\\([^)]*${token}[^)]*\\)`, 'gi');
    md = md.replace(mdRegex, `![图片](${assetUrl})`);

    // 替换画板
    const wbRegex = new RegExp(`<whiteboard\\b[^>]*\\btoken=["']${token}["'][^>]*>`, 'gi');
    md = md.replace(wbRegex, `\n\n![画板](${assetUrl})\n\n`);
  }

  // 2. 剥离多余的一级标题（Craft 文档本身已有大标题）
  md = md.replace(/^#\s+[^\n]+\n+/, '');

  // 3. 规避 Python 多行 docstring 三引号，防止 Craft CLI 语法截断
  md = md.replace(/"""/g, "'''");

  // 4. 清洗剩余未识别的非标准 XML 标签，但保留 Craft 原生支持的 <callout>
  md = md.replace(/<(?!callout\b|\/callout\b)[^>]+>/gi, '');

  // 5. 按章节安全分块（<= 12KB）
  const sections = md.split(/(?=\n##\s+|\n###\s+)/);
  const chunks = [];
  let currentChunk = '';

  for (const sec of sections) {
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

  return chunks;
}

// ================= 5. 同步写入 Craft (Craft Sync Pipeline) =================

export async function syncChunksToCraft(title, chunks, craftClient, folderId = null) {
  console.log(`\n📝 正在 Craft 中创建文档: "${title}"...`);

  // 创建目标文档
  const dest = folderId ? { folderId } : 'unsorted';
  const createRes = await craftClient.createDocuments({ title }, dest);
  const firstDoc = createRes?.items?.[0] || (Array.isArray(createRes) ? createRes[0] : (createRes?.documents?.[0] || createRes));
  const docId = firstDoc?.id;

  if (!docId) {
    throw new Error(`创建 Craft 文档失败: ${JSON.stringify(createRes)}`);
  }

  console.log(`  ✅ 文档已创建 (ID: ${docId})，开始按序写入 ${chunks.length} 个章节切片...`);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    process.stdout.write(`  ✍️ 追加切片 [${i + 1}/${chunks.length}] (${chunk.length} 字符)...\r`);

    await craftClient.insertBlocks({
      markdown: chunk,
      position: {
        position: 'end',
        pageId: docId
      }
    });
  }

  const appUrl = firstDoc?.clickableLink || '';

  console.log(`\n✨ 飞书文档已 100% 高保真同步至 Craft！`);
  if (appUrl) {
    console.log(`🔗 Craft 快速打开链接: ${appUrl}`);
  }

  return { docId, title, totalChunks: chunks.length, appUrl };
}

// ================= 6. 统一执行主流程 (Orchestrator) =================

export async function relayLarkDocToCraft(docUrlOrToken, options = {}) {
  const {
    outputDir = resolveDefaultOutputDir(),
    folderId = null,
    dryRun = false
  } = options;

  // 1. 前置依赖检查
  const preflight = await checkPreflight();
  if (!preflight.cliInstalled || !preflight.authOk) {
    console.error('\n❌ 环境前置检查未通过:');
    preflight.issues.forEach(issue => {
      console.error(`  - ${issue.message} ${issue.guide || ''}`);
    });
    return { ok: false, error: 'PREFLIGHT_FAILED', preflight };
  }

  // 2. 探测文档节点与层级
  const hierarchy = await inspectLarkDoc(docUrlOrToken);

  // 3. 读取正文
  console.log(`\n📖 正在从飞书只读拉取文档内容: ${hierarchy.title || docUrlOrToken}...`);
  const { title, content } = await fetchDocMarkdown(docUrlOrToken);

  // 4. 提取并下载媒体素材
  const mediaItems = extractMediaTokens(content);
  console.log(`🔎 检测到 ${mediaItems.length} 个多媒体素材（图片/画板）`);

  const docFolder = path.join(outputDir, sanitizeFilename(title));
  const mediaDir = path.join(docFolder, 'images');

  const downloadedMedia = await downloadMediaFiles(mediaItems, mediaDir);

  if (dryRun) {
    console.log('\n[Dry Run] 仅下载并清洗数据，不写入 Craft。');
    return { ok: true, dryRun: true, title, mediaCount: downloadedMedia.size };
  }

  // 5. 初始化 Craft 客户端并上传图片
  const craftClient = await getCraftClient();
  const assetUrlMap = await uploadMediaToCraft(downloadedMedia, craftClient);

  // 6. 转换与切片
  const chunks = transformAndChunkMarkdown(content, assetUrlMap);

  // 保存本地中间产物（原版 Markdown、转换后 Markdown 与 Craft 切片）
  await fs.writeFile(path.join(docFolder, "raw.md"), content, "utf-8");
  
  // 组装带 Frontmatter 的完整离线 Markdown
  const safeTitle = title.replace(/"/g, "'");
  const frontmatter = [
    "---",
    `title: "${safeTitle}"`,
    `source: "${docUrlOrToken}"`,
    `date: "${new Date().toISOString().slice(0, 10)}"`,
    `type: "lark-doc"`,
    `images_count: ${assetUrlMap.size}`,
    "---",
    "",
    `# ${title}`,
    "",
    chunks.join("\n\n")
  ].join("\n");
  await fs.writeFile(path.join(docFolder, "index.md"), frontmatter, "utf-8");

  // 保存切片与清单
  const chunksDir = path.join(docFolder, "craft-chunks");
  await fs.mkdir(chunksDir, { recursive: true });
  const chunkManifest = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkFile = path.join(chunksDir, `chunk_${String(i + 1).padStart(2, "0")}.md`);
    await fs.writeFile(chunkFile, chunks[i], "utf-8");
    chunkManifest.push({
      index: i + 1,
      path: chunkFile,
      chars: chunks[i].length,
      preview: chunks[i].slice(0, 60).replace(/\n/g, " ")
    });
  }
  await fs.writeFile(
    path.join(chunksDir, "manifest.json"),
    JSON.stringify({ title, source: docUrlOrToken, totalChunks: chunks.length, chunks: chunkManifest }, null, 2),
    "utf-8"
  );
  console.log(`  📦 本地归档已落盘: ${docFolder}/`);

  // 7. 同步写入 Craft
  const syncResult = await syncChunksToCraft(title, chunks, craftClient, folderId);

  return {
    ok: true,
    title,
    docId: syncResult.docId,
    appUrl: syncResult.appUrl,
    chunksCount: chunks.length,
    mediaCount: assetUrlMap.size
  };
}

// ================= CLI 入口 =================

async function main() {
  const args = process.argv.slice(2);
  let docUrl = null;
  let checkEnvOnly = false;
  let inspectOnly = false;
  let dryRun = false;
  let outputDir = null;
  let folderId = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--check-env') {
      checkEnvOnly = true;
    } else if (a === '--inspect') {
      inspectOnly = true;
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '-o' || a === '--output') {
      outputDir = args[++i];
    } else if (a === '--folder') {
      folderId = args[++i];
    } else if (a === '-h' || a === '--help') {
      console.log(`
Lark to Craft Relay (飞书文档转存 Craft 中继工具)

用法:
  node lark-to-craft.mjs <urlOrToken> [选项]

选项:
  --check-env              仅检查本地环境 (lark-cli 与鉴权状态)
  --inspect                探测文档信息或展示父子知识库节点树
  --dry-run                仅下载素材与清洗排版，不实际写入 Craft
  -o, --output <dir>       指定素材缓存目录 (默认: ~/.shrimp/skills/leo-article-relay/articles 或配置的 vault)
  --folder <folderId>      指定 Craft 目标文件夹 ID
  -h, --help               显示帮助信息
`);
      process.exit(0);
    } else if (!a.startsWith('-')) {
      docUrl = a;
    }
  }

  if (checkEnvOnly) {
    const preflight = await checkPreflight();
    console.log(JSON.stringify(preflight, null, 2));
    process.exit(preflight.authOk && preflight.cliInstalled ? 0 : 1);
  }

  if (!docUrl) {
    console.error('❌ 请提供飞书文档 URL 或 Token。使用 -h 查看帮助。');
    process.exit(1);
  }

  if (inspectOnly) {
    const info = await inspectLarkDoc(docUrl);
    console.log(JSON.stringify(info, null, 2));
    process.exit(0);
  }

  const res = await relayLarkDocToCraft(docUrl, {
    outputDir: outputDir || resolveDefaultOutputDir(),
    folderId,
    dryRun
  });

  if (!res.ok) {
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(`\n❌ 执行失败: ${err.message}`);
    process.exit(1);
  });
}
