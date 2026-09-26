import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Dataset приватный: SANITY_READ_TOKEN (только чтение) берём из .env в корне — файл в .gitignore
if (existsSync('.env')) process.loadEnvFile('.env');

if (!process.env.npm_execpath) throw new Error('Запускайте сборку через npm run build:sanity');
const result = spawnSync(
  process.execPath,
  [process.env.npm_execpath, 'run', 'build'],
  { stdio: 'inherit', env: { ...process.env, CONTENT_SOURCE: 'sanity' } },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
