import assert from 'node:assert/strict';
import test from 'node:test';
import { collectProfileMedia } from '../src/lib/profile-media-gc.ts';

test('collectProfileMedia removes files in batches of 100 and acknowledges each batch', async () => {
  const files = Array.from({ length: 105 }, (_, index) => `owner/avatar-${index}`);
  const removed: string[][] = [];
  const done: string[][] = [];
  const client = {
    rpc: async (name: string, args: { p_limit?: number; p_names?: string[] }) => {
      if (name === 'profile_media_gc_collect') {
        assert.deepEqual(args, { p_limit: 200 });
        return { data: files, error: null };
      }
      assert.equal(name, 'profile_media_gc_done');
      done.push(args.p_names ?? []);
      return { data: null, error: null };
    },
    storage: { from: (bucket: string) => {
      assert.equal(bucket, 'profile-media');
      return { remove: async (batch: string[]) => { removed.push(batch); return { error: null }; } };
    } },
  } as unknown as Parameters<typeof collectProfileMedia>[0];
  assert.deepEqual(await collectProfileMedia(client), { removed: 105 });
  assert.deepEqual(removed.map((batch) => batch.length), [100, 5]);
  assert.deepEqual(done, removed);
  assert.deepEqual(removed.flat(), files);
});

test('collectProfileMedia leaves a failed batch marked', async () => {
  const files = Array.from({ length: 101 }, (_, index) => `owner/cover-${index}`);
  const done: string[][] = [];
  const client = {
    rpc: async (name: string, args: { p_names?: string[] }) => {
      if (name === 'profile_media_gc_collect') return { data: files, error: null };
      done.push(args.p_names ?? []);
      return { data: null, error: null };
    },
    storage: { from: () => ({
      remove: async (batch: string[]) => ({ error: batch[0] === files[100] ? new Error('remove failed') : null }),
    }) },
  } as unknown as Parameters<typeof collectProfileMedia>[0];
  await assert.rejects(collectProfileMedia(client), /remove failed/);
  assert.deepEqual(done, [files.slice(0, 100)]);
});

test('collectProfileMedia throws on RPC errors', async () => {
  const failed = {
    rpc: async () => ({ data: null, error: new Error('collect failed') }),
  } as unknown as Parameters<typeof collectProfileMedia>[0];
  await assert.rejects(collectProfileMedia(failed), /collect failed/);
  const doneFailed = {
    rpc: async (name: string) => name === 'profile_media_gc_collect'
      ? { data: ['owner/background-v1'], error: null }
      : { data: null, error: new Error('done failed') },
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  } as unknown as Parameters<typeof collectProfileMedia>[0];
  await assert.rejects(collectProfileMedia(doneFailed), /done failed/);
});
