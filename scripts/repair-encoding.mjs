#!/usr/bin/env node
/**
 * 恒一听写系统 - 深度编码修复脚本
 * 
 * 从 /tmp/hengyi_progress.json 读取损坏数据
 * 在 Buffer/bytes 层面进行多轮 Latin-1→UTF-8 反转
 * 
 * 输出：
 *   /tmp/hengyi_progress.repaired.json - 修复后的数据
 *   /tmp/hengyi_repair_report.json - 修复报告
 */

import fs from 'node:fs';

// ============================================================
// 编码修复核心逻辑
// ============================================================

/**
 * 从字符串重建原始字节
 * Node.js 读文件时 UTF-8 解码得到的字符串，转回原始 bytes
 */
function stringToBytes(str) {
  return Buffer.from(str, 'utf8');
}

/**
 * 将 bytes 按 latin1 解释为字符串
 * 这是反转编码损坏的关键步骤
 */
function bytesAsLatin1(buf) {
  return buf.toString('latin1');
}

/**
 * 尝试一轮反转：当前字符串 → 取原始字节 → 按 latin1 解释
 * 如果损坏是 "UTF-8 bytes 被 latin1 误读后又用 UTF-8 编码"
 * 这一步就能恢复一层
 */
function oneRound(s) {
  const bytes = stringToBytes(s);
  return bytesAsLatin1(bytes);
}

/**
 * 判断字符串是否是有效的中文字符串
 * 包含 CJK 字符且不含典型 mojibake 字符
 */
function isValidChinese(str) {
  // 包含 CJK 字符
  const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(str);
  if (!hasCJK) return false;
  
  // 不含典型 mojibake 字符
  const hasMojibake = /[\u00c0-\u00ff]/.test(str); // Ã, Â, etc.
  if (hasMojibake) return false;
  
  // 不含控制字符（除了正常的）
  const hasControl = /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(str);
  if (hasControl) return false;
  
  return true;
}

/**
 * 判断字符串是否已经是有效的（英文或中文）
 */
function isValidString(str) {
  if (typeof str !== 'string') return true;
  if (str.length === 0) return false;
  
  // 纯英文（ASCII）
  if (/^[\x20-\x7e]+$/.test(str)) return true;
  
  // 有效中文
  if (isValidChinese(str)) return true;
  
  return false;
}

/**
 * 判断字符串是否是损坏的（mojibake）
 */
function isMojibake(str) {
  if (typeof str !== 'string') return false;
  // 包含 Ã Â 等典型 mojibake 字符
  return /[\u00c0-\u00ff]{2,}/.test(str);
}

/**
 * 深度修复：最多尝试 10 轮反转
 */
function deepFix(str, maxRounds = 10) {
  if (!isMojibake(str)) return { result: str, rounds: 0, status: 'already-valid' };
  
  let current = str;
  for (let i = 1; i <= maxRounds; i++) {
    const next = oneRound(current);
    
    // 如果这轮没有变化，说明到极限了
    if (next === current) {
      // 检查当前结果是否有效
      if (isValidChinese(current) || /^[a-zA-Z0-9\s\p{P}]+$/u.test(current)) {
        return { result: current, rounds: i - 1, status: 'encoding-fixed' };
      }
      return { result: current, rounds: i - 1, status: 'partial' };
    }
    
    current = next;
    
    // 检查是否得到有效中文
    if (isValidChinese(current)) {
      return { result: current, rounds: i, status: 'encoding-fixed' };
    }
    
    // 如果变成纯 ASCII 了（不太可能但对于英文记录）
    if (/^[\x20-\x7e]+$/.test(current)) {
      return { result: current, rounds: i, status: 'encoding-fixed' };
    }
  }
  
  // 达到最大轮数
  if (isValidChinese(current)) {
    return { result: current, rounds: maxRounds, status: 'encoding-fixed' };
  }
  return { result: current, rounds: maxRounds, status: 'failed' };
}

// ============================================================
// 数据解析
// ============================================================

function parseFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  
  const records = [];
  
  for (const line of lines) {
    try {
      // 每行是一个 JSON 对象：{"key": value},
      const trimmed = line.replace(/,\s*$/, '');
      const obj = JSON.parse(trimmed);
      
      for (const [key, value] of Object.entries(obj)) {
        records.push({ key, value });
      }
    } catch (e) {
      console.error(`⚠️  解析失败行: ${line.substring(0, 80)}...`);
    }
  }
  
  return records;
}

// ============================================================
// V2 key 编码
// ============================================================

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

function makeV2Key(subject, lessonId, text) {
  return `${subject}|${lessonId}|${hexUtf8(text)}`;
}

// ============================================================
// 解析 v1 key
// ============================================================

function parseV1Key(key) {
  // 格式：subject/lessonId/text
  const slashIdx = key.indexOf('/');
  if (slashIdx === -1) return null;
  
  const subject = key.substring(0, slashIdx);
  const rest = key.substring(slashIdx + 1);
  const slashIdx2 = rest.indexOf('/');
  if (slashIdx2 === -1) return null;
  
  const lessonId = rest.substring(0, slashIdx2);
  const text = rest.substring(slashIdx2 + 1);
  
  return { subject, lessonId, text };
}

// ============================================================
// 主流程
// ============================================================

const INPUT = '/tmp/hengyi_progress.json';
const OUTPUT = '/tmp/hengyi_progress.repaired.json';
const REPORT = '/tmp/hengyi_repair_report.json';

console.log('🔧 恒一听写系统 - 深度编码修复');
console.log(`📂 读取: ${INPUT}`);

const records = parseFile(INPUT);
console.log(`📋 共 ${records.length} 条记录`);

const repaired = {};
const report = {
  total: records.length,
  alreadyValid: 0,
  encodingFixed: 0,
  partial: 0,
  failed: 0,
  samples: [],
  failedRecords: [],
  v2Records: {}
};

for (const { key, value } of records) {
  const parsed = parseV1Key(key);
  if (!parsed) {
    console.warn(`⚠️  无法解析 key: ${key.substring(0, 60)}`);
    continue;
  }
  
  const { subject, lessonId, text } = parsed;
  
  // 修复 text 字段
  const fixResult = deepFix(text);
  
  if (fixResult.status === 'already-valid') {
    report.alreadyValid++;
  } else if (fixResult.status === 'encoding-fixed') {
    report.encodingFixed++;
  } else if (fixResult.status === 'partial') {
    report.partial++;
  } else {
    report.failed++;
    report.failedRecords.push({
      originalKey: key,
      originalText: text.substring(0, 50),
      repairedText: fixResult.result.substring(0, 50),
      rounds: fixResult.rounds
    });
  }
  
  // 采样
  if (report.samples.length < 30) {
    report.samples.push({
      key: key.substring(0, 80),
      originalText: text.substring(0, 40),
      repairedText: fixResult.result.substring(0, 40),
      status: fixResult.status,
      rounds: fixResult.rounds
    });
  }
  
  // 构建 v2 key
  const v2Key = makeV2Key(subject, lessonId, fixResult.result);
  repaired[v2Key] = {
    ...value,
    text: fixResult.result,
    subject,
    lessonId
  };
  report.v2Records[v2Key] = {
    subject,
    lessonId,
    text: fixResult.result,
    status: fixResult.status
  };
}

// 输出
const repairedJson = JSON.stringify(repaired, null, 2);
// Unicode 转义保护中文
const safeJson = repairedJson.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g,
  ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));

fs.writeFileSync(OUTPUT, safeJson);
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));

console.log('\n📊 修复统计:');
console.log(`  总记录数: ${report.total}`);
console.log(`  完好记录: ${report.alreadyValid}`);
console.log(`  编码修复: ${report.encodingFixed}`);
console.log(`  部分修复: ${report.partial}`);
console.log(`  修复失败: ${report.failed}`);
console.log(`  恢复率:   ${((report.alreadyValid + report.encodingFixed) / report.total * 100).toFixed(1)}%`);

console.log(`\n📁 输出: ${OUTPUT}`);
console.log(`📋 报告: ${REPORT}`);

// 显示样例
console.log('\n📝 修复样例:');
for (const sample of report.samples.slice(0, 10)) {
  console.log(`  [${sample.status}] "${sample.originalText}" → "${sample.repairedText}" (${sample.rounds} 轮)`);
}
