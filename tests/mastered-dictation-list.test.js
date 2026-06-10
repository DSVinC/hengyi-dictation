#!/usr/bin/env node
/**
 * Mastered dictation list tests.
 *
 * Mastered sample words are part of the dictation stage, so the visible total
 * must count them before grading starts.
 */

import fs from 'node:fs';
import path from 'node:path';

const projectDir = path.dirname(import.meta.url.replace('file://', ''));
const appCode = fs.readFileSync(path.join(projectDir, '../js/app.js'), 'utf8');

let fail = 0;
function ok(cond, label) {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    console.log(`  ❌ ${label}`);
    fail++;
  }
}

console.log('\n=== Mastered words are included in dictation totals ===');
ok(
  /const totalIncluded = finalR0\.length \+ finalR1\.length \+ finalR2Plus\.length \+ finalMastered\.length;/.test(appCode),
  'dictation total includes mastered sample words'
);
ok(
  /掌握词抽查 \(\$\{finalMastered\.length\}\)/.test(appCode),
  'mastered sample section is rendered in the dictation list'
);

if (fail > 0) {
  console.error(`\n${fail} tests failed`);
  process.exit(1);
}

console.log('\nAll tests passed');
