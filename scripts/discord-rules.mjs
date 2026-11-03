// Правила сервера на английском и испанском: npm run discord:rules -- [--dry] [--lang=en|es]
// Отправляет в каналы rules (🌐 ENGLISH) и reglas (🌐 ESPAÑOL) одно сообщение из блоков, как в #правила.
try { process.loadEnvFile('.env'); } catch {}

const color = 0xE3B04B;
const terms = 'https://discord.com/terms';
const guidelines = 'https://discord.com/guidelines';

const rules = {
  en: {
    category: '🌐 ENGLISH',
    channel: 'rules',
    blocks: [
      ['📜 GenshinFlex Server Rules', `Welcome, Traveler! This is the place to talk about Genshin Impact and show off your accounts, builds and event rewards.\n\nBy joining the server, you agree to the rules below as well as the [Discord Terms of Service](${terms}) and [Discord Community Guidelines](${guidelines}).`],
      ['🤝 1. Communication', [
        '**1.1** Respect other members. Insults, harassment, provocation and toxicity are not allowed.',
        '**1.2** No discrimination based on nationality, gender, orientation, religion or any other trait.',
        '**1.3** Don\'t stir up arguments about politics or religion.',
        '**1.4** Argue with the point, not the person. "This main is weak" is fine, "you\'re dumb for building them" is not.',
        '**1.5** Don\'t impersonate the admins, moderators or other members.',
      ]],
      ['💬 2. Messages and channels', [
        '**2.1** Stay on topic. Each channel\'s purpose is in its description.',
        '**2.2** No flooding, spam, caps lock, or chains of emoji and stickers.',
        '**2.3** Hide spoilers for new story content and leaks with `||spoiler||` for 2 weeks after an update is released.',
        '**2.4** Leaks are discussed only in the dedicated channel, if there is one.',
        '**2.5** No 18+ content, shock content or graphic violence. Character art must be safe for everyone.',
        '**2.6** Don\'t ping @everyone, roles or the admins without a reason.',
      ]],
      ['🛡️ 3. Account safety', [
        '**3.1** Never share your HoYoverse login, password or codes with anyone. The admins will never ask for them.',
        '**3.2** Selling, buying and trading accounts, as well as boosting services, are not allowed.',
        '**3.3** Promoting cheats, third-party mods, farming bots or ways to bypass HoYoverse rules is not allowed.',
        '**3.4** Suspicious links, "free primogems" and phishing lead to an immediate ban.',
        '**3.5** When sharing your UID or an account screenshot, hide your personal data.',
      ]],
      ['📣 4. Advertising', [
        '**4.1** Advertising servers, channels, websites and services without the admins\' approval is not allowed, including in members\' DMs.',
        '**4.2** Post your own Genshin content (guides, art, videos) only in the dedicated channel.',
        '**4.3** Referrals, promo codes that benefit you, and fundraising are not allowed.',
      ]],
      ['🎙️ 5. Voice channels', [
        '**5.1** Don\'t interrupt, shout, or play loud sounds or a soundboard without everyone\'s consent.',
        '**5.2** Recording conversations without the consent of all participants is not allowed.',
        '**5.3** All communication rules apply in voice channels too.',
      ]],
      ['👤 6. Profile', [
        '**6.1** Your nickname, avatar, status and banner must not be offensive, obscene or promotional.',
        '**6.2** Your nickname must be readable and mentionable. Moderators may change it.',
      ]],
      ['⚖️ 7. Punishments', [
        'The punishment depends on how serious the violation is:',
        '**Warning → Mute (1 hour to 7 days) → Kick → Ban**',
        '',
        'Phishing, selling accounts, 18+ content and raids lead to an immediate ban.',
        'Moderators may also punish behavior that isn\'t covered by the rules but disrupts the server.',
        'If you disagree with a punishment, calmly message the admins in DMs. Disputes in public channels are not accepted.',
      ]],
      ['✨ Have fun!', 'The rules may change. We\'ll announce any changes in this channel.\nNot knowing the rules doesn\'t exempt you from them.\n\n🌐 [genshinflex.com](https://genshinflex.com/en/)', 'GenshinFlex • Server administration'],
    ],
  },
  es: {
    category: '🌐 ESPAÑOL',
    channel: 'reglas',
    blocks: [
      ['📜 Reglas del servidor GenshinFlex', `¡Bienvenido, viajero! Aquí hablamos de Genshin Impact y mostramos nuestras cuentas, builds y recompensas de eventos.\n\nAl unirte al servidor, aceptas las reglas de abajo, los [Términos del servicio de Discord](${terms}) y las [Directrices de la comunidad de Discord](${guidelines}).`],
      ['🤝 1. Comunicación', [
        '**1.1** Respeta a los demás miembros. Están prohibidos los insultos, el acoso, las provocaciones y la toxicidad.',
        '**1.2** No se permite discriminar por nacionalidad, género, orientación, religión ni por ningún otro motivo.',
        '**1.3** No provoques discusiones sobre política o religión.',
        '**1.4** Debate con argumentos, no contra la persona. «Este main es débil» está bien; «eres tonto por subirlo» no.',
        '**1.5** No te hagas pasar por la administración, los moderadores u otros miembros.',
      ]],
      ['💬 2. Mensajes y canales', [
        '**2.1** Escribe sobre el tema del canal. Su propósito está en la descripción.',
        '**2.2** Están prohibidos el flood, el spam, las mayúsculas y las cadenas de emojis y stickers.',
        '**2.3** Oculta los spoilers de la nueva historia y de las filtraciones con `||spoiler||` durante 2 semanas tras el lanzamiento de la actualización.',
        '**2.4** Las filtraciones se comentan solo en el canal dedicado, si existe.',
        '**2.5** Está prohibido el contenido +18, el contenido impactante y las escenas de violencia. El arte de personajes debe ser apto para todos.',
        '**2.6** No menciones a @everyone, a roles ni a la administración sin motivo.',
      ]],
      ['🛡️ 3. Seguridad de las cuentas', [
        '**3.1** Nunca compartas con nadie el usuario, la contraseña ni los códigos de tu cuenta de HoYoverse. La administración nunca te los pedirá.',
        '**3.2** Está prohibido vender, comprar e intercambiar cuentas, así como los servicios de subida de nivel.',
        '**3.3** Está prohibido promocionar trampas, mods de terceros, bots de farmeo y formas de saltarse las reglas de HoYoverse.',
        '**3.4** Los enlaces sospechosos, las «protogemas gratis» y el phishing conllevan un baneo inmediato.',
        '**3.5** Si compartes tu UID o una captura de tu cuenta, oculta tus datos personales.',
      ]],
      ['📣 4. Publicidad', [
        '**4.1** Está prohibido anunciar servidores, canales, sitios web y servicios sin la aprobación de la administración, también por mensaje privado a los miembros.',
        '**4.2** Publica tu propio contenido de Genshin (guías, arte, vídeos) solo en el canal dedicado.',
        '**4.3** Están prohibidos los referidos, los códigos promocionales en beneficio propio y las recaudaciones de dinero.',
      ]],
      ['🎙️ 5. Canales de voz', [
        '**5.1** No interrumpas, no grites y no pongas sonidos fuertes ni soundboard sin el consentimiento de los demás.',
        '**5.2** Está prohibido grabar conversaciones sin el consentimiento de todos los participantes.',
        '**5.3** En los canales de voz se aplican todas las reglas de comunicación.',
      ]],
      ['👤 6. Perfil', [
        '**6.1** Tu apodo, avatar, estado y banner no deben ser ofensivos, obscenos ni publicitarios.',
        '**6.2** Tu apodo debe poder leerse y mencionarse. Los moderadores pueden cambiarlo.',
      ]],
      ['⚖️ 7. Sanciones', [
        'La sanción depende de la gravedad de la infracción:',
        '**Advertencia → Silencio (de 1 hora a 7 días) → Expulsión → Baneo**',
        '',
        'El phishing, la venta de cuentas, el contenido +18 y las raids conllevan un baneo inmediato.',
        'Los moderadores también pueden sancionar conductas que no estén en las reglas pero perjudiquen al servidor.',
        'Si no estás de acuerdo con una sanción, escribe con calma a la administración por mensaje privado. No se aceptan disputas en los canales públicos.',
      ]],
      ['✨ ¡Que disfrutes!', 'Las reglas pueden cambiar. Anunciaremos los cambios en este canal.\nDesconocer las reglas no te exime de cumplirlas.\n\n🌐 [genshinflex.com](https://genshinflex.com/es/)', 'GenshinFlex • Administración del servidor'],
    ],
  },
};

