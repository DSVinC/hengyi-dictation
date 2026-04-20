#!/usr/bin/env node
/**
 * progress-store.js 回归测试
 * 覆盖 Codex 验收发现的 4 个 bug
 */

import fs from 'node:fs';
import path from 'node:path';

const projectDir = import.meta.dirname;
const code = fs.readFileSync(path.join(projectDir, 'js/progress-store.js'), 'utf8');

// ============================================
// Mock localStorage
// ============================================
const ls = {};
globalThis.localStorage = {
  getItem(k) { return ls[k] ?? null; },
  setItem(k, v) { ls[k] = String(v); },
  removeItem(k) { delete ls[k]; },
  clear() { Object.keys(ls).forEach(k => delete ls[k]); }
};

// Helper: reset mock
function reset() {
  Object.keys(ls).forEach(k => delete ls[k]);
}

// ============================================
// Extract module symbols
// progress-store.js 使用 const/function 声明在模块顶层，
// 我们需要通过构造 wrapper 来获取它们。
// ============================================
const wrapper = `
${code}
return { hexUtf8, tryDecodeHex, makeKey, parseV1Key, migrateV1ToV2, sanitizeLocalStorageProgress, ProgressStore, V1_STORAGE_KEY, V2_STORAGE_KEY, V2_MIGRATED_FLAG };
`;
const mod = new Function(wrapper)();

const { hexUtf8, tryDecodeHex, makeKey, parseV1Key, migrateV1ToV2, ProgressStore, V1_STORAGE_KEY, V2_STORAGE_KEY, V2_MIGRATED_FLAG } = mod;

let fail = 0;
function ok(cond, label) {
  if (cond) { console.log(`  ✅ ${label}`); }
  else { console.log(`  ❌ ${label}`); fail++; }
}

// ============================================
// Bug 1: hexUtf8
// ============================================
console.log('\n=== Bug 1: hexUtf8 ===');
ok(hexUtf8('abc') === 'abc', "ASCII 'abc' → 'abc'");
ok(hexUtf8('你好') === 'e4bda0e5a5bd', "中文 '你好' → 'e4bda0e5a5bd'");
let emojiOk = false, emojiResult = '';
try { emojiResult = hexUtf8('😀'); emojiOk = emojiResult === 'f09f9880'; } catch (e) {}
ok(emojiOk, "emoji '😀' → 'f09f9880' (got: " + emojiResult + ")");

// ============================================
// Bug 2: tryDecodeHex
// ============================================
console.log('\n=== Bug 2: tryDecodeHex ===');
ok(tryDecodeHex('abc') === 'abc', "'abc' 不解码");
ok(tryDecodeHex('babe') === 'babe', "'babe' (巧合 hex) 不解码");
ok(tryDecodeHex('e4bda0') === '你', "'e4bda0' → '你'");
ok(tryDecodeHex('e4bda0e5a5bd') === '你好', "'e4bda0e5a5bd' → '你好'");
ok(tryDecodeHex('123') === '123', "奇数长度不解码");
ok(tryDecodeHex('zzzz') === 'zzzz', "非 hex 字符不解码");

// ============================================
// Bug 3: migrateV1ToV2 合并已有 v2 数据
// ============================================
console.log('\n=== Bug 3: migrateV1ToV2 ===');

// 场景 A：v2 数据较新，不应被旧 v1 覆盖
reset();
localStorage.setItem(V2_STORAGE_KEY, JSON.stringify({
  'chinese|1|e5ae9ee9aa8c': { text:'实验', lessonId:'1', subject:'chinese', round:3, updatedAt:'2026-04-20T12:00:00Z' },
  'english|2|apple': { text:'apple', lessonId:'2', subject:'english', round:2, updatedAt:'2026-04-20T10:00:00Z' }
}));
localStorage.setItem(V1_STORAGE_KEY, JSON.stringify({
  'chinese/1/实验': { text:'实验', lessonId:'1', subject:'chinese', round:1, updatedAt:'2026-04-19T08:00:00Z' },
  'chinese/1/词语': { text:'词语', lessonId:'1', subject:'chinese', round:1, updatedAt:'2026-04-19T08:00:00Z' }
}));
localStorage.removeItem(V2_MIGRATED_FLAG);
migrateV1ToV2();
const r = JSON.parse(localStorage.getItem(V2_STORAGE_KEY));
const keys = Object.keys(r);
ok(keys.length === 3, `总记录数=3 (实际 ${keys.length}) keys=${JSON.stringify(keys)}`);
ok(r['chinese|1|e5ae9ee9aa8c']?.round === 3, "已有 v2 round=3 未被旧 v1 round=1 覆盖");
ok(r['english|2|apple']?.text === 'apple', "已有 v2 apple 保留");
ok(r['chinese|1|e8af8de8afad']?.text === '词语', "v1 新词 '词语' 已迁移");

