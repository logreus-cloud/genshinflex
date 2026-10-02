import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUserData, memoryStorage, readStrict, userDataKey, writePulled } from './index';

test('defaults and damaged stored values', () => {
  const storage = memoryStorage();
  const data = createUserData({ storage });
  assert.deepEqual(data.get('favorites'), []);
  assert.deepEqual(data.get('roster'), []);
  assert.equal(data.get('profileUid'), null);
  assert.deepEqual(data.get('profileCustom'), {});

  storage.setItem(userDataKey('favorites'), '{');
  storage.setItem(userDataKey('roster'), JSON.stringify([{ s: 1 }]));
  storage.setItem(userDataKey('profileUid'), JSON.stringify('123'));
  storage.setItem(userDataKey('profileCustom'), JSON.stringify([]));
  assert.deepEqual(data.get('favorites'), []);
  assert.deepEqual(data.get('roster'), []);
  assert.equal(data.get('profileUid'), null);
  assert.deepEqual(data.get('profileCustom'), {});
});

test('invalid writes leave storage unchanged', () => {
  const storage = memoryStorage();
  const data = createUserData({ storage });
  const favorite = { href: '/a', name: 'A', kind: 'character' };
  assert.equal(data.set('favorites', [favorite]), true);
  const before = storage.getItem(userDataKey('favorites'));
  assert.equal(data.set('favorites', [{ ...favorite, icon: 3 }] as never), false);
  assert.equal(storage.getItem(userDataKey('favorites')), before);
  assert.equal(data.set('roster', [{ s: 3 }] as never), false);
  assert.equal(data.set('profileUid', '123'), false);
  assert.equal(data.set('profileCustom', [] as never), false);
  assert.equal(storage.getItem(userDataKey('roster')), null);
  assert.equal(storage.getItem(userDataKey('profileUid')), null);
  assert.equal(storage.getItem(userDataKey('profileCustom')), null);
});

test('roster entries retain every field', () => {
  const storage = memoryStorage();
  const data = createUserData({ storage });
  const roster = [{ s: 'amber', level: 90, stats: { cr: 75 }, extra: ['saved'] }];
  assert.equal(data.set('roster', roster), true);
  assert.deepEqual(data.get('roster'), roster);
  assert.deepEqual(JSON.parse(storage.getItem(userDataKey('roster'))!), roster);
});

test('favorites use separate keys for each language', () => {
  const storage = memoryStorage();
  const data = createUserData({ storage });
  const favorite = (name: string) => ({ href: `/${name}`, name, kind: 'character' });
  for (const lang of ['ru', 'en', 'es'] as const) {
    assert.equal(data.set('favorites', [favorite(lang)], lang), true);
  }
  const keys = (['ru', 'en', 'es'] as const).map((lang) => userDataKey('favorites', lang));
  assert.equal(new Set(keys).size, 3);
  for (const lang of ['ru', 'en', 'es'] as const) {
    assert.deepEqual(data.get('favorites', lang), [favorite(lang)]);
    assert.deepEqual(JSON.parse(storage.getItem(userDataKey('favorites', lang))!), [favorite(lang)]);
  }
});

test('set marks the matching kind and calls onChanged', () => {
  const storage = memoryStorage();
  const changed: string[] = [];
  const data = createUserData({ storage, onChanged: (kind) => changed.push(kind) });
  assert.equal(data.set('roster', [{ s: 'amber' }]), true);
  const first = JSON.parse(storage.getItem('gf:sync')!);
  assert.ok(first.data.at > 0);
  assert.equal(first.custom.at, 0);
  assert.equal(data.set('profileCustom', { v: 1 }), true);
  const second = JSON.parse(storage.getItem('gf:sync')!);
  assert.equal(second.data.at, first.data.at);
  assert.ok(second.custom.at > 0);
  assert.deepEqual(changed, ['data', 'custom']);
});

