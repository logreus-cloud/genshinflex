try { process.loadEnvFile('.env'); } catch {}

const body = {
  embeds: [{
    title: 'Техподдержка GenshinFlex',
    description: 'Проблема с сайтом, аккаунтом или ботом? Нажмите кнопку — откроется форма, а бот создаст приватную ветку, которую видите только вы и поддержка. Идеи и найденные баги лучше оставлять в форумах #предложения и #баги.',
    color: 0xD3BC8E,
  }],
  components: [{
    type: 1,
    components: [{ type: 2, style: 1, label: 'Создать тикет', custom_id: 'ticket:open' }],
  }],
};

if (process.argv.includes('--dry')) {
  console.log(JSON.stringify(body, null, 2));
} else {
  const channel = process.argv.find((arg) => arg.startsWith('--channel='))?.slice('--channel='.length)
    || process.env.DISCORD_SUPPORT_CHANNEL_ID;
  const token = process.env.DISCORD_BOT_TOKEN;
  const missing = [
    !token && 'DISCORD_BOT_TOKEN',
    !channel && 'DISCORD_SUPPORT_CHANNEL_ID',
  ].filter(Boolean);
  if (missing.length) {
    console.error(`Discord: задайте ${missing.join(', ')}`);
    process.exitCode = 1;
  } else {
    try {
      const response = await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const message = await response.json();
      console.log(`Discord: панель опубликована — ${message.id}`);
    } catch (error) {
      console.error(`Discord: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