// 场景 B：v1 数据较新，应覆盖旧 v2
reset();
localStorage.setItem(V2_STORAGE_KEY, JSON.stringify({
  'chinese|1|e5ae9ee9aa8c': { text:'实验', lessonId:'1', subject:'chinese', round:1, updatedAt:'2026-04-18T08:00:00Z' }
}));
localStorage.setItem(V1_STORAGE_KEY, JSON.stringify({
  'chinese/1/实验': { text:'实验', lessonId:'1', subject:'chinese', round:3, updatedAt:'2026-04-20T12:00:00Z' }
}));
localStorage.removeItem(V2_MIGRATED_FLAG);
migrateV1ToV2();
const r2 = JSON.parse(localStorage.getItem(V2_STORAGE_KEY));
ok(r2['chinese|1|e5ae9ee9aa8c']?.round === 3, "v1 较新 round=3 应覆盖旧 v2 round=1");

// 场景 C：无 v1 数据时只设 flag
reset();
localStorage.removeItem(V1_STORAGE_KEY);
localStorage.removeItem(V2_MIGRATED_FLAG);
migrateV1ToV2();
ok(localStorage.getItem(V2_MIGRATED_FLAG) === '1', "无 v1 数据时仍设置迁移 flag");

// ============================================
// Bug 4: mergeFromRemote 处理 v1/v2 混合格式
// ============================================
console.log('\n=== Bug 4: mergeFromRemote ===');

reset();
localStorage.setItem(V2_STORAGE_KEY, JSON.stringify({}));
ProgressStore.mergeFromRemote({
  'chinese/1/你好': { text:'你好', lessonId:'1', subject:'chinese', round:1, updatedAt:'2026-04-20T08:00:00Z' },
  'chinese|2|e5ae9ee9aa8c': { text:'实验', lessonId:'2', subject:'chinese', round:2, updatedAt:'2026-04-20T09:00:00Z' }
});
const m = ProgressStore.getAll();
const mk = Object.keys(m);
ok(mk.length === 2, `总记录数=2 (实际 ${mk.length}) keys=${JSON.stringify(mk)}`);
ok(m['chinese|1|e4bda0e5a5bd']?.text === '你好', "v1 key 转为 v2 'chinese|1|e4bda0e5a5bd'");
ok(m['chinese|2|e5ae9ee9aa8c']?.text === '实验', "v2 key 保持不变");
ok(!mk.some(k => k.includes('/')), "无 v1 残留 key");

// 混合场景：本地有 v2，远程 v1 key 冲突（本地较新）
reset();
localStorage.setItem(V2_STORAGE_KEY, JSON.stringify({
  'chinese|1|e4bda0e5a5bd': { text:'你好', lessonId:'1', subject:'chinese', round:2, updatedAt:'2026-04-20T10:00:00Z' }
}));
ProgressStore.mergeFromRemote({
  'chinese/1/你好': { text:'你好', lessonId:'1', subject:'chinese', round:1, updatedAt:'2026-04-19T08:00:00Z' }
});
const m2 = ProgressStore.getAll();
const m2k = Object.keys(m2);
ok(m2k.length === 1, `不重复记录=1 (实际 ${m2k.length})`);
ok(m2['chinese|1|e4bda0e5a5bd']?.round === 2, "本地较新 round=2 保留");

// ============================================
// Summary
// ============================================
console.log('\n' + '='.repeat(50));
if (fail === 0) {
  console.log('✅ 全部通过！');
} else {
  console.log(`❌ ${fail} 项未通过`);
}
process.exit(fail > 0 ? 1 : 0);
