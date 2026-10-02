import { defineCliConfig } from 'sanity/cli';

export default defineCliConfig({
  api: {
    projectId: process.env.SANITY_STUDIO_PROJECT_ID || '6qrew4ya', // projectId публичный, не секрет
    dataset: process.env.SANITY_STUDIO_DATASET || 'production',
  },
  // genshinflex.sanity.studio — деплой без вопроса о хосте
  studioHost: 'genshinflex',
  deployment: { appId: 'qrycjbdaf38z7n0yn9d4brxx' },
});
