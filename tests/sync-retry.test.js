#!/usr/bin/env node
/**
 * 云端同步重试保护回归测试。
 *
 * 当前听写工具是静态页面，云端同步逻辑在 js/app.js 中。
 * 这里用轻量源码断言保护两个关键点：
 * - progress.json 写入遇到 409 SHA 冲突会重新拉取后重试。
 * - daily-stats.json 写入遇到 409 SHA 冲突也会重新拉取后重试。
 */

import fs from 'node:fs';
import path from 'node:path';

const projectDir = path.dirname(import.meta.url.replace('file://', ''));
const source = fs.readFileSync(path.join(projectDir, '../js/app.js'), 'utf8');

let fail = 0;
function ok(cond, label) {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    console.log(`  ❌ ${label}`);
    fail++;
  }
}

console.log('\n=== Cloud sync retry safeguards ===');
ok(source.includes('const GITHUB_WRITE_MAX_ATTEMPTS = 3'), '统一配置最多重试 3 次');
ok(source.includes('(response.status === 409 || response.status === 412) && attempt < GITHUB_WRITE_MAX_ATTEMPTS'), '409/412 冲突会进入重试分支');
ok(source.includes('[Cloud Sync] 进度写入冲突，重新拉取后重试'), 'progress 同步有冲突重试日志');
ok(source.includes('[Cloud Sync] 每日统计写入冲突，重新拉取后重试'), 'daily-stats 同步有冲突重试日志');
ok(source.includes(`SyncState.status = 'synced';
      SyncState.lastSync = new Date();
      SyncState.error = null;
      updateSyncIndicator();`), 'daily-stats 成功后会清除顶部同步失败状态');

console.log('\n' + '='.repeat(50));
if (fail === 0) {
  console.log('✅ 全部通过！');
} else {
  console.log(`❌ ${fail} 项未通过`);
}
process.exit(fail > 0 ? 1 : 0);
