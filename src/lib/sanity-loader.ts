import { createClient } from '@sanity/client';
import { bodyHash, fromSanityData } from './cms-mapping';
import { portableTextToMarkdown } from './portable-text-md';

type Collection = 'builds' | 'buildsI18n' | 'rotations' | 'banners' | 'news' | 'weaponGuides' | 'endgameGuides';
type Document = Record<string, unknown> & {
  _id: string;
  _type: string;
  lang?: string;
  character?: string;
  slug?: string | { current?: string };
  body?: Parameters<typeof portableTextToMarkdown>[0];
  bodyMarkdown?: string;
  bodyHash?: string;
};

const types: Record<Collection, string> = {
  builds: 'build',
  buildsI18n: 'build',
  rotations: 'rotation',
  banners: 'banner',
  news: 'news',
  weaponGuides: 'weaponGuide',
  endgameGuides: 'endgameGuide',
};

const client = createClient({
  projectId: '6qrew4ya',
  dataset: 'production',
  apiVersion: '2025-02-19',
  useCdn: false,
  perspective: 'published',
  token: process.env.SANITY_READ_TOKEN || undefined,
});

function entryId(collection: Collection, document: Document): string {
  const slug = typeof document.slug === 'string' ? document.slug : document.slug?.current;
  const part = collection === 'builds' || collection === 'buildsI18n' ? document.character : slug;
  const parts = collection === 'builds' || collection === 'rotations' || collection === 'banners'
    ? [part]
    : [document.lang, part];
  if (parts.some((value) => typeof value !== 'string' || !value.trim() || value.includes('/'))) {
    throw new Error(`Sanity: неверный id в коллекции ${collection}, документ ${document._id}`);
  }
  return parts.join('/');
}

export function sanityLoader(collection: Collection) {
  const type = types[collection];
  return {
    name: `sanity-${collection}`,
    async load({ store, parseData, generateDigest, renderMarkdown, logger }: {
      store: { clear(): void; set(entry: Record<string, unknown>): void };
      parseData(input: { id: string; data: Record<string, unknown> }): Promise<Record<string, unknown>>;
      generateDigest(data: unknown): string;
      renderMarkdown(body: string): Promise<unknown>;
      logger: { info(message: string): void };
    }) {
      let documents: Document[];
      try {
        documents = await client.fetch<Document[]>(
          '*[_type == $type && !(_id in path("drafts.**"))]',
          { type },
        );
      } catch (error) {
        throw new Error(`Sanity: не удалось загрузить ${collection}: ${String(error)}`);
      }
      const selected = documents.filter((document) =>
        collection === 'builds' ? document.lang === 'ru'
          : collection === 'buildsI18n' ? document.lang === 'en' || document.lang === 'es'
            : true);
      if (!selected.length) throw new Error(`Sanity: коллекция ${collection} пуста`);
      store.clear();
      const ids = new Set<string>();
      for (const document of selected) {
        const id = entryId(collection, document);
        if (ids.has(id)) {
          throw new Error(`Sanity: повторяющийся id ${id} в коллекции ${collection}, документ ${document._id}`);
        }
        ids.add(id);
        const data = collection === 'buildsI18n'
          ? {}
          : fromSanityData(type, document as Record<string, never>);
        const parsed = await parseData({ id, data });
        const converted = document.body === undefined ? undefined : portableTextToMarkdown(document.body);
        // Исходный текст нужен редактору гайдов до первого изменения блока в Studio.
        const body = document.body !== undefined
          && document.bodyHash === bodyHash(document.body)
          && document.bodyMarkdown !== undefined
          ? document.bodyMarkdown
          : converted;
        const rendered = body === undefined ? undefined : await renderMarkdown(body);
        store.set({ id, data: parsed, body, rendered, digest: generateDigest({ parsed, body }) });
      }
      logger.info(`Sanity: ${collection} — ${selected.length}`);
    },
  };
}
