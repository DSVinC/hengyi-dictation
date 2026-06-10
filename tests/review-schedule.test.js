#!/usr/bin/env node
/**
 * Review schedule tests.
 *
 * Batch staggering may delay some review words to spread workload, but it must
 * never make a word due earlier than the configured Ebbinghaus interval.
 */

import fs from 'node:fs';
import path from 'node:path';

const projectDir = path.dirname(import.meta.url.replace('file://', ''));
const appCode = fs.readFileSync(path.join(projectDir, '../js/app.js'), 'utf8');

const intervalsMatch = appCode.match(/const EBINGHAUS_INTERVALS = \[[^\]]+\];/);
const timezoneMatch = appCode.match(/const BUSINESS_TIME_ZONE = '[^']+';/);
const shanghaiPartsMatch = appCode.match(/function getShanghaiDateParts\(d = new Date\(\)\) \{[\s\S]*?\n\}/);
const formatBusinessDateMatch = appCode.match(/function formatBusinessDate\(parts\) \{[\s\S]*?\n\}/);
const getLocalDateMatch = appCode.match(/function getLocalDate\(d = new Date\(\)\) \{[\s\S]*?\n\}/);
const addBusinessDaysMatch = appCode.match(/function addBusinessDays\(days, fromDate = new Date\(\)\) \{[\s\S]*?\n\}/);
const staggeredMatch = appCode.match(/function calculateStaggeredNextReview\(round, index = 0, totalInBatch = 1\) \{[\s\S]*?\n\}/);

let fail = 0;
function ok(cond, label) {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    console.log(`  ❌ ${label}`);
    fail++;
  }
}

function mockDate(dateStr) {
  const originalDate = globalThis.Date;
  const fixed = new originalDate(dateStr);
  globalThis.Date = class extends originalDate {
    constructor(...args) {
      if (args.length === 0) {
        super(fixed.getTime());
      } else {
        super(...args);
      }
    }

    static now() {
      return fixed.getTime();
    }
  };
  return () => {
    globalThis.Date = originalDate;
  };
}

console.log('\n=== Review schedule interval floor ===');
ok(Boolean(intervalsMatch), 'EBINGHAUS_INTERVALS exists');
ok(Boolean(timezoneMatch), 'BUSINESS_TIME_ZONE exists');
ok(Boolean(shanghaiPartsMatch), 'getShanghaiDateParts exists');
ok(Boolean(formatBusinessDateMatch), 'formatBusinessDate exists');
ok(Boolean(getLocalDateMatch), 'getLocalDate exists');
ok(Boolean(addBusinessDaysMatch), 'addBusinessDays exists');
ok(Boolean(staggeredMatch), 'calculateStaggeredNextReview exists');

if (intervalsMatch && timezoneMatch && shanghaiPartsMatch && formatBusinessDateMatch && getLocalDateMatch && addBusinessDaysMatch && staggeredMatch) {
  const calculateStaggeredNextReview = new Function(`
    ${intervalsMatch[0]}
    ${timezoneMatch[0]}
    ${shanghaiPartsMatch[0]}
    ${formatBusinessDateMatch[0]}
    ${getLocalDateMatch[0]}
    ${addBusinessDaysMatch[0]}
    ${staggeredMatch[0]}
    return calculateStaggeredNextReview;
  `)();

  const restoreDate = mockDate('2026-06-11T08:00:00+08:00');
  ok(
    calculateStaggeredNextReview(3, 0, 30) >= '2026-06-14',
    'R3 in a large batch is not due earlier than 3 days'
  );
  ok(
    calculateStaggeredNextReview(6, 0, 30) >= '2026-07-01',
    'R6 in a large batch is not due earlier than 20 days'
  );
  restoreDate();
}

if (fail > 0) {
  console.error(`\n${fail} tests failed`);
  process.exit(1);
}

console.log('\nAll tests passed');
