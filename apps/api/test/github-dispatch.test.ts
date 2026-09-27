import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dispatchSanityPublish } from '../src/lib/github-dispatch.ts';

const env = {
  GITHUB_REPO: 'logreus-cloud/genshinflex',
  GITHUB_DISPATCH_TOKEN: 'local-test-token',
  DEPLOY_REF: 'platform',
  DEPLOY_BRANCH: 'platform',
};

test('передаёт публикацию в repository_dispatch', async () => {
  let called = false;
  const fetcher: typeof fetch = async (input, init) => {
    called = true;
    assert.equal(input, 'https://api.github.com/repos/logreus-cloud/genshinflex/dispatches');
    assert.equal(init?.method, 'POST');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer local-test-token');
    assert.equal(headers.get('Accept'), 'application/vnd.github+json');
    assert.equal(headers.get('X-GitHub-Api-Version'), '2022-11-28');
    assert.equal(headers.get('User-Agent'), 'genshinflex-api');
    assert.equal(headers.get('Content-Type'), 'application/json');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      event_type: 'sanity-publish',
      client_payload: {
        ref: 'platform',
        branch: 'platform',
        type: 'news',
        id: 'news-1',
      },
    });
    return new Response(null, { status: 204 });
  };

  await dispatchSanityPublish(env, { type: 'news', id: 'news-1' }, fetcher);
  assert.equal(called, true);
});

test('отклоняет ответ GitHub с кодом, отличным от 204', async () => {
  const fetcher: typeof fetch = async () => new Response('private response', { status: 200 });
  await assert.rejects(
    dispatchSanityPublish(env, {}, fetcher),
    { message: 'Не удалось запустить сборку' },
  );
});

test('прерывает запрос по таймауту', async () => {
  let aborted = false;
  const fetcher: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    signal?.addEventListener('abort', () => {
      aborted = true;
      reject(new Error('request aborted'));
    }, { once: true });
  });

  await assert.rejects(
    dispatchSanityPublish(env, {}, fetcher, 1),
    { message: 'Не удалось запустить сборку' },
  );
  assert.equal(aborted, true);
});
