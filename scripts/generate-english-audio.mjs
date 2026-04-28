#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const englishDir = path.join(projectRoot, 'data', 'english');
const outputDir = path.join(projectRoot, 'data', 'audio', 'english');
const tempDir = path.join(projectRoot, '.tmp', 'english-audio');

const voice = process.argv[2] || 'Samantha';
const rate = process.argv[3] || '165';

function audioFilename(word) {
  return encodeURIComponent(word).replace(/%/g, '_') + '.mp3';
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

async function collectWords() {
  const unitsMeta = JSON.parse(await fs.readFile(path.join(englishDir, 'units.json'), 'utf8'));
  const words = new Set();

  for (const unit of unitsMeta.units) {
    const unitData = JSON.parse(await fs.readFile(path.join(englishDir, `${unit.id}.json`), 'utf8'));
    for (const word of unitData.words) {
      if (word.text) words.add(word.text);
    }
  }

  return [...words].sort((a, b) => a.localeCompare(b));
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });

  const words = await collectWords();
  const generated = [];

  for (const word of words) {
    const filename = audioFilename(word);
    const outputPath = path.join(outputDir, filename);
    const tempPath = path.join(tempDir, filename.replace(/\.mp3$/, '.aiff'));

    try {
      await fs.access(outputPath);
      generated.push(filename);
      continue;
    } catch {
      // file missing, generate below
    }

    await run('say', ['-v', voice, '-r', rate, '-o', tempPath, word]);
    await run('ffmpeg', ['-y', '-i', tempPath, '-codec:a', 'libmp3lame', '-q:a', '4', outputPath]);
    await fs.rm(tempPath, { force: true });
    generated.push(filename);
  }

  const manifest = {
    voice,
    rate: Number(rate),
    generatedAt: new Date().toISOString(),
    files: generated
  };

  await fs.writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Generated ${generated.length} English audio files in ${outputDir}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
