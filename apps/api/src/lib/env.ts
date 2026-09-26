export interface Env {
  SITE_ORIGINS: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_JWT_SECRET?: string;
  TELEGRAM_BOT_TOKEN: string;
  SANITY_PROJECT_ID: string;
  SANITY_DATASET: string;
  SANITY_WRITE_TOKEN: string;
  SANITY_WEBHOOK_SECRET: string;
  CF_DEPLOY_HOOK_URL: string;
  DISCORD_WEBHOOK_TEAM?: string;
  DISCORD_WEBHOOK_BUGS?: string;
  DISCORD_WEBHOOK_IDEAS?: string;
  DISCORD_TAG_BUG?: string;
  DISCORD_TAG_DATA?: string;
  DISCORD_TAG_IDEA?: string;
  DISCORD_TAG_NEW?: string;
}
