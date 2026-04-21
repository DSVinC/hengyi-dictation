#!/usr/bin/env node
/**
 * 恒一听写系统 - 进度数据恢复脚本
 * 从 GitHub 下载的进度文件中恢复数据并转换为 v2 格式
 */

const fs = require('fs');
const path = require('path');

const INPUT = '/tmp/hengyi_progress.json';
const OUTPUT = path.join(__dirname, 'data', 'recovered_progress_v2.json');

// ============================================
// v2 编码工具（与 progress-store.js 一致）
// ============================================

function hexUtf8(str) {
  let result = '';
  for (const char of str) {
    const code = char.codePointAt(0);
    if (code < 128) {
      result += char;
    } else {
      const bytes = new TextEncoder().encode(char);
      for (const byte of bytes) {
        result += byte.toString(16).padStart(2, '0');
      }
    }
  }
  return result;
}

function makeKey(subject, lessonId, text) {
  return subject + '|' + lessonId + '|' + hexUtf8(text);
}

// 判断文本是否损坏
function isCorrupted(text) {
  if (typeof text !== 'string' || text.length === 0) return true;
  // 如果有大量重复的 8 字节模式，说明是编码损坏
  const buf = Buffer.from(text, 'utf8');
  if (buf.length > 100 && text.length > 50) {
    // 检查是否包含典型损坏模式的字节
    const first8 = buf.slice(0, 8).toString('hex');
    if (first8.startsWith('c383c283') || first8.startsWith('c382c283')) {
      return true;
    }
  }
  // 中文范围检查：如果有中文字符则正常
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(text)) return false;
  // ASCII 英文也算正常
  if (/^[\x20-\x7E]+$/.test(text)) return false;
  // 其他非中文非ASCII的大字符串视为损坏
  if (text.length > 20) return true;
  return false;
}

// 尝试修复损坏文本
function tryFixText(text) {
  // 方法1: fixDoubleEncoded
  function fixDoubleEncoded(str) {
    try {
      let fixed = decodeURIComponent(encodeURI(str).replace(/%25/g, '%'));
      if (fixed !== str) {
        try { fixed = decodeURIComponent(fixed); } catch(e) {}
      }
      return fixed;
    } catch(e) { return str; }
  }
  
  const fixed1 = fixDoubleEncoded(text);
  if (!isCorrupted(fixed1)) return fixed1;
  
  // 方法2: 多次 Latin-1 round-trip
  let current = text;
  for (let i = 0; i < 10; i++) {
    const next = Buffer.from(current, 'latin1').toString('utf8');
    if (next === current) break;
    if (!isCorrupted(next)) return next;
    current = next;
  }
  
  return null; // 无法修复
}

// ============================================
// 主恢复逻辑
// ============================================

console.log('=== 恒一听写进度恢复 ===');
console.log('输入:', INPUT);

const raw = fs.readFileSync(INPUT, 'utf8');
const data = JSON.parse(raw);
const entries = Object.entries(data);

console.log('总记录数:', entries.length);

const recovered = [];
const corrupted = [];
const clean = [];

for (const [v1Key, item] of entries) {
  const subject = item.subject || v1Key.split('/')[0];
  const lessonId = item.lessonId || v1Key.split('/')[1];
  const text = item.text;
  
  if (!text) {
    corrupted.push({ v1Key, reason: 'no text', item });
    continue;
  }
  
  if (isCorrupted(text)) {
    const fixed = tryFixText(text);
    if (fixed) {
      recovered.push({ v1Key, fixedText: fixed, item });
    } else {
      corrupted.push({ v1Key, textPreview: text.slice(0, 40), item });
    }
  } else {
    clean.push({ v1Key, item });
  }
}

// 构建 v2 输出
const v2Records = {};

// 写入干净记录
for (const { v1Key, item } of clean) {
  const key = makeKey(item.subject, item.lessonId, item.text);
  v2Records[key] = {
    text: item.text,
    lessonId: item.lessonId,
    subject: item.subject,
    round: item.round || 0,
    nextReview: item.nextReview || null,
    wrongCount: item.wrongCount || 0,
    updatedAt: item.updatedAt
  };
}

// 写入修复成功的记录
for (const { v1Key, fixedText, item } of recovered) {
  const key = makeKey(item.subject, item.lessonId, fixedText);
  v2Records[key] = {
    text: fixedText,
    lessonId: item.lessonId,
    subject: item.subject,
    round: item.round || 0,
    nextReview: item.nextReview || null,
    wrongCount: item.wrongCount || 0,
    updatedAt: item.updatedAt
  };
}

// 统计
console.log('\n=== 恢复统计 ===');
console.log('✅ 完好记录:', clean.length);
console.log('🔧 修复成功:', recovered.length);
console.log('❌ 无法修复:', corrupted.length);
console.log('📦 v2 总记录:', Object.keys(v2Records).length);

// 展示完好记录样本
console.log('\n=== 完好记录样本 ===');
for (const { v1Key, item } of clean.slice(0, 5)) {
  const key = makeKey(item.subject, item.lessonId, item.text);
  console.log(`  ${v1Key} -> ${key}`);
  console.log(`    text="${item.text}"`);
}

if (recovered.length > 0) {
  console.log('\n=== 修复成功样本 ===');
  for (const { v1Key, fixedText, item } of recovered.slice(0, 3)) {
    const key = makeKey(item.subject, item.lessonId, fixedText);
    console.log(`  ${v1Key} -> ${key}`);
    console.log(`    text="${fixedText}"`);
  }
}

// 展示损坏记录样本
if (corrupted.length > 0) {
  console.log('\n=== 损坏记录样本 ===');
  for (const { v1Key, item } of corrupted.slice(0, 3)) {
    console.log(`  key: ${v1Key}`);
    console.log(`  text(前40): ${item.text ? item.text.slice(0, 40) : '(empty)'}`);
    console.log(`  subject: ${item.subject}, lessonId: ${item.lessonId}`);
  }
  console.log(`  ... 共 ${corrupted.length} 条损坏记录`);
  
  // 按 lesson 分组统计损坏
  const lessonCount = {};
  for (const { item } of corrupted) {
    const lid = item.lessonId || 'unknown';
    lessonCount[lid] = (lessonCount[lid] || 0) + 1;
  }
  console.log('\n  损坏按课次分布:');
  for (const [lid, count] of Object.entries(lessonCount).sort()) {
    console.log(`    ${lid}: ${count} 条`);
  }
}

// 写入输出文件
const outputDir = path.dirname(OUTPUT);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// JSON Lines 格式
const lines = Object.entries(v2Records).map(([key, record]) => 
  JSON.stringify({ key, ...record })
);
fs.writeFileSync(OUTPUT, lines.join('\n') + '\n', 'utf8');

console.log('\n📁 输出文件:', OUTPUT);
console.log('📊 输出大小:', (fs.statSync(OUTPUT).size / 1024).toFixed(1), 'KB');

// 验证：写入后用 tryDecodeHex 验证 key 格式
console.log('\n=== v2 Key 格式验证 ===');
let validKeys = 0;
for (const key of Object.keys(v2Records)) {
  const parts = key.split('|');
  if (parts.length >= 3) {
    const textHex = parts.slice(2).join('|');
    // 尝试解码
    if (/^[\da-fA-F]+$/.test(textHex) && textHex.length % 2 === 0) {
      validKeys++;
    }
  }
}
console.log('有效 v2 key:', validKeys, '/', Object.keys(v2Records).length);