const message = ({ blocks }) => ({
  embeds: blocks.map(([title, body, footer]) => ({
    title,
    description: Array.isArray(body) ? body.join('\n') : body,
    color,
    ...(footer ? { footer: { text: footer } } : {}),
  })),
  allowed_mentions: { parse: [] },
});

const only = process.argv.find((arg) => arg.startsWith('--lang='))?.slice(7);
const langs = Object.keys(rules).filter((lang) => !only || lang === only);
if (!langs.length) {
  console.error('Discord: --lang может быть en или es');
  process.exit(1);
}

for (const lang of langs) {
  const body = message(rules[lang]);
  const size = body.embeds.reduce((sum, item) => sum + item.title.length + item.description.length + (item.footer?.text.length ?? 0), 0);
  if (size > 6000 || body.embeds.some((item) => item.description.length > 4096)) throw new Error(`Discord (${lang}): правила превышают лимиты Discord (${size})`);
}

if (process.argv.includes('--dry')) {
  for (const lang of langs) console.log(JSON.stringify(message(rules[lang]), null, 2));
} else {
  const guildId = process.env.DISCORD_GUILD_ID;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!guildId || !token) {
    console.error('Discord: задайте DISCORD_GUILD_ID и DISCORD_BOT_TOKEN');
    process.exit(1);
  }
  const headers = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };
  const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers });
  if (!response.ok) throw new Error(`Discord: HTTP ${response.status} ${await response.text()}`);
  const channels = await response.json();
  for (const lang of langs) {
    const { category, channel } = rules[lang];
    const parent = channels.find((item) => item.type === 4 && item.name === category);
    const target = parent && channels.find((item) => item.parent_id === parent.id && item.name === channel);
    if (!target) {
      console.error(`Discord (${lang}): не найден канал ${category} / ${channel}`);
      process.exitCode = 1;
      continue;
    }
    const sent = await fetch(`https://discord.com/api/v10/channels/${target.id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(message(rules[lang])),
    });
    if (!sent.ok) {
      console.error(`Discord (${lang}): HTTP ${sent.status} ${await sent.text()}`);
      process.exitCode = 1;
      continue;
    }
    console.log(`Discord (${lang}): правила отправлены в #${channel}`);
  }
}
