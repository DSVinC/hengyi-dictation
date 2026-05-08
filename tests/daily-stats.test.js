#!/usr/bin/env node
/**
 * daily-stats.js 单元测试
 * 
 * 测试覆盖：
 * - record(subject, correct, total)：记录一次听写的正确/总数
 * - getAll()：返回完整数据对象
 * - 同日累加：若当天该科目已有记录，correct += newCorrect, total += newTotal
 * - 不同科目互不影响
 * - 跨天自动创建新记录
 * - 空数据时 getAll() 返回空对象 {}
 */

import fs from 'node:fs';
import path from 'node:path';

const projectDir = path.dirname(import.meta.url.replace('file://', ''));
const code = fs.readFileSync(path.join(projectDir, '../js/daily-stats.js'), 'utf8');

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

// Helper: mock date
function mockDate(dateStr) {
  const originalDate = globalThis.Date;
  const mockDate = class extends originalDate {
    constructor(...args) {
      if (args.length === 0) {
        super(dateStr);
      } else {
        super(...args);
      }
    }
    static now() {
      return new originalDate(dateStr).getTime();
    }
  };
  globalThis.Date = mockDate;
  return () => { globalThis.Date = originalDate; };
}

// ============================================
// Extract module symbols
// ============================================
const wrapper = `
${code}
return { DailyStats, getLocalDateString, DAILY_STATS_STORAGE_KEY };
`;
const mod = new Function(wrapper)();

const { DailyStats, getLocalDateString, DAILY_STATS_STORAGE_KEY } = mod;

let fail = 0;
function ok(cond, label) {
  if (cond) { console.log(`  ✅ ${label}`); }
  else { console.log(`  ❌ ${label}`); fail++; }
}

// ============================================
// Test 1: 空数据时 getAll() 返回空对象 {}
// ============================================
console.log('\n=== Test 1: 空数据时 getAll() 返回空对象 {} ===');
reset();
const empty = DailyStats.getAll();
ok(typeof empty === 'object', '返回的是对象');
ok(Object.keys(empty).length === 0, '对象为空');

// ============================================
// Test 2: record("chinese", 17, 20) 后 getAll() 返回当天语文数据
// ============================================
console.log('\n=== Test 2: record("chinese", 17, 20) 后 getAll() 返回当天语文数据 ===');
reset();
const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

DailyStats.record('chinese', 17, 20);
const result = DailyStats.getAll();

ok(result[today] !== undefined, '当天有数据');
ok(result[today].chinese !== undefined, '语文科目有数据');
ok(result[today].chinese.correct === 17, '语文正确数=17');
ok(result[today].chinese.total === 20, '语文总数=20');

// ============================================
// Test 3: 同日再 record("chinese", 3, 5) 后 correct=20, total=25
// ============================================
console.log('\n=== Test 3: 同日再 record("chinese", 3, 5) 后 correct=20, total=25 ===');
reset();

DailyStats.record('chinese', 17, 20);
DailyStats.record('chinese', 3, 5);

const result2 = DailyStats.getAll();
const todayData2 = result2[new Date().toISOString().split('T')[0]];

ok(todayData2.chinese.correct === 20, '累计正确数=20 (17+3)');
ok(todayData2.chinese.total === 25, '累计总数=25 (20+5)');

// ============================================
// Test 4: 不同科目互不影响
// ============================================
console.log('\n=== Test 4: 不同科目互不影响 ===');
reset();

DailyStats.record('chinese', 17, 20);
DailyStats.record('english', 15, 18);

const result3 = DailyStats.getAll();
const todayData3 = result3[new Date().toISOString().split('T')[0]];

ok(todayData3.chinese.correct === 17, '语文正确数=17');
ok(todayData3.chinese.total === 20, '语文总数=20');
ok(todayData3.english.correct === 15, '英语正确数=15');
ok(todayData3.english.total === 18, '英语总数=18');

// ============================================
// Test 5: 跨天自动创建新记录
// ============================================
console.log('\n=== Test 5: 跨天自动创建新记录 ===');
reset();

