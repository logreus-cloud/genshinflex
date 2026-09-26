import assert from 'node:assert/strict';
import { pick, buildMessage } from '../workers/discord-reminders/src/index.ts';

const HOUR = 3_600_000;
const hour = Date.UTC(2026, 8, 26);
const event = (id, type, offset) => ({
  id, type, title: id, at: new Date(hour + offset * HOUR).toISOString(),
  url: null, image: null, estimated: false,
});

const events = [
  event('day-start', 'banner-start', 24),
  event('day-last', 'abyss', 25 - 1 / 3600),
  event('outside', 'banner-end', 25),
  event('now-start', 'banner-start', 0),
  event('now-abyss', 'abyss', 0.5),
  event('now-event', 'event-end', 0),
  event('day-stream', 'livestream', 24),
  event('now-stream', 'livestream', 0),
];
const selected = pick(events, hour);
assert.deepEqual(selected.map(({ event: item, when }) => [item.id, when]), [
  ['day-start', 'day'],
  ['day-last', 'day'],
  ['now-start', 'now'],
  ['now-abyss', 'now'],
  ['day-stream', 'day'],
  ['now-stream', 'now'],
]);
assert.equal(buildMessage([]), null);

const body = buildMessage(Array.from({ length: 11 }, (_, index) => ({
  event: event(`event-${index}`, 'banner-start', 24),
  when: 'day', text: 'Новый баннер завтра',
})));
assert.equal(body.embeds.length, 10);
assert.deepEqual(body.allowed_mentions, { parse: [] });
assert.deepEqual(buildMessage(selected, '123').allowed_mentions, { roles: ['123'] });
console.log('Напоминания: тесты пройдены');
