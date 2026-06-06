#!/usr/bin/env node
/**
 * Dictation round tag display tests.
 *
 * R5/R6 are still review rounds and must show their real round labels.
 * Only R7+ is mastered and may show the check mark.
 */

import fs from 'node:fs';
import path from 'node:path';

const projectDir = path.dirname(import.meta.url.replace('file://', ''));
const appCode = fs.readFileSync(path.join(projectDir, '../js/app.js'), 'utf8');
const match = appCode.match(/function getDictationRoundTag\(round\) \{[\s\S]*?\n\}/);

let fail = 0;
function ok(cond, label) {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    console.log(`  ❌ ${label}`);
    fail++;
  }
}

console.log('\n=== Dictation round tag display ===');
ok(Boolean(match), 'getDictationRoundTag exists');

if (match) {
  const getDictationRoundTag = new Function(`${match[0]}; return getDictationRoundTag;`)();
  ok(getDictationRoundTag(5) === 'R5', 'R5 shows R5');
  ok(getDictationRoundTag(6) === 'R6', 'R6 shows R6');
  ok(getDictationRoundTag(7) === '✅', 'R7 shows mastered check mark');
}

if (fail > 0) {
  console.error(`\n${fail} tests failed`);
  process.exit(1);
}

console.log('\nAll tests passed');
