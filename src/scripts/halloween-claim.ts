import { BASE } from './search';
import { pageLang, translate } from '../i18n/client';
import { hasSession, onSessionChange } from './user-data/session';

const START = Date.parse('2026-10-30T19:00:00Z');
const END = Date.parse('2026-11-01T06:00:00Z');
let inProgress = false, queued = false;

function showNotice() {
  const t = translate(pageLang());
  if (!document.getElementById('gf-halloween-claim-style')) {
    const style = document.createElement('style');
    style.id = 'gf-halloween-claim-style';
    style.textContent = `
      .gf-halloween-claim { position: fixed; right: 16px; bottom: 16px; z-index: 100; box-sizing: border-box; width: min(380px, calc(100vw - 32px)); padding: 16px 38px 16px 16px; border: 1px solid #fb034f; border-radius: 12px; background: #2a0010; color: #fff; box-shadow: 0 12px 32px rgb(0 0 0 / .4); font: 400 .9rem/1.45 var(--font); }
      .gf-halloween-claim p { margin: 0 0 8px; }
      .gf-halloween-claim a { color: #ffad8e; font-weight: 600; }
      .gf-halloween-claim a:hover { color: #fff; }
      .gf-halloween-claim button { position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; border: 0; background: transparent; color: #fff; cursor: pointer; font: 1.4rem/1 var(--font); }
      .gf-halloween-claim button:hover { color: #ffad8e; }
      @media (max-width: 600px) { .gf-halloween-claim { right: 16px; left: 16px; width: auto; } }
    `;
    document.head.append(style);
  }
  document.getElementById('gf-halloween-claim')?.remove();
  const notice = document.createElement('div');
  notice.id = 'gf-halloween-claim';
  notice.className = 'gf-halloween-claim';
  notice.setAttribute('role', 'status');
  const message = document.createElement('p');
  message.textContent = t('Награда за Хэллоуин: рамка «Тыквенный фонарь», свечение «Ночь Хэллоуина» и титул «Хэллоуин 2026». Выбрать их можно в профиле.');
  const link = document.createElement('a');
  link.href = `${BASE}/profile/`;
  link.textContent = t('Открыть профиль');
  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', t('Закрыть'));
  close.textContent = '×';
  close.addEventListener('click', () => notice.remove());
  notice.append(message, link, close);
  document.body.append(notice);
  window.setTimeout(() => notice.remove(), 15000);
}

async function claim() {
  if (inProgress) { queued = true; return; }
  if (!hasSession() || Date.now() < START || Date.now() >= END) return;
  inProgress = true;
  try {
    const { getSupabase } = await import('./auth');
    const client = getSupabase();
    const { data } = await client.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId || Date.now() >= END) return;
    const key = `gf:halloween-2026:${userId}`;
    try { if (localStorage.getItem(key)) return; } catch {}
    const { data: granted, error } = await client.rpc('claim_halloween_2026');
    if (error) return;
    try { localStorage.setItem(key, '1'); } catch {}
    if (typeof granted === 'number' && granted > 0) {
      // Открытый профиль перечитывает рамки, свечения и титулы
      document.dispatchEvent(new Event('gf:rewards-changed'));
      showNotice();
    }
  } catch {}
  finally {
    inProgress = false;
    if (queued) { queued = false; void claim(); }
  }
}

document.addEventListener('astro:page-load', () => { void claim(); });
onSessionChange(() => { void claim(); });
void claim();
