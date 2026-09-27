const encoder = new TextEncoder();

function equalHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(a) || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

export async function verifyTelegram(
  data: unknown,
  botToken: string,
  now = Date.now(),
  maxAge = 86_400_000,
): Promise<{ id: string; username?: string } | null> {
  if (!botToken || !data || typeof data !== 'object' || Array.isArray(data)) return null;
  const fields = data as Record<string, unknown>;
  if (typeof fields.hash !== 'string' || !/^\d+$/.test(String(fields.id))) return null;

  const authDate = Number(fields.auth_date);
  const age = now - authDate * 1000;
  if (!Number.isSafeInteger(authDate) || age < -300_000 || age > maxAge) return null;

  const pairs: string[] = [];
  for (const [name, value] of Object.entries(fields)) {
    if (name === 'hash') continue;
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    pairs.push(`${name}=${value}`);
  }
  pairs.sort();

  // Telegram использует SHA-256 токена как ключ HMAC.
  const secret = await crypto.subtle.digest('SHA-256', encoder.encode(botToken));
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(pairs.join('\n')));
  const expected = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (!equalHex(expected, fields.hash)) return null;

  return {
    id: String(fields.id),
    ...(typeof fields.username === 'string' ? { username: fields.username } : {}),
  };
}
