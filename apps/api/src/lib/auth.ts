import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import type { Env } from './env.ts';

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function userIdFromToken(token: string, env: Env): Promise<string | null> {
  if (!env.SUPABASE_URL) return null;
  const issuer = `${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;

  try {
    const { alg } = decodeProtectedHeader(token);
    let key: Uint8Array | ReturnType<typeof createRemoteJWKSet>;

    if (alg === 'HS256' && env.SUPABASE_JWT_SECRET) {
      key = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
    } else if (alg === 'RS256' || alg === 'ES256') {
      let remote = jwks.get(issuer);
      if (!remote) {
        remote = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
        jwks.set(issuer, remote);
      }
      key = remote;
    } else {
      return null;
    }

    const { payload } = await jwtVerify(token, key, {
      issuer,
      audience: 'authenticated',
      algorithms: [alg],
    });
    return typeof payload.sub === 'string' && /^[0-9a-f-]{36}$/i.test(payload.sub)
      ? payload.sub : null;
  } catch {
    return null;
  }
}