// 模拟第一天
const restoreDay1 = mockDate('2026-05-08T12:00:00');
DailyStats.record('chinese', 17, 20);
restoreDay1();

// 模拟第二天
const restoreDay2 = mockDate('2026-05-09T12:00:00');
DailyStats.record('chinese', 15, 18);
DailyStats.record('english', 10, 12);
restoreDay2();

const result4 = DailyStats.getAll();

ok(result4['2026-05-08'] !== undefined, '第一天有数据');
ok(result4['2026-05-09'] !== undefined, '第二天有数据');
ok(result4['2026-05-08'].chinese.correct === 17, '第一天语文正确数=17');
ok(result4['2026-05-08'].chinese.total === 20, '第一天语文总数=20');
ok(result4['2026-05-09'].chinese.correct === 15, '第二天语文正确数=15');
ok(result4['2026-05-09'].chinese.total === 18, '第二天语文总数=18');
ok(result4['2026-05-09'].english.correct === 10, '第二天英语正确数=10');
ok(result4['2026-05-09'].english.total === 12, '第二天英语总数=12');

// ============================================
// Test 6: 参数校验 - 科目必须是 "chinese" 或 "english"
// ============================================
console.log('\n=== Test 6: 参数校验 - 科目必须是 "chinese" 或 "english" ===');
reset();

DailyStats.record('math', 10, 10); // 无效科目
const result5 = DailyStats.getAll();

ok(Object.keys(result5).length === 0, '无效科目不创建记录');

// ============================================
// Test 7: 参数校验 - correct 和 total 必须是数字
// ============================================
console.log('\n=== Test 7: 参数校验 - correct 和 total 必须是数字 ===');
reset();

DailyStats.record('chinese', '17', 20); // 字符串参数
DailyStats.record('english', 15, '18'); // 字符串参数
const result6 = DailyStats.getAll();

ok(Object.keys(result6).length === 0, '非数字参数不创建记录');

// ============================================
// Test 8: 参数校验 - correct 和 total 不能为负数
// ============================================
console.log('\n=== Test 8: 参数校验 - correct 和 total 不能为负数 ===');
reset();

DailyStats.record('chinese', -1, 20); // 负数 correct
DailyStats.record('english', 15, -5); // 负数 total
const result7 = DailyStats.getAll();

ok(Object.keys(result7).length === 0, '负数参数不创建记录');

// ============================================
// Test 9: getToday() 返回今天的统计数据
// ============================================
console.log('\n=== Test 9: getToday() 返回今天的统计数据 ===');
reset();

DailyStats.record('chinese', 17, 20);
DailyStats.record('english', 15, 18);

const todayData = DailyStats.getToday();

ok(todayData !== null, '返回今天数据');
ok(todayData.chinese.correct === 17, '今天语文正确数=17');
ok(todayData.english.correct === 15, '今天英语正确数=15');

// ============================================
// Test 10: getByDate() 返回指定日期的统计数据
// ============================================
console.log('\n=== Test 10: getByDate() 返回指定日期的统计数据 ===');
reset();

const restoreDay10 = mockDate('2026-05-08T12:00:00');
DailyStats.record('chinese', 17, 20);
restoreDay10();

const dayData = DailyStats.getByDate('2026-05-08');

ok(dayData !== null, '返回指定日期数据');
ok(dayData.chinese.correct === 17, '指定日期语文正确数=17');

// ============================================
// Test 11: clear() 清除所有数据
// ============================================
console.log('\n=== Test 11: clear() 清除所有数据 ===');
reset();

DailyStats.record('chinese', 17, 20);
DailyStats.clear();

const emptyData = DailyStats.getAll();

ok(Object.keys(emptyData).length === 0, '清除后数据为空');

// ============================================
// Test 12: getLocalDateString() 返回本地时区日期
// ============================================
console.log('\n=== Test 12: getLocalDateString() 返回本地时区日期 ===');

const dateStr = getLocalDateString();
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

ok(dateRegex.test(dateStr), '日期格式为 YYYY-MM-DD');

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