import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifySanityWebhook } from '../src/lib/sanity-webhook.ts';

const now = 1_790_000_000_000;
const body = '{"_type":"news","title":"Тест"}';
const secret = 'local-test-secret';

async function header(timestamp: number) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  const value = btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `t=${timestamp},v1=${value}`;
}

test('принимает подпись исходного тела Sanity', async () => {
  assert.equal(await verifySanityWebhook(body, await header(now), secret, now), true);
});

test('отклоняет изменённое тело', async () => {
  assert.equal(await verifySanityWebhook(`${body} `, await header(now), secret, now), false);
});

test('отклоняет старый timestamp', async () => {
  const old = now - 300_001;
  assert.equal(await verifySanityWebhook(body, await header(old), secret, now), false);
});
