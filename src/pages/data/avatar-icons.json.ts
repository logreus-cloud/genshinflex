import { useData } from '../../lib/data';

export const prerender = true;

export function GET() {
  const { characters } = useData('ru');
  const icons = Object.fromEntries(characters.map(({ slug, icon }) => [slug, icon]));
  return new Response(JSON.stringify(icons), {
    headers: { 'Content-Type': 'application/json' },
  });
}
