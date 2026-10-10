import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearUserData, createUserData, memoryStorage, readStrict, userDataKey, writePulled } from './index';

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

test('clear removes all user data and notifies subscribers', () => {
  const storage = memoryStorage();
  const changed: string[] = [];
  const data = createUserData({ storage, onChanged: (kind) => changed.push(kind) });
  const favorite = { href: '/a', name: 'A', kind: 'character' };
  for (const lang of ['ru', 'en', 'es'] as const) storage.setItem(userDataKey('favorites', lang), JSON.stringify([favorite]));
  storage.setItem(userDataKey('roster'), JSON.stringify([{ s: 'amber' }]));
  storage.setItem(userDataKey('profileUid'), JSON.stringify('123456789'));
  storage.setItem(userDataKey('profileCustom'), JSON.stringify({ theme: 'dark' }));
  const marker = JSON.stringify({ user: 'a', custom: { at: 1, synced: 1 }, data: { at: 1, synced: 1 } });
  storage.setItem('gf:sync', marker);
  const seen: [string, unknown][] = [];
  data.subscribe('favorites', (value, lang) => seen.push([lang, value]));
  data.subscribe('roster', (value) => seen.push(['roster', value]));
  data.subscribe('profileUid', (value) => seen.push(['profileUid', value]));
  data.subscribe('profileCustom', (value) => seen.push(['profileCustom', value]));
  clearUserData(storage);
  for (const lang of ['ru', 'en', 'es'] as const) assert.equal(storage.getItem(userDataKey('favorites', lang)), null);
  for (const key of ['roster', 'profileUid', 'profileCustom'] as const) assert.equal(storage.getItem(userDataKey(key)), null);
  assert.equal(storage.getItem('gf:sync'), marker);
  assert.deepEqual(seen, [['ru', []], ['en', []], ['es', []], ['roster', []], ['profileUid', null], ['profileCustom', {}]]);
  assert.deepEqual(changed, []);
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

test('set stops notifying an old value after a subscriber overwrites it', () => {
  const storage = memoryStorage();
  const data = createUserData({ storage });
  const seen: (string | null)[] = [];
  data.subscribe('profileUid', (value) => {
    if (value === '123456789') data.set('profileUid', '987654321');
  });
  data.subscribe('profileUid', (value) => seen.push(value));
  assert.equal(data.set('profileUid', '123456789'), true);
  assert.deepEqual(seen, ['987654321']);
  assert.equal(storage.getItem(userDataKey('profileUid')), JSON.stringify('987654321'));
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

test('throwing getter leaves favorites unchanged', () => {
  const storage = memoryStorage();
  const data = createUserData({ storage });
  assert.equal(data.set('favorites', [{ href: '/a', name: 'A', kind: 'character' }]), true);
  const before = storage.getItem(userDataKey('favorites'));
  assert.equal(data.set('favorites', [{ get href() { throw new Error('x'); }, name: 'n', kind: 'k' }]), false);
  assert.equal(storage.getItem(userDataKey('favorites')), before);
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

test('pulled writes skip notifications replaced by a subscriber', () => {
  const storage = memoryStorage();
  const data = createUserData({ storage });
  const seen: (string | null)[] = [];
  data.subscribe('roster', () => { data.set('profileUid', '987654321'); });
  data.subscribe('profileUid', (value) => seen.push(value));
  writePulled([['roster', [{ s: 'amber' }]], ['profileUid', '123456789']], storage);
  assert.deepEqual(seen, ['987654321']);
  assert.equal(storage.getItem(userDataKey('profileUid')), JSON.stringify('987654321'));
});

test('pulled writes stop notifying an old value after a subscriber overwrites it', () => {
  const storage = memoryStorage();
  const data = createUserData({ storage });
  const seen: (string | null)[] = [];
  data.subscribe('profileUid', (value) => {
    if (value === '123456789') data.set('profileUid', '987654321');
  });
  data.subscribe('profileUid', (value) => seen.push(value));
  writePulled([['profileUid', '123456789']], storage);
  assert.deepEqual(seen, ['987654321']);
  assert.equal(storage.getItem(userDataKey('profileUid')), JSON.stringify('987654321'));
});

test('snapshot keeps valid entries and reports damaged data', () => {
  const storage = memoryStorage();
  const data = createUserData({ storage });
  const favorite = { href: '/a', name: 'A', kind: 'character' };
  storage.setItem(userDataKey('favorites'), JSON.stringify([favorite, { ...favorite, href: 3 }]));
  storage.setItem(userDataKey('favorites', 'en'), '{');
  storage.setItem(userDataKey('favorites', 'es'), JSON.stringify([favorite]));
  storage.setItem(userDataKey('roster'), JSON.stringify([{ s: 'amber', level: 90 }, { s: 3 }]));
  storage.setItem(userDataKey('profileUid'), JSON.stringify('123'));
  assert.deepEqual(data.snapshot(), {
    favorites: { ru: [favorite], en: [], es: [favorite] },
    roster: [{ s: 'amber', level: 90 }],
    profileUid: null,
    damaged: true,
  });
});

test('restore writes data and custom with one marker and one callback per kind', () => {
  const backing = memoryStorage();
  let markerWrites = 0;
  const changed: string[] = [];
  const storage = {
    getItem: backing.getItem,
    setItem: (key: string, value: string) => {
      if (key === 'gf:sync') markerWrites++;
      backing.setItem(key, value);
    },
    removeItem: backing.removeItem,
  };
  const data = createUserData({ storage, onChanged: (kind) => changed.push(kind) });
  const seen: string[] = [];
  data.subscribe('favorites', (_, lang) => seen.push(lang));
  data.subscribe('roster', () => seen.push('roster'));
  data.subscribe('profileUid', () => seen.push('profileUid'));
  data.subscribe('profileCustom', () => seen.push('profileCustom'));
  const favorite = { href: '/a', name: 'A', kind: 'character' };
  assert.equal(data.restore({
    favorites: { ru: [favorite], en: [favorite], es: [favorite] },
    roster: [{ s: 'amber' }],
    profileUid: '123456789',
    profileCustom: { theme: 'dark' },
  }), true);
  for (const lang of ['ru', 'en', 'es'] as const) {
    assert.deepEqual(data.get('favorites', lang), [favorite]);
  }
  assert.deepEqual(data.get('roster'), [{ s: 'amber' }]);
  assert.equal(data.get('profileUid'), '123456789');
  assert.deepEqual(data.get('profileCustom'), { theme: 'dark' });
  assert.equal(markerWrites, 1);
  assert.deepEqual(changed, ['data', 'custom']);
  assert.deepEqual(seen, ['ru', 'en', 'es', 'roster', 'profileUid', 'profileCustom']);
});

test('restore skips notifications replaced by a subscriber', () => {
  const storage = memoryStorage();
  const data = createUserData({ storage });
  const seen: (string | null)[] = [];
  data.subscribe('roster', () => { data.set('profileUid', '987654321'); });
  data.subscribe('profileUid', (value) => seen.push(value));
  assert.equal(data.restore({ favorites: {}, roster: [{ s: 'amber' }], profileUid: '123456789' }), true);
  assert.deepEqual(seen, ['987654321']);
  assert.equal(storage.getItem(userDataKey('profileUid')), JSON.stringify('987654321'));
});

test('restore rejects a throwing property getter without changing storage', () => {
  const storage = memoryStorage();
  const data = createUserData({ storage });
  assert.equal(data.set('profileUid', '123456789'), true);
  const uid = storage.getItem(userDataKey('profileUid'));
  const marker = storage.getItem('gf:sync');
  assert.equal(data.restore({ favorites: {}, get roster() { throw new Error('x'); }, profileUid: null }), false);
  assert.equal(storage.getItem(userDataKey('profileUid')), uid);
  assert.equal(storage.getItem(userDataKey('roster')), null);
  assert.equal(storage.getItem('gf:sync'), marker);
});

test('restore leaves languages absent from an older export untouched', () => {
  const storage = memoryStorage();
  const data = createUserData({ storage });
  const en = [{ href: '/en', name: 'EN', kind: 'character' }];
  const es = [{ href: '/es', name: 'ES', kind: 'character' }];
  storage.setItem(userDataKey('favorites', 'en'), JSON.stringify(en));
  storage.setItem(userDataKey('favorites', 'es'), JSON.stringify(es));
  assert.equal(data.restore({ favorites: { ru: [] }, roster: [], profileUid: null }), true);
  assert.deepEqual(data.get('favorites', 'en'), en);
  assert.deepEqual(data.get('favorites', 'es'), es);
});

test('failed restore rolls back every key without notifying', () => {
  const backing = memoryStorage();
  const keys = ['ru', 'en', 'es'].map((lang) => userDataKey('favorites', lang as 'ru' | 'en' | 'es')).concat(userDataKey('roster'), userDataKey('profileUid'));
  for (const key of keys) backing.setItem(key, key === userDataKey('profileUid') ? 'null' : '[]');
  backing.setItem('gf:sync', JSON.stringify({ data: { at: 1, synced: 0 } }));
  const before = keys.map((key) => backing.getItem(key));
  const storage = {
    getItem: backing.getItem,
    setItem: (key: string, value: string) => {
      if (key === userDataKey('roster')) throw new Error('write failed');
      backing.setItem(key, value);
    },
    removeItem: backing.removeItem,
  };
  const changed: string[] = [];
  const data = createUserData({ storage, onChanged: (kind) => changed.push(kind) });
  const seen: unknown[] = [];
  data.subscribe('favorites', (value) => seen.push(value));
  data.subscribe('roster', (value) => seen.push(value));
  const favorite = { href: '/a', name: 'A', kind: 'character' };
  assert.equal(data.restore({ favorites: { ru: [favorite], en: [favorite], es: [favorite] }, roster: [{ s: 'amber' }], profileUid: '123456789' }), false);
  for (const [index, key] of keys.entries()) assert.equal(backing.getItem(key), before[index]);
  assert.deepEqual(JSON.parse(backing.getItem('gf:sync')!), { data: { at: 1, synced: 0 } });
  assert.deepEqual(seen, []);
  assert.deepEqual(changed, []);
});

test('toolUid prefers its own valid UID, then the profile UID', () => {
  const data = createUserData({ storage: memoryStorage() });
  assert.equal(data.toolUid(null), '');
  assert.equal(data.set('profileUid', '123456789'), true);
  assert.equal(data.toolUid('9876543210'), '9876543210');
  assert.equal(data.toolUid('manual'), '123456789');
  assert.equal(data.toolUid(null), '123456789');
  assert.equal(data.set('profileUid', null), true);
  assert.equal(data.toolUid('invalid'), '');
});

test('restore rejects invalid profileCustom without changing data', () => {
  const storage = memoryStorage();
  const data = createUserData({ storage });
  const payload = { favorites: { ru: [] }, roster: [], profileUid: null };
  assert.equal(data.restore({ ...payload, profileCustom: [] as never }), false);
  assert.equal(data.restore({ ...payload, profileCustom: { toJSON: () => [] } }), false);
  assert.equal(storage.getItem(userDataKey('favorites')), null);
  assert.equal(storage.getItem('gf:sync'), null);
});

test('failed restore rolls back profileCustom without notifying', () => {
  const backing = memoryStorage();
  const keys = [userDataKey('favorites'), userDataKey('roster'), userDataKey('profileUid'), userDataKey('profileCustom')];
  backing.setItem(keys[0], '[]');
  backing.setItem(keys[1], '[]');
  backing.setItem(keys[2], 'null');
  backing.setItem(keys[3], '{"theme":"old"}');
  const before = keys.map((key) => backing.getItem(key));
  const storage = {
    getItem: backing.getItem,
    setItem: (key: string, value: string) => {
      if (key === 'gf:sync') throw new Error('marker failed');
      backing.setItem(key, value);
    },
    removeItem: backing.removeItem,
  };
  const changed: string[] = [];
  const data = createUserData({ storage, onChanged: (kind) => changed.push(kind) });
  const seen: unknown[] = [];
  data.subscribe('favorites', (value) => seen.push(value));
  data.subscribe('profileCustom', (value) => seen.push(value));
  assert.equal(data.restore({
    favorites: { ru: [{ href: '/a', name: 'A', kind: 'character' }] },
    roster: [{ s: 'amber' }], profileUid: '123456789', profileCustom: { theme: 'new' },
  }), false);
  for (const [index, key] of keys.entries()) assert.equal(backing.getItem(key), before[index]);
  assert.equal(backing.getItem('gf:sync'), null);
  assert.deepEqual(seen, []);
  assert.deepEqual(changed, []);
});

test('restore and pulled writes roll back in reverse order under a shared quota', () => {
  for (const operation of ['restore', 'writePulled'] as const) {
    const ru = userDataKey('favorites');
    const en = userDataKey('favorites', 'en');
    const es = userDataKey('favorites', 'es');
    const values = new Map<string, string>([
      [ru, JSON.stringify([{ href: '/old', name: 'A'.repeat(200), kind: 'character' }])],
      [en, '[]'],
      [es, '[]'],
    ]);
    const before = [...values];
    const quota = [...values.values()].reduce((sum, value) => sum + value.length, 0);
    let esWrites = 0;
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === es) { esWrites++; throw new Error('write failed'); }
        const size = [...values].reduce((sum, [path, raw]) => sum + (path === key ? 0 : raw.length), value.length);
        if (size > quota) throw new Error('quota exceeded');
        values.set(key, value);
      },
      removeItem: (key: string) => { values.delete(key); },
    };
    const favorite = { href: '/new', name: 'B'.repeat(100), kind: 'character' };
    if (operation === 'restore') {
      const data = createUserData({ storage });
      assert.equal(data.restore({
        favorites: { ru: [], en: [favorite], es: [] }, roster: [], profileUid: null,
      }), false);
    } else {
      assert.throws(() => writePulled([
        ['favorites', [], 'ru'], ['favorites', [favorite], 'en'], ['favorites', [], 'es'],
      ], storage));
    }
    assert.deepEqual([...values], before);
    assert.equal(esWrites, 1);
  }
});
