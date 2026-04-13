import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = '/Users/vvc/Projects/hengyi-dictation/data/chinese';

interface WordEntry {
  text: string;
  type: 'word' | 'char';
  round: number;
  nextReview: string | null;
  wrongCount: number;
  history: unknown[];
}

let totalRemoved = 0;
let filesProcessed = 0;

const files = readdirSync(DATA_DIR).filter(f => f.startsWith('L') && f.endsWith('.json'));

for (const file of files) {
  const filepath = join(DATA_DIR, file);
  const data = JSON.parse(readFileSync(filepath, 'utf-8')) as { words: WordEntry[] };

  const words = data.words.filter(w => w.type === 'word').map(w => w.text);

  const before = data.words.length;
  data.words = data.words.filter(w => {
    if (w.type !== 'char') return true;
    // Remove char if it appears in any word
    const covered = words.some(word => word.includes(w.text));
    if (covered) {
      totalRemoved++;
      return false;
    }
    return true;
  });
  const after = data.words.length;

  if (before !== after) {
    filesProcessed++;
    writeFileSync(filepath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    console.log(`${file}: ${before} → ${after} (移除 ${before - after} 个字)`);
  }
}

console.log(`\n处理完成: ${filesProcessed} 个文件有改动，共移除 ${totalRemoved} 个字`);
