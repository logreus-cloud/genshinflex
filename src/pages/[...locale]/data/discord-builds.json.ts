import { LANGS } from '../../../lib/data';
import { discordBuilds } from '../../../lib/discord-data';

export const getStaticPaths = () => LANGS.filter((lang) => lang !== 'ru')
  .map((lang) => ({ params: { locale: lang } }));

export const GET = ({ params }: { params: { locale: string } }) => discordBuilds(params.locale);
