import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@sanity/client';
import { collections } from '@genshinflex/content-model';
import { contentHash } from '../../src/lib/cms-mapping.ts';

if (existsSync(join(process.cwd(), '.env'))) process.loadEnvFile(join(process.cwd(), '.env'));
const dry = process.argv.includes('--dry');
const token = dry
  ? process.env.SANITY_READ_TOKEN || process.env.SANITY_WRITE_TOKEN
  : process.env.SANITY_WRITE_TOKEN;
if (!token) throw new Error(dry
  ? 'Для чтения Sanity нужен SANITY_READ_TOKEN или SANITY_WRITE_TOKEN в .env'
  : 'Для записи нужен токен Editor в .env как SANITY_WRITE_TOKEN');

const client = createClient({
  projectId: '6qrew4ya', dataset: 'production', apiVersion: '2025-02-19',
  useCdn: false, perspective: 'published', token,
});
const types = [...new Set(Object.values(collections).map((collection) => collection.type))];
const documents = await client.fetch('*[_type in $types && !(_id in path("drafts.**"))]', { types });
let stamped = 0;
let existing = 0;

for (const document of documents) {
  if (document.syncHash) { existing++; continue; }
  if (dry) {
    console.log(`проставил бы syncHash: ${document._id}`);
  } else {
    await client.patch(document._id).ifRevisionId(document._rev)
      .set({ syncHash: contentHash(document) }).commit();
    console.log(`проставлен syncHash: ${document._id}`);
  }
  stamped++;
}
console.log(`${dry ? 'Проставилось бы' : 'Проставлено'}: ${stamped}; уже было: ${existing}`);
