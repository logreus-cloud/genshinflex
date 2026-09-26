import assert from 'node:assert/strict';
import { test } from 'node:test';
import app from '../src/index.ts';
import type { Env } from '../src/lib/env.ts';

const env = {
  SITE_ORIGINS: 'https://genshinflex.com,http://localhost:4321',
} as Env;

test('чужой origin не получает CORS-заголовок', async () => {
  const response = await app.request('/health', {
    headers: { Origin: 'https://other.example' },
  }, env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
});

test('разрешённый origin получает CORS-заголовок', async () => {
  const response = await app.request('/health', {
    headers: { Origin: 'https://genshinflex.com' },
  }, env);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://genshinflex.com');
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), 'true');
});
