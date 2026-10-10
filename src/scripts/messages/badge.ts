import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { onPage, cleanup } from '../router';
import { hasSession, onSessionChange } from '../user-data/session';
import { t } from '../search';
import { dmUnreadCount } from './api';

let count = 0;
let userId: string | null = null;
let channel: RealtimeChannel | null = null;
let client: SupabaseClient<any> | null = null;
const listeners = new Set<() => void>();
let sessionRequest = 0;
let countRequest = 0;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

const notifyListeners = () => { for (const listener of listeners) listener(); };

export async function refreshDmCount() {
  const owner = userId;
  if (!owner) return;
  const request = ++countRequest;
  try {
    const next = await dmUnreadCount();
    if (request !== countRequest || userId !== owner) return;
    count = next;
    notifyListeners();
  } catch {}
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined;
    void refreshDmCount();
  }, 300);
}

function setUser(next: string | null) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = undefined;
  countRequest++;
  const previous = channel;
  const supabase = client;
  channel = null;
  client = null;
  if (previous && supabase) void supabase.removeChannel(previous);
  userId = next;
  count = 0;
  notifyListeners();
}

async function ensureSubscription() {
  const request = ++sessionRequest;
  if (!hasSession()) { if (userId || channel) setUser(null); return; }
  try {
    const { getSupabase } = await import('../auth');
    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    if (request !== sessionRequest) return;
    const next = data.session?.user.id ?? null;
    if (next === userId && channel) { void refreshDmCount(); return; }
    if (next !== userId || channel) setUser(next);
    if (!next) return;
    client = supabase;
    const nextChannel = supabase.channel('dm-badge:' + next)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages' }, () => scheduleRefresh())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dm_messages' }, () => scheduleRefresh());
    channel = nextChannel;
    nextChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED' && channel === nextChannel) void refreshDmCount();
    });
    void refreshDmCount();
  } catch {}
}

void ensureSubscription();
onSessionChange(() => { void ensureSubscription(); });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refreshDmCount();
});
document.addEventListener('gf:dm-read', () => { void refreshDmCount(); });

onPage((signal) => {
  const link = document.getElementById('dm-link') as HTMLAnchorElement | null;
  const badge = document.getElementById('dm-badge');
  if (!link || !badge) return;
  const renderState = () => {
    link.hidden = !userId;
    badge.hidden = count === 0;
    badge.textContent = count > 99 ? '99+' : String(count);
    link.setAttribute('aria-label', `${t('Сообщения')}${count ? ` (${count})` : ''}`);
  };
  listeners.add(renderState);
  cleanup(signal, () => { listeners.delete(renderState); });
  renderState();
});
