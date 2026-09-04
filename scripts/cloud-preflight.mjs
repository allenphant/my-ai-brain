import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const EXPECTED_PROJECT = 'my-ai-brain-6867e';
const errors = [];
const warnings = [];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

if (!existsSync('.firebaserc')) {
  errors.push('找不到 .firebaserc');
} else {
  const firebaseRc = readJson('.firebaserc');
  if (firebaseRc.projects?.default !== EXPECTED_PROJECT) {
    errors.push(`.firebaserc default 不是 ${EXPECTED_PROJECT}`);
  }
}

if (!existsSync('firebase.json')) errors.push('找不到 firebase.json');
if (!existsSync('functions/src/index.js')) errors.push('找不到 Functions entry point');
if (!existsSync('docs/CLOUD_COST_BUDGET.md')) errors.push('找不到成本預算文件');

try {
  const activeProject = execFileSync(
    'gcloud',
    ['config', 'get-value', 'project'],
    {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']},
  ).trim();
  if (activeProject && activeProject !== EXPECTED_PROJECT) {
    warnings.push(
      `目前 gcloud 預設是 ${activeProject}；本專案腳本會強制使用 ${EXPECTED_PROJECT}。`,
    );
  }
} catch {
  warnings.push('無法讀取 gcloud 預設專案；部署時仍會明確指定 project。');
}

const trackedSecretPatterns = [
  ['Gemini server key', /GEMINI_API_KEY\s*[:=]\s*["'][^"']+/],
  ['Jina server key', /JINA_API_KEY\s*[:=]\s*["'][^"']+/],
  ['OpenRouter server key', /OPENROUTER_API_KEY\s*[:=]\s*["'][^"']+/],
  ['Mistral server key', /MISTRAL_API_KEY\s*[:=]\s*["'][^"']+/],
];
const filesToScan = [
  'firebase.json',
  '.firebaserc',
  'functions/src/index.js',
  'functions/src/providers.js',
];
for (const file of filesToScan) {
  if (!existsSync(file)) continue;
  const content = readFileSync(file, 'utf8');
  for (const [label, pattern] of trackedSecretPatterns) {
    if (pattern.test(content)) errors.push(`${file} 疑似含有 ${label}`);
  }
}

console.log(`Cloud project: ${EXPECTED_PROJECT}`);
console.log('Billing mutation: none (preflight is read-only)');
warnings.forEach((warning) => console.warn(`WARN: ${warning}`));
errors.forEach((error) => console.error(`ERROR: ${error}`));

if (errors.length > 0) process.exit(1);
console.log('Preflight passed. 尚未啟用 API，也尚未部署任何計費資源。');
