import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from 'hono';
import { requireAdmin } from '../src/index.ts';
import { deleteTitle, setActiveTitle, validateTitle } from '../src/lib/titles.ts';
import type { TitleClient } from '../src/lib/titles.ts';
import type { Env } from '../src/lib/env.ts';

const id = '11111111-1111-4111-8111-111111111111';

test('validates title ids, colors and names', () => {
  const title = { id: 'event-snezhnaya', name_ru: 'Награда', color: '#e3b04b' };
  assert.equal(validateTitle(title).id, title.id);
  assert.throws(() => validateTitle({ ...title, id: 'Bad ID' }));
  assert.throws(() => validateTitle({ ...title, color: 'red' }));
  assert.throws(() => validateTitle({ ...title, name_ru: '' }));
  assert.throws(() => validateTitle({ ...title, name_en: 'x'.repeat(33) }));
  assert.throws(() => validateTitle({ ...title, name_es: 'x'.repeat(33) }));
});

test('does not delete the admin title', async () => {
  const client = {
    from: () => { throw new Error('Database must not be called'); },
  } as unknown as TitleClient;
  await assert.rejects(deleteTitle(client, 'admin'), {
    message: 'Титул администратора нельзя удалить',
    status: 400,
  });
});

test('requireAdmin returns 403 without the admin role', async () => {
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    }),
  } as unknown as TitleClient;
  const context = {
    req: { header: () => 'Bearer test-token' },
    env: {},
    json: (body: unknown, status: number) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  } as unknown as Context<{ Bindings: Env }>;
  const result = await requireAdmin(context, client, async () => id);
  assert.ok(result instanceof Response);
  assert.equal(result.status, 403);
  assert.deepEqual(await result.json(), { error: 'Нужны права администратора' });
});

test('cannot activate a title the user does not own', async () => {
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    }),
  } as unknown as TitleClient;
  await assert.rejects(setActiveTitle(client, id, { title: 'designer' }), {
    message: 'У вас нет этого титула',
    status: 400,
  });
});
