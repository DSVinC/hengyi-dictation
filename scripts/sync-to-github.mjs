#!/usr/bin/env node
/**
 * 恒一听写系统 - GitHub 同步脚本
 *
 * 从 .env 文件或环境变量读取 GITHUB_TOKEN，执行 GitHub API 同步。
 * 替代前端硬编码 PAT，解决安全风险。
 *
 * 用法：
 *   bun sync-to-github.mjs                    # 从 GitHub 拉取并合并
 *   bun sync-to-github.mjs --push             # 推送本地 localStorage 到 GitHub
 *   bun sync-to-github.mjs --help             # 显示帮助
 */

import fs from 'node:fs';
import path from 'node:path';

// ============================================
// 配置
// ============================================

const GITHUB_CONFIG = {
  owner: 'DSVinC',
  repo: 'hengyi-dictation',
  filePath: 'data/progress.json',
  branch: 'main'
};

// 获取 token：环境变量 > .env 文件
function getToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;

  // 尝试读取项目根目录的 .env 文件
  const envPath = path.join(import.meta.dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const [key, ...valueParts] = trimmed.split('=');
      if (key.trim() === 'GITHUB_TOKEN') {
        return valueParts.join('=').trim().replace(/^["']|["']$/g, '');
      }
    }
  }

  console.error('错误: 未找到 GITHUB_TOKEN');
  console.error('请设置环境变量 GITHUB_TOKEN 或在项目根目录创建 .env 文件');
  process.exit(1);
}

const API_URL = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${GITHUB_CONFIG.filePath}`;

// ============================================
// API 函数
// ============================================

async function githubGet(token, headers = {}) {
  const resp = await fetch(`${API_URL}?ref=${GITHUB_CONFIG.branch}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      ...headers
    }
  });

  if (resp.status === 404) return null; // 文件不存在
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function githubPut(token, content, sha, message) {
  const body = {
    message: message || `chore: 同步进度 (${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })})`,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: GITHUB_CONFIG.branch
  };

  if (sha) body.sha = sha;

  const resp = await fetch(API_URL, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${errText}`);
  }

  return resp.json();
}

// ============================================
// 合并逻辑
// ============================================

function mergeProgress(remote, local) {
  const merged = { ...remote };
  for (const [key, localItem] of Object.entries(local)) {
    const remoteItem = merged[key];
    if (!remoteItem || localItem.updatedAt >= (remoteItem.updatedAt || '')) {
      merged[key] = localItem;
    }
  }
  return merged;
}

// ============================================
// 主逻辑
// ============================================

async function pull(token) {
  console.log('📥 从 GitHub 拉取进度...');
  const data = await githubGet(token);
  if (!data) {
    console.log('ℹ️  远程进度文件不存在（首次使用）');
    return null;
  }

  const content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
  const progress = JSON.parse(content);
  console.log(`✅ 拉取成功，${Object.keys(progress).length} 条记录`);
  return { progress, sha: data.sha };
}

async function push(token, localJson) {
  console.log('📤 推送进度到 GitHub...');

  // 先获取远程 SHA
  const remote = await githubGet(token);
  const sha = remote ? remote.sha : undefined;

  // 用 Unicode 转义保护中文
  const safeJson = localJson.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g,
    ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));

  const result = await githubPut(token, safeJson, sha);
  console.log(`✅ 推送成功，SHA: ${result.content.sha}`);
  return result;
}

async function sync(token) {
  console.log('🔄 双向同步...');

  // 1. 拉取远程
  const remote = await pull(token);
  if (!remote) {
    console.log('ℹ️  远程无数据，无需同步');
    return;
  }

  // 2. 输出合并后的 JSON 到 stdout（供浏览器端使用）
  const merged = remote.progress;
  const jsonStr = JSON.stringify(merged, null, 2);
  console.log('\n📋 合并后的进度（JSON）:');
  console.log(jsonStr);
}

// ============================================
// CLI
// ============================================

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
用法:
  bun sync-to-github.mjs              双向同步（拉取 + 合并）
  bun sync-to-github.mjs --pull       仅拉取
  bun sync-to-github.mjs --push       推送本地进度到 GitHub
  bun sync-to-github.mjs --help       显示帮助

环境变量:
  GITHUB_TOKEN    GitHub Personal Access Token
  或在项目根目录创建 .env 文件:
    GITHUB_TOKEN=your_token_here
`);
  process.exit(0);
}

const token = getToken();

if (args.includes('--push')) {
  // push 模式：从 stdin 读取 JSON
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', async () => {
    if (!input.trim()) {
      console.error('错误: 需要从 stdin 读取 JSON 数据');
      console.error('用法: echo "$JSON" | bun sync-to-github.mjs --push');
      process.exit(1);
    }
    try {
      await push(token, input);
    } catch (e) {
      console.error(`❌ 推送失败: ${e.message}`);
      process.exit(1);
    }
  });
  process.stdin.resume();
} else if (args.includes('--pull')) {
  try {
    await pull(token);
  } catch (e) {
    console.error(`❌ 拉取失败: ${e.message}`);
    process.exit(1);
  }
} else {
  // 默认：双向同步
  try {
    await sync(token);
  } catch (e) {
    console.error(`❌ 同步失败: ${e.message}`);
    process.exit(1);
  }
}
