import assert from 'node:assert/strict';
import test from 'node:test';
import { createUserData, memoryStorage } from './index.ts';

test('restore с оформлением сохраняет отметки обоих видов по отдельности', () => {
  const storage = memoryStorage();
  const future = Date.now() + 60_000;
  storage.setItem('gf:sync', JSON.stringify({ user: 'u', data: { at: future, synced: 11 }, custom: { at: 5, synced: 22 } }));
  const data = createUserData({ storage });
  assert.equal(data.restore({ favorites: { ru: [] }, roster: [], profileUid: null, profileCustom: { v: 1 } }), true);
  const marker = JSON.parse(storage.getItem('gf:sync')!);
  assert.equal(marker.user, 'u');
  assert.equal(marker.data.synced, 11);
  assert.equal(marker.custom.synced, 22);
  assert.ok(marker.data.at > future, 'отметка data не уменьшается');
  assert.ok(marker.custom.at > 22);
});
