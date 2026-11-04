import assert from 'node:assert/strict';
import { localeRedirect } from '../functions/lib/locale.ts';

const redirect = (path = '/', { language = 'en-US', cookie, dest = 'document', site = 'none', agent = 'Mozilla/5.0', method = 'GET' } = {}) => {
  const headers = { 'Accept-Language': language, 'Sec-Fetch-Site': site, 'User-Agent': agent };
  if (language === null) delete headers['Accept-Language'];
  if (dest) headers['Sec-Fetch-Dest'] = dest;
  if (cookie) headers.Cookie = cookie;
  return localeRedirect(new Request(`https://genshinflex.com${path}`, { method, headers }));
};

try {
  assert.equal(redirect(), '/en/');
  assert.equal(redirect('/', { language: 'de,en;q=0.9' }), '/en/');
  assert.equal(redirect('/', { language: 'es-419' }), '/es/');
  assert.equal(redirect('/', { language: 'en-US,en;q=0.9,ru;q=0.8' }), null);
  assert.equal(redirect('/', { language: 'ru' }), null);
  assert.equal(redirect('/', { language: 'de' }), '/en/');
  assert.equal(redirect('/', { language: 'ja' }), '/en/');
  assert.equal(redirect('/', { language: 'fr-CA,de;q=0.5' }), '/en/');
  assert.equal(redirect('/', { language: 'pt-BR' }), '/en/');
  assert.equal(redirect('/', { language: 'uk' }), null);
  assert.equal(redirect('/', { language: 'kk,de;q=0.5' }), null);
  assert.equal(redirect('/', { language: 'uk,en;q=0.9' }), '/en/');
  assert.equal(redirect('/', { language: null }), null);
assert.equal(redirect('/', { language: '' }), null);
assert.equal(redirect('/', { language: '*,' }), null);
  assert.equal(redirect('/', { language: '*' }), null);
  assert.equal(redirect('/', { language: 'en;q=0' }), null);
  assert.equal(redirect('/', { cookie: 'gf_lang=ru' }), null);
  assert.equal(redirect('/', { language: 'ru', cookie: 'gf_lang=es' }), '/es/');
  assert.equal(redirect('/', { cookie: 'gf_lang=other' }), '/en/');
  assert.equal(redirect('/en/x'), null);
  assert.equal(redirect('/api/x'), null);
  assert.equal(redirect('/data/x.json'), null);
  assert.equal(redirect('/sitemap.xml'), null);
  assert.equal(redirect('/english/'), '/en/english/');
  assert.equal(redirect('/builds/?x=1'), '/en/builds/?x=1');
  assert.equal(redirect('/', { dest: null }), null);
  assert.equal(redirect('/', { site: 'same-origin' }), null);
  assert.equal(redirect('/', { agent: 'Googlebot' }), null);
  assert.equal(redirect('/', { method: 'POST' }), null);
  assert.equal(redirect('/', { method: 'HEAD' }), '/en/');
  console.log('Locale: проверки пройдены');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
