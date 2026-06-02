#!/usr/bin/env node
/**
 * 云端同步路由回归测试。
 *
 * 目的：
 * - 浏览器端不再直接请求 api.github.com。
 * - 听写工具改为调用 hengyi-learning-system 的云端同步接口。
 */

import fs from 'node:fs';
import path from 'node:path';

const projectDir = path.dirname(import.meta.url.replace('file://', ''));
const source = fs.readFileSync(path.join(projectDir, '../js/app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(projectDir, '../index.html'), 'utf8');

let fail = 0;
function ok(cond, label) {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    console.log(`  ❌ ${label}`);
    fail++;
  }
}

console.log('\n=== Cloud sync API migration ===');
ok(source.includes("const SYNC_API_BASE = window.HENGYI_SYNC_API_BASE || 'https://hengyi-learning-system.pages.dev/api/dictation-sync';"), '同步接口默认指向 growth system Pages API');
ok(source.includes("fetchWithTimeout(`${SYNC_API_BASE}?kind=progress"), '进度读取走云端同步 API');
ok(source.includes("fetchWithTimeout(`${SYNC_API_BASE}?kind=daily-stats"), '每日统计读取走云端同步 API');
ok(source.includes("kind: 'progress'"), '进度写入使用 progress kind');
ok(source.includes("kind: 'daily-stats'"), '每日统计写入使用 daily-stats kind');
ok(!source.includes("api.github.com/repos/DSVinC/hengyi-dictation/contents"), '浏览器端不再直连 GitHub contents API');
ok(indexHtml.includes('js/app.js?v=0.8.22'), '入口已提升 app.js 缓存版本');

console.log('\n' + '='.repeat(50));
if (fail === 0) {
  console.log('✅ 全部通过！');
} else {
  console.log(`❌ ${fail} 项未通过`);
}
process.exit(fail > 0 ? 1 : 0);
