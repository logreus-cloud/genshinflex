export const commands = [{
  name: 'гайд',
  description: 'Гайд по персонажу: оружие, артефакты, статы, команды',
  type: 1,
  options: [{
    type: 3,
    name: 'персонаж',
    description: 'Имя персонажа',
    required: true,
    autocomplete: true,
    max_length: 100,
  }],
}, {
  name: 'профиль',
  description: 'Публичный профиль GenshinFlex',
  type: 1,
  options: [{
    type: 3,
    name: 'ник',
    description: 'Ник на сайте; без него — ваш профиль',
    required: false,
    max_length: 24,
  }],
}, {
  name: 'баннеры',
  description: 'Текущие баннеры и время до конца',
  type: 1,
}, {
  name: 'гарант',
  description: 'Счётчики гаранта по вашей истории молитв',
  type: 1,
}];

try { process.loadEnvFile('.env'); } catch {}

if (process.argv.includes('--dry')) {
  console.log(JSON.stringify(commands, null, 2));
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
    } catch (error) {
      console.error(`Discord: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
