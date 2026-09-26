import assert from 'node:assert/strict';
import { feedbackMessages, guideMessages, sendAll } from '../functions/lib/discord.ts';

try {
  const feedback = { id: 42, kind: 'bug', page: '/characters/hu-tao/', message: '@everyone Ошибка', contact: 'secret-contact' };
  const guide = {
    id: 17, kind: 'char', target: 'hu-tao', mode: 'new', author: 'Автор',
    comment: 'Комментарий', contact: 'secret-contact', site: 'https://genshinflex.com',
  };
  assert.deepEqual(feedbackMessages({}, feedback), []);
  assert.deepEqual(guideMessages({}, guide), []);

  const env = {
    DISCORD_WEBHOOK_TEAM: 'https://example.com/team',
    DISCORD_WEBHOOK_BUGS: 'https://example.com/bugs',
    DISCORD_WEBHOOK_IDEAS: 'https://example.com/ideas',
    DISCORD_TAG_NEW: '1',
    DISCORD_TAG_BUG: '2',
    DISCORD_TAG_DATA: '3',
    DISCORD_TAG_IDEA: '4',
  };
  const bug = feedbackMessages(env, feedback);
  const data = feedbackMessages(env, { ...feedback, kind: 'data' });
  const idea = feedbackMessages(env, { ...feedback, kind: 'idea' });
  const other = feedbackMessages(env, { ...feedback, kind: 'other' });
  const guides = guideMessages(env, guide);
  assert.deepEqual(bug.map((item) => item.url), [env.DISCORD_WEBHOOK_TEAM, env.DISCORD_WEBHOOK_BUGS]);
  assert.deepEqual(data.map((item) => item.url), [env.DISCORD_WEBHOOK_TEAM, env.DISCORD_WEBHOOK_BUGS]);
  assert.deepEqual(idea.map((item) => item.url), [env.DISCORD_WEBHOOK_TEAM, env.DISCORD_WEBHOOK_IDEAS]);
  assert.deepEqual(other.map((item) => item.url), [env.DISCORD_WEBHOOK_TEAM]);
  assert.deepEqual(guides.map((item) => item.url), [env.DISCORD_WEBHOOK_TEAM]);
  assert.match(bug[1].body.thread_name, /^Баг: /);
  assert.match(data[1].body.thread_name, /^Ошибка в данных: /);
  assert.match(idea[1].body.thread_name, /^Идея: /);
  assert.deepEqual(bug[1].body.applied_tags, ['1', '2']);
  assert.deepEqual(data[1].body.applied_tags, ['1', '3']);
  assert.deepEqual(idea[1].body.applied_tags, ['4']);
  assert.ok(!JSON.stringify([...bug, ...data, ...idea, ...guides]).includes('secret-contact'));
  for (const item of [...bug, ...data, ...idea, ...other, ...guides]) {
    assert.deepEqual(item.body.allowed_mentions.parse, []);
  }
  assert.ok(!JSON.stringify(bug[1].body).includes('/admin/'));
  assert.ok(!JSON.stringify(bug[1].body).includes('#42'));
  assert.match(bug[0].body.embeds[0].fields[0].value, /^https:\/\/genshinflex\.com/);

  const long = feedbackMessages(env, { ...feedback, message: '@everyone ' + 'я'.repeat(5000) });
  for (const item of long) {
    assert.ok(Array.from(item.body.embeds[0].description).length <= 4096);
    assert.ok(item.body.embeds[0].description.endsWith('…'));
    assert.deepEqual(item.body.allowed_mentions.parse, []);
  }
  assert.ok(Array.from(long[1].body.thread_name).length <= 100);

  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  let calls = 0, errors = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) throw new Error('Сеть недоступна');
      return { ok: calls === 3, status: 500 };
    };
    console.error = () => { errors++; };
    await sendAll(bug.concat(guides));
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
  assert.equal(calls, 3);
  assert.equal(errors, 2);
  console.log('Discord: проверки пройдены');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
