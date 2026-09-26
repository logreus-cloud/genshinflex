const encoder = new TextEncoder();

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export async function verifySanityWebhook(
  body: string,
  header: string | null,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  if (!body || !header || !secret) return false;
  const match = /^t=(\d+)[, ]+v1=([A-Za-z0-9_-]+)$/.exec(header.trim());
  if (!match) return false;

  // Sanity подписывает время в миллисекундах и исходное тело запроса.
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > 300_000) return false;

  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${match[1]}.${body}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return equal(expected, match[2]);
}
