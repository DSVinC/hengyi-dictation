import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_FILE = '/Users/vvc/Projects/hengyi-dictation/三年级下册语文.txt';
const DATA_DIR = '/Users/vvc/Projects/hengyi-dictation/data/chinese';

// 课名映射
const lessonNameMap: Record<string, string> = {
  '第2课': '第2课',
  '第3课': '第3课',
  '第4课': '语文园地一',
  '第5课': '第5课',
  '第6课': '第6课',
  '第7课': '第7课',
  '第9课': '第9课',
  '第10课': '第10课',
  '第12课': '第12课',
  '第13课': '第13课',
  '第14课': '第14课',
  '第15课': '语文园地二',
  '第16课': '第16课',
  '第17课': '第17课',
  '第18课': '第18课',
  '第19课': '第19课',
  '第20课': '第20课',
  '第21课': '语文园地三',
  '第22课': '第22课',
  '第23课': '第23课',
  '第24课': '第24课',
  '第25课': '第25课',
  '第26课': '第26课',
  '第27课': '语文园地四',
};

interface WordEntry {
  text: string;
  type: 'word' | 'char';
  round: number;
  nextReview: string | null;
  wrongCount: number;
  history: unknown[];
}

// 解析原始文本
const raw = readFileSync(SOURCE_FILE, 'utf-8');
const blocks = raw.split(/\n(?=第\d+课|语文园地)/);

// 保留现有进度
const existingData: Record<string, Map<string, { round: number; nextReview: string | null; wrongCount: number; history: unknown[] }>> = {};
const existingFiles = readdirSync(DATA_DIR).filter(f => f.startsWith('L') && f.endsWith('.json'));
for (const file of existingFiles) {
  const data = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf-8')) as { words: WordEntry[] };
  const lessonId = file.replace('.json', '');
  existingData[lessonId] = new Map();
  for (const w of data.words) {
    if (w.round > 0 || w.wrongCount > 0) {
      existingData[lessonId].set(w.text, { round: w.round, nextReview: w.nextReview, wrongCount: w.wrongCount, history: w.history });
    }
  }
}

const lessons: { id: string; name: string }[] = [];

for (const block of blocks) {
  const lines = block.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) continue;

  const lessonHeader = lines[0].trim();
  const lessonIdMatch = lessonHeader.match(/第(\d+)课/);
  const gardenMatch = lessonHeader.match(/语文园地([一二三四五六七八九十])/);

  if (!lessonIdMatch && !gardenMatch) continue;

  // 解析课名
  const chineseNumMap: Record<string, string> = { '一': '4', '二': '15', '三': '21', '四': '27' };
  let lessonNum: string;
  let lessonName: string;

  if (gardenMatch) {
    lessonNum = chineseNumMap[gardenMatch[1]];
    lessonName = lessonHeader;
  } else {
    lessonNum = String(Number(lessonIdMatch[1])).padStart(2, '0');
    lessonName = lessonNameMap[lessonHeader] || lessonHeader;
  }

  const lessonId = `L${lessonNum}`;
  lessons.push({ id: lessonId, name: lessonName });

  // 解析词语
  const wordLine = lines.find(l => l.startsWith('词语：'));
  const charLine = lines.find(l => l.startsWith('生字：'));

  const words: string[] = wordLine
    ? wordLine.replace('词语：', '').split(/[、,，\s]+/).filter(Boolean)
    : [];
  const chars: string[] = charLine
    ? charLine.replace('生字：', '').split(/[、,，\s]+/).filter(Boolean)
    : [];

  // 去重：字在词语中出现的就去掉
  const wordsSet = new Set(words);
  const filteredChars = chars.filter(c => !words.some(w => w.includes(c)));

  // 构建 words 数组
  const wordEntries: WordEntry[] = [
    ...words.map(text => {
      const existing = existingData[lessonId]?.get(text);
      return {
        text, type: 'word' as const, round: existing?.round ?? 0,
        nextReview: existing?.nextReview ?? null,
        wrongCount: existing?.wrongCount ?? 0,
        history: existing?.history ?? [],
      };
    }),
    ...filteredChars.map(text => {
      const existing = existingData[lessonId]?.get(text);
      return {
        text, type: 'char' as const, round: existing?.round ?? 0,
        nextReview: existing?.nextReview ?? null,
        wrongCount: existing?.wrongCount ?? 0,
        history: existing?.history ?? [],
      };
    }),
  ];

  writeFileSync(
    join(DATA_DIR, `${lessonId}.json`),
    JSON.stringify({ lessonId, lessonName, words: wordEntries }, null, 2) + '\n',
    'utf-8'
  );
  console.log(`${lessonId} (${lessonName}): ${words.length} 词 + ${filteredChars.length} 字 = ${wordEntries.length} 条`);
}

// 更新 lessons.json
writeFileSync(
  join(DATA_DIR, 'lessons.json'),
  JSON.stringify({ lessons }, null, 2) + '\n',
  'utf-8'
);
console.log(`\nlessons.json 已更新: ${lessons.length} 课`);