test('subscribe receives values until unsubscribed', () => {
  const data = createUserData({ storage: memoryStorage() });
  const values: unknown[] = [];
  const unsubscribe = data.subscribe('profileUid', (value) => values.push(value));
  assert.equal(data.set('profileUid', '123456789'), true);
  unsubscribe();
  assert.equal(data.set('profileUid', null), true);
  assert.deepEqual(values, ['123456789']);
});

test('strict reads reject damaged data and storage failures', () => {
  const storage = memoryStorage();
  assert.deepEqual(readStrict('favorites', 'ru', storage), []);
  storage.setItem(userDataKey('favorites'), '{');
  assert.throws(() => readStrict('favorites', 'ru', storage));
  storage.setItem(userDataKey('favorites'), JSON.stringify([{ href: 3, name: 'A', kind: 'character' }]));
  assert.throws(() => readStrict('favorites', 'ru', storage));
  assert.throws(() => readStrict('favorites', 'ru', { ...storage, getItem: () => { throw new Error('blocked'); } }));
});

test('set validates the serialized value before writing', () => {
  const storage = memoryStorage();
  const data = createUserData({ storage });
  const favorite = { href: '/a', name: 'A', kind: 'character' };
  assert.equal(data.set('favorites', [favorite]), true);
  const before = storage.getItem(userDataKey('favorites'));
  assert.equal(data.set('favorites', [favorite, ,] as never), false);
  assert.equal(data.set('roster', [{ s: 'amber', toJSON: () => ({ s: 3 }) }] as never), false);
  assert.equal(storage.getItem(userDataKey('favorites')), before);
  assert.equal(storage.getItem(userDataKey('roster')), null);
});

test('failed marker write restores data without notifying', () => {
  const backing = memoryStorage();
  let changed = 0;
  const storage = {
    getItem: backing.getItem,
    setItem: (key: string, value: string) => {
      if (key === 'gf:sync') throw new Error('marker failed');
      backing.setItem(key, value);
    },
    removeItem: backing.removeItem,
  };
  const data = createUserData({ storage, onChanged: () => { changed++; } });
  const seen: unknown[] = [];
  data.subscribe('roster', (value) => seen.push(value));
  backing.setItem(userDataKey('roster'), JSON.stringify([{ s: 'amber' }]));
  assert.equal(data.set('roster', [{ s: 'kaeya' }]), false);
  assert.deepEqual(data.get('roster'), [{ s: 'amber' }]);
  assert.equal(data.set('profileUid', '123456789'), false);
  assert.equal(backing.getItem(userDataKey('profileUid')), null);
  assert.deepEqual(seen, []);
  assert.equal(changed, 0);
});

test('pulled writes notify only after the whole batch succeeds', () => {
  const backing = memoryStorage();
  let fail = false;
  const storage = {
    getItem: backing.getItem,
    setItem: (key: string, value: string) => {
      if (fail && key === userDataKey('profileUid')) throw new Error('write failed');
      backing.setItem(key, value);
    },
    removeItem: backing.removeItem,
  };
  let changed = 0;
  const data = createUserData({ storage, onChanged: () => { changed++; } });
  const seen: unknown[] = [];
  data.subscribe('roster', (value) => seen.push(value));
  data.subscribe('profileUid', (value) => seen.push(value));
  writePulled([['roster', [{ s: 'amber' }]], ['profileUid', '123456789']], storage);
  assert.deepEqual(seen, [[{ s: 'amber' }], '123456789']);
  assert.equal(backing.getItem('gf:sync'), null);
  writePulled([['roster', [{ s: 'amber' }]], ['profileUid', '123456789']], storage);
  assert.deepEqual(seen, [[{ s: 'amber' }], '123456789']);
  fail = true;
  assert.throws(() => writePulled([['roster', [{ s: 'kaeya' }]], ['profileUid', null]], storage));
  assert.deepEqual(data.get('roster'), [{ s: 'amber' }]);
  assert.equal(data.get('profileUid'), '123456789');
  assert.deepEqual(seen, [[{ s: 'amber' }], '123456789']);
  assert.equal(changed, 0);
});
