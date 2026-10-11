const MANIFEST = 'https://github.com/logreus-cloud/genshinflex/releases/latest/download/latest.json';
const DOWNLOAD = /^https:\/\/github\.com\/logreus-cloud\/genshinflex\/releases\/download\/[^/?#]+\/[^/?#]+\.exe$/;

const unavailable = () => new Response(null, {
  status: 302, headers: { Location: '/app/?download=unavailable', 'Cache-Control': 'no-store' },
});

export async function onRequestGet() {
  try {
    const upstream = await fetch(MANIFEST, { redirect: 'follow' });
    if (!upstream.ok) return unavailable();
    const { platforms } = await upstream.json() as { platforms?: Record<string, { url?: string }> };
    const asset = platforms?.['windows-x86_64']?.url
      ?? Object.entries(platforms ?? {}).find(([key, value]) => key.startsWith('windows-x86_64') && value?.url)?.[1].url;
    // Адрес с «..» или «\» после разбора меняется — такой не принимаем
    if (typeof asset !== 'string' || !DOWNLOAD.test(asset) || new URL(asset).href !== asset) return unavailable();
    return new Response(null, {
      status: 302, headers: { Location: asset, 'Cache-Control': 'public, max-age=600' },
    });
  } catch {
    return unavailable();
  }
}
