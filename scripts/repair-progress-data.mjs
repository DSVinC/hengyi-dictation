#!/usr/bin/env node
/**
 * Repair mojibake progress data and convert v1 keys to v2 keys.
 *
 * Input:  /tmp/hengyi_progress.json
 * Output: data/progress.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT = '/tmp/hengyi_progress.json';
const OUTPUT = path.join(__dirname, '..', 'data', 'progress.json');
const MAX_FIX_ROUNDS = 20;

function hasChinese(str) {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(str);
}

function hasMojibake(str) {
  return /[ÃÂ]|[\u00c0-\u00ff]{2,}/.test(str);
}

function isValidChinese(str) {
  return hasChinese(str) && !hasMojibake(str);
}

function isPrintableAscii(str) {
  return /^[\x20-\x7e]+$/.test(str);
}

function decodeMojibake(text) {
  if (typeof text !== 'string') return { text, rounds: 0, status: 'non-string' };
  if (isValidChinese(text) || isPrintableAscii(text)) {
    return { text, rounds: 0, status: 'valid' };
  }

  let current = text;
  for (let round = 1; round <= MAX_FIX_ROUNDS; round++) {
    const next = Buffer.from(current, 'latin1').toString('utf8');
    if (next === current) break;
    current = next;

    if (isValidChinese(current) || isPrintableAscii(current)) {
      return { text: current, rounds: round, status: 'fixed' };
    }
  }

  return { text: current, rounds: MAX_FIX_ROUNDS, status: 'failed' };
}

function parseInput(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed).map(([key, value]) => ({ key, value }));
    }
  } catch {
    // Fall through to loose JSON-lines parsing.
  }

  const records = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim().replace(/,$/, '');
    if (!trimmed || trimmed === '{' || trimmed === '}') continue;
    const obj = JSON.parse(trimmed);
    for (const [key, value] of Object.entries(obj)) {
      records.push({ key, value });
    }
  }
  return records;
}

function parseV1Key(key) {
  const first = key.indexOf('/');
  if (first === -1) return null;
  const second = key.indexOf('/', first + 1);
  if (second === -1) return null;
  return {
    subject: key.slice(0, first),
    lessonId: key.slice(first + 1, second),
    text: key.slice(second + 1)
  };
}

function hexUtf8(str) {
  let result = '';
  for (const char of str) {
    if (char.codePointAt(0) < 128) {
      result += char;
      continue;
    }

    for (const byte of new TextEncoder().encode(char)) {
      result += byte.toString(16).padStart(2, '0');
    }
  }
  return result;
}

function makeV2Key(subject, lessonId, text) {
  return `${subject}|${lessonId}|${hexUtf8(text)}`;
}

function unicodeEscapeChinese(json) {
  return json.replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, (char) =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

function isNewer(candidate, existing) {
  return (candidate.updatedAt || '') >= (existing.updatedAt || '');
}

const records = parseInput(INPUT);
const repaired = {};
const stats = {
  total: records.length,
  valid: 0,
  fixed: 0,
  failed: 0,
  duplicate: 0
};
const failedSamples = [];

for (const { key, value } of records) {
  const parsed = parseV1Key(key);
  const subject = value?.subject || parsed?.subject;
  const lessonId = value?.lessonId || parsed?.lessonId;
  const rawText = value?.text || parsed?.text;

  if (!subject || !lessonId || typeof rawText !== 'string') {
    stats.failed++;
    if (failedSamples.length < 10) failedSamples.push({ key, reason: 'missing required fields' });
    continue;
  }

  const fixed = decodeMojibake(rawText);
  if (fixed.status === 'fixed') stats.fixed++;
  else if (fixed.status === 'valid') stats.valid++;
  else {
    stats.failed++;
    if (failedSamples.length < 10) {
      failedSamples.push({
        key: key.slice(0, 120),
        text: rawText.slice(0, 80),
        result: String(fixed.text).slice(0, 80)
      });
    }
  }

  const v2Key = makeV2Key(subject, lessonId, fixed.text);
  const item = {
    text: fixed.text,
    lessonId,
    subject,
    round: value?.round || 0,
    nextReview: value?.nextReview || null,
    wrongCount: value?.wrongCount || 0,
    updatedAt: value?.updatedAt || new Date(0).toISOString()
  };

  if (repaired[v2Key]) {
    stats.duplicate++;
    if (!isNewer(item, repaired[v2Key])) continue;
  }
  repaired[v2Key] = item;
}

const outputJson = unicodeEscapeChinese(JSON.stringify(repaired, null, 2));
fs.writeFileSync(OUTPUT, `${outputJson}\n`, 'utf8');

console.log('Progress repair complete');
console.log(`Input records: ${stats.total}`);
console.log(`Valid records: ${stats.valid}`);
console.log(`Fixed records: ${stats.fixed}`);
console.log(`Failed records: ${stats.failed}`);
console.log(`Duplicate v2 keys: ${stats.duplicate}`);
console.log(`Output records: ${Object.keys(repaired).length}`);
console.log(`Output: ${OUTPUT}`);

if (failedSamples.length) {
  console.log('Failed samples:');
  for (const sample of failedSamples) console.log(JSON.stringify(sample));
}
