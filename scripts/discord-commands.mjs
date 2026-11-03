const localized = (en, es) => ({ 'en-US': en, 'en-GB': en, 'es-ES': es, 'es-419': es });

export const commands = [{
  name: 'гайд',
  name_localizations: localized('guide', 'guia'),
  description: 'Гайд по персонажу: оружие, артефакты, статы, команды',
  description_localizations: localized('Character guide: weapons, artifacts, stats, and teams', 'Guía de personaje: armas, artefactos, estadísticas y equipos'),
  type: 1,
  options: [{
    type: 3,
    name: 'персонаж',
    name_localizations: localized('character', 'personaje'),
    description: 'Имя персонажа',
    description_localizations: localized('Character name', 'Nombre del personaje'),
    required: true,
    autocomplete: true,
    max_length: 100,
  }],
}, {
  name: 'профиль',
  name_localizations: localized('profile', 'perfil'),
  description: 'Публичный профиль GenshinFlex',
  description_localizations: localized('Public GenshinFlex profile', 'Perfil público de GenshinFlex'),
  type: 1,
  options: [{
    type: 3,
    name: 'ник',
    name_localizations: localized('nickname', 'apodo'),
    description: 'Ник на сайте; без него — ваш профиль',
    description_localizations: localized('Site nickname; omit to view your profile', 'Apodo en el sitio; omítelo para ver tu perfil'),
    required: false,
    max_length: 24,
  }],
}, {
  name: 'баннеры',
  name_localizations: localized('banners', 'banners'),
  description: 'Текущие баннеры и время до конца',
  description_localizations: localized('Current banners and time remaining', 'Banners actuales y tiempo restante'),
  type: 1,
}, {
  name: 'гарант',
  name_localizations: localized('pity', 'garantia'),
  description: 'Счётчики гаранта по вашей истории молитв',
  description_localizations: localized('Pity counters from your Wish history', 'Contadores de garantía de tu historial de Gachapones'),
  type: 1,
}, {
  name: 'тикет',
  name_localizations: localized('ticket', 'ticket'),
  description: 'Создать тикет в техподдержку',
  description_localizations: localized('Create a support ticket', 'Crear un ticket de soporte'),
  type: 1,
}];

// Метаданные Linked Roles (apps/api/src/lib/discord-roles.ts): type 7 — «равно да/нет», type 2 — «не меньше»
export const roleMetadata = [{
  key: 'linked',
  name: 'Аккаунт GenshinFlex',
  name_localizations: localized('GenshinFlex account', 'Cuenta de GenshinFlex'),
  description: 'Discord привязан к аккаунту на genshinflex.com',
  description_localizations: localized('Discord is linked to an account on genshinflex.com', 'Discord está vinculado a una cuenta de genshinflex.com'),
  type: 7,
}, {
  key: 'rating',
  name: 'Рейтинг сообщества',
  name_localizations: localized('Community rating', 'Puntuación de la comunidad'),
  description: 'Очков рейтинга форума GenshinFlex не меньше',
  description_localizations: localized('Minimum GenshinFlex forum rating points', 'Puntuación mínima en el foro de GenshinFlex'),
  type: 2,
}, {
  key: 'guild',
  name: 'Участник гильдии',
  name_localizations: localized('Guild member', 'Miembro de un gremio'),
  description: 'Состоит в гильдии GenshinFlex',
  description_localizations: localized('Member of a GenshinFlex guild', 'Pertenece a un gremio de GenshinFlex'),
  type: 7,
}];

try { process.loadEnvFile('.env'); } catch {}

if (process.argv.includes('--dry')) {
  console.log(JSON.stringify({ commands, roleMetadata }, null, 2));
} else {
  const applicationId = process.env.DISCORD_APPLICATION_ID;
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_BOT_TOKEN;
  const missing = [
    !applicationId && 'DISCORD_APPLICATION_ID',
    !guildId && 'DISCORD_GUILD_ID',
    !token && 'DISCORD_BOT_TOKEN',
  ].filter(Boolean);

  if (missing.length) {
    console.error(`Discord: задайте ${missing.join(', ')}`);
    process.exitCode = 1;
  } else {
    try {
      const response = await fetch(`https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`, {
        method: 'PUT',
        headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(commands),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(result));
      console.log(`Discord: зарегистрированы ${result.map((command) => command.name).join(', ')}`);
      const metadata = await fetch(`https://discord.com/api/v10/applications/${applicationId}/role-connections/metadata`, {
        method: 'PUT',
        headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(roleMetadata),
      });
      const fields = await metadata.json();
      if (!metadata.ok) throw new Error(JSON.stringify(fields));
      console.log(`Discord: метаданные Linked Roles — ${fields.map((field) => field.key).join(', ')}`);
    } catch (error) {
      console.error(`Discord: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
