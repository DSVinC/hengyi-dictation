import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const DASHSCOPE_URL = 'https://coding.dashscope.aliyuncs.com/v1/chat/completions';

function getDashscopeKey() {
  return execSync('security find-generic-password -s "openclaw/providers/bailian/apiKey" -w 2>/dev/null', {
    encoding: 'utf8',
  }).trim();
}

async function callLLM(prompt) {
  const apiKey = getDashscopeKey();
  const response = await fetch(DASHSCOPE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'qwen3.6-plus',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 4000,
    }),
  });
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
}

const wordList = [
  { word: 'where', unit: 'U1' }, { word: 'from', unit: 'U1' }, { word: 'about', unit: 'U1' },
  { word: 'today', unit: 'U1' }, { word: 'teacher', unit: 'U1' }, { word: 'student', unit: 'U1' },
  { word: 'after', unit: 'U1' }, { word: 'who', unit: 'U1' }, { word: 'girl', unit: 'U1' },
  { word: 'boy', unit: 'U1' }, { word: 'woman', unit: 'U1' }, { word: 'man', unit: 'U1' },
  { word: 'he', unit: 'U1' }, { word: 'also', unit: 'U1' }, { word: 'she', unit: 'U1' },
  { word: 'UK', unit: 'U1' }, { word: 'China', unit: 'U1' }, { word: 'Canada', unit: 'U1' },
  { word: 'USA', unit: 'U1' },
  { word: 'has', unit: 'U2' }, { word: 'long', unit: 'U2' }, { word: 'short', unit: 'U2' },
  { word: 'fat', unit: 'U2' }, { word: 'thin', unit: 'U2' }, { word: 'slow', unit: 'U2' },
  { word: 'love', unit: 'U2' }, { word: 'picture', unit: 'U2' }, { word: 'card', unit: 'U2' },
  { word: 'sing', unit: 'U2' }, { word: 'dance', unit: 'U2' }, { word: 'talk', unit: 'U2' },
  { word: 'face', unit: 'U2' }, { word: 'all', unit: 'U2' }, { word: 'song', unit: 'U2' },
  { word: 'or', unit: 'U2' }, { word: 'so', unit: 'U2' }, { word: 'much', unit: 'U2' },
  { word: 'find', unit: 'U3' }, { word: 'ruler', unit: 'U3' }, { word: 'pen', unit: 'U3' },
  { word: 'pencil', unit: 'U3' }, { word: 'book', unit: 'U3' }, { word: 'bag', unit: 'U3' },
  { word: 'paper', unit: 'U3' }, { word: 'these', unit: 'U3' }, { word: 'see', unit: 'U3' },
  { word: 'hear', unit: 'U3' }, { word: 'nose', unit: 'U3' }, { word: 'class', unit: 'U3' },
  { word: 'computer', unit: 'U3' }, { word: 'learn', unit: 'U3' },
  { word: 'breakfast', unit: 'U4' }, { word: 'time', unit: 'U4' }, { word: 'bread', unit: 'U4' },
  { word: 'egg', unit: 'U4' }, { word: 'milk', unit: 'U4' }, { word: 'noodle', unit: 'U4' },
  { word: 'juice', unit: 'U4' }, { word: 'rice', unit: 'U4' }, { word: 'meat', unit: 'U4' },
  { word: 'vegetable', unit: 'U4' }, { word: 'healthy', unit: 'U4' }, { word: 'soup', unit: 'U4' },
  { word: 'fruit', unit: 'U4' }, { word: 'candy', unit: 'U4' },
  { word: 'boat', unit: 'U5' }, { word: 'cool', unit: 'U5' }, { word: 'keep', unit: 'U5' },
  { word: 'at', unit: 'U5' }, { word: 'home', unit: 'U5' }, { word: 'ball', unit: 'U5' },
  { word: 'doll', unit: 'U5' }, { word: 'car', unit: 'U5' }, { word: 'on', unit: 'U5' },
  { word: 'in', unit: 'U5' }, { word: 'box', unit: 'U5' }, { word: 'cap', unit: 'U5' },
  { word: 'map', unit: 'U5' }, { word: 'under', unit: 'U5' }, { word: 'put', unit: 'U5' },
  { word: 'back', unit: 'U6' },
];

const wordsStr = wordList.map(w => w.word).join(', ');

const prompt = `你是人教版PEP 2024三年级下册英语教材的词汇专家。

请为以下 ${wordList.length} 个单词提供：
1. 国际音标（英式发音，只写音标本身，不要方括号）
2. 适合小学三年级学生的中文意思（1-4个字，简洁准确）

严格按以下 JSON 格式输出，不要其他任何内容：

[
  {"word": "where", "phonetic": "weə(r)", "meaning": "在哪里"},
  {"word": "from", "phonetic": "frɒm", "meaning": "来自"}
]

单词列表：
${wordsStr}

要求：
- phonetic 只写音标本身，不要方括号 []
- meaning 是三年级学生能理解的中文意思
- 必须输出完整 ${wordList.length} 个词，不要遗漏
- 只输出 JSON 数组，不要其他文字`;

async function main() {
  console.log(`调用 LLM 获取 ${wordList.length} 个单词的音标和中文意思...`);
  const result = await callLLM(prompt);

  // 提取 JSON
  let jsonStr = result;
  const jsonMatch = result.match(/\[[\s\S]*\]/);
  if (jsonMatch) jsonStr = jsonMatch[0];

  const wordData = JSON.parse(jsonStr);
  console.log(`获取到 ${wordData.length} 个单词的数据`);

  // 按 unit 分组
  const unitMap = {};
  wordData.forEach(item => {
    const entry = wordList.find(w => w.word.toLowerCase() === item.word.toLowerCase());
    const unit = entry ? entry.unit : 'unknown';
    if (!unitMap[unit]) unitMap[unit] = [];
    unitMap[unit].push(item);
  });

  // 更新每个 JSON 文件
  const dataDir = path.join(process.cwd(), 'data', 'english');
  for (const [unit, words] of Object.entries(unitMap)) {
    const filePath = path.join(dataDir, `${unit}.json`);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    let updated = 0;
    data.words.forEach(word => {
      const match = words.find(w => w.word.toLowerCase() === word.text.toLowerCase());
      if (match) {
        word.phonetic = match.phonetic;
        word.meaning = match.meaning;
        updated++;
      }
    });

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log(`${unit}: 更新了 ${updated}/${data.words.length} 个词`);
  }

  console.log('✅ 全部完成！');
}

main().catch(err => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
