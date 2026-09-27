import type { Env } from './env.ts';

type DispatchEnv = Pick<Env, 'GITHUB_REPO' | 'GITHUB_DISPATCH_TOKEN' | 'DEPLOY_REF' | 'DEPLOY_BRANCH'>;
type Document = { type?: string; id?: string };

export async function dispatchSanityPublish(
  env: DispatchEnv,
  document: Document,
  fetcher: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'genshinflex-api',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event_type: 'sanity-publish',
        client_payload: {
          ref: env.DEPLOY_REF,
          branch: env.DEPLOY_BRANCH,
          ...document,
        },
      }),
      signal: controller.signal,
    });
    if (response.status !== 204) throw new Error();
  } catch {
    // Причина ответа GitHub не должна попадать в ответ Worker.
    throw new Error('Не удалось запустить сборку');
  } finally {
    clearTimeout(timer);
  }
}
