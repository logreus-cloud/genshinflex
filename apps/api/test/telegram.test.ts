import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyTelegram } from '../src/lib/telegram.ts';

const now = 1_790_000_000_000;
const botToken = '123456:local-test';

async function signed(authDate: number) {
  const data = { id: '12345', username: 'traveler', auth_date: authDate };
  const secret = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(botToken));
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const text = Object.entries(data).map(([name, value]) => `${name}=${value}`).sort().join('\n');
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  const hash = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { ...data, hash };
}

test('принимает действительную подпись Telegram', async () => {
  const data = await signed(now / 1000);
  assert.deepEqual(await verifyTelegram(data, botToken, now), { id: '12345', username: 'traveler' });
});

test('отклоняет подделанные данные', async () => {
  const data = await signed(now / 1000);
  assert.equal(await verifyTelegram({ ...data, username: 'attacker' }, botToken, now), null);
});

test('отклоняет старую подпись', async () => {
  const data = await signed(now / 1000 - 86_401);
  assert.equal(await verifyTelegram(data, botToken, now), null);
});
