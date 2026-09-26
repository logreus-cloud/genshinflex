import { documentInternationalization } from '@sanity/document-internationalization';
import { ruKZLocale } from '@sanity/locale-ru-kz';
import { visionTool } from '@sanity/vision';
import { defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { schemaTypes } from './schemas';
import { structure } from './structure';

export default defineConfig({
  name: 'genshinflex',
  title: 'GenshinFlex',
  projectId: process.env.SANITY_STUDIO_PROJECT_ID!,
  dataset: process.env.SANITY_STUDIO_DATASET || 'production',
  plugins: [
    structureTool({ structure }),
    visionTool(),
    ruKZLocale(),
    documentInternationalization({
      supportedLanguages: [
        { id: 'ru', title: 'Русский' },
        { id: 'en', title: 'English' },
        { id: 'es', title: 'Español' },
      ],
      schemaTypes: ['news', 'build', 'weaponGuide', 'endgameGuide'],
      languageField: 'lang',
    }),
  ],
  schema: { types: schemaTypes },
});
