try { process.loadEnvFile('.env'); } catch {}

const guildId = process.env.DISCORD_GUILD_ID;
const token = process.env.DISCORD_BOT_TOKEN;
const apply = process.argv.includes('--apply');
const view = 1n << 10n;
const botAllow = view | (1n << 11n) | (1n << 14n) | (1n << 15n) | (1n << 29n) | (1n << 38n);
const voiceBotAllow = view | (1n << 20n) | (1n << 21n);
const ruCategories = ['1553336058434035712', '1553336873814990869', '1553337472233111592', '1553341181193363497', '1553339341600723034'];
const supportRoles = ['1558811008833818745', '1553339761228390400', '1553339581959766097'];
const botRole = '1558800863357702244';
// Общие для всех языков каналы: не прячутся от EN/ES, имена на английском, в карту языков бота не входят
const sharedChannels = new Map([
  ['1558836427431874570', 'linked-roles'],
  ['1553336622987350036', 'site-news'],
  ['1553336646844289196', 'announcements'],
]);
// Отдельные новостные каналы веток больше не нужны: новости идут в общий site-news на трёх языках
const obsolete = { en: { name: 'site-news', type: 5 }, es: { name: 'noticias-del-sitio', type: 5 } };
const mirrors = [
  { ru: 'правила', en: 'rules', es: 'reglas' },
  { ru: 'общий', en: 'general', es: 'general' },
  { ru: 'крутки', en: 'pulls', es: 'tiradas' },
  { ru: 'билды', en: 'builds', es: 'builds' },
  { ru: 'помощь-с-командой', en: 'team-help', es: 'ayuda-con-equipos' },
  { ru: 'предложения', en: 'feedback', es: 'sugerencias' },
  { ru: 'Общий', en: 'General', es: 'General', type: 2 },
  { ru: 'Коопчик', en: 'Co-op', es: 'Cooperativo', type: 2 },
  { ru: 'Стрим', en: 'Stage', es: 'Escenario', type: 13 },
];
const branches = [{ lang: 'en', name: '🌐 ENGLISH', role: 'English' }, { lang: 'es', name: '🌐 ESPAÑOL', role: 'Español' }];
const supportChannel = '1558832985246146560';
const languageTitle = 'Язык · Language · Idioma';

const missing = [!guildId && 'DISCORD_GUILD_ID', !token && 'DISCORD_BOT_TOKEN'].filter(Boolean);
if (missing.length) {
  console.error(`Discord: задайте ${missing.join(', ')}`);
  process.exitCode = 1;
} else {
  try {
    const stats = { created: 0, changed: 0, unchanged: 0 };
    const roles = await api(`/guilds/${guildId}/roles`);
    const channels = await api(`/guilds/${guildId}/channels`);
    const supportOverwrites = (channels.find((item) => item.id === supportChannel)?.permission_overwrites ?? []).map((item) => ({ ...item }));
    const onboarding = await api(`/guilds/${guildId}/onboarding`);
    const languageRoles = {};

    async function api(path, method = 'GET', body) {
      for (;;) {
        const response = await fetch(`https://discord.com/api/v10${path}`, {
          method,
          headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const raw = await response.text();
        let data;
        try { data = JSON.parse(raw); } catch { data = raw; }
        if (response.status === 429) {
          const seconds = Number(data.retry_after ?? response.headers.get('Retry-After') ?? 1);
          await new Promise((resolve) => setTimeout(resolve, Math.max(0, seconds) * 1000));
          continue;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status} ${method} ${path}: ${raw}`);
        return data;
      }
    }

    async function change(label, method, path, body, kind = 'changed') {
      stats[kind]++;
      console.log(`Discord: ${apply ? label : `план — ${label}`}`);
      return apply ? api(path, method, body) : null;
    }

    function putBits(list, id, allow, deny) {
      const item = list.find((entry) => entry.id === id) ?? { id, type: 0, allow: '0', deny: '0' };
      const next = { ...item, type: 0, allow: ((BigInt(item.allow ?? 0) | allow) & ~deny).toString(), deny: ((BigInt(item.deny ?? 0) | deny) & ~allow).toString() };
      if (!list.includes(item)) list.push(next);
      else list.splice(list.indexOf(item), 1, next);
    }

    async function syncOverwrites(channel, desired, prune = false) {
      for (const entry of desired) {
        const current = (channel.permission_overwrites ?? []).find((item) => item.id === entry.id);
        if (current && BigInt(current.allow) === BigInt(entry.allow) && BigInt(current.deny) === BigInt(entry.deny) && current.type === entry.type) {
          stats.unchanged++;
          continue;
        }
        await change(`права ${channel.name} / ${entry.id}`, 'PUT', `/channels/${channel.id}/permissions/${entry.id}`, { type: entry.type, allow: entry.allow, deny: entry.deny });
        channel.permission_overwrites ??= [];
        channel.permission_overwrites = channel.permission_overwrites.filter((item) => item.id !== entry.id).concat(entry);
      }
      if (prune) {
        const desiredIds = new Set(desired.map((entry) => entry.id));
        for (const entry of channel.permission_overwrites ?? []) {
          if (!desiredIds.has(entry.id)) await change(`удалить права ${channel.name} / ${entry.id}`, 'DELETE', `/channels/${channel.id}/permissions/${entry.id}`);
        }
        channel.permission_overwrites = (channel.permission_overwrites ?? []).filter((entry) => desiredIds.has(entry.id));
      }
    }

    function desiredOverwrites(source, roleId) {
      const languageIds = new Set(Object.values(languageRoles).map((role) => role.id));
      const list = (source.permission_overwrites ?? []).filter((item) => !languageIds.has(item.id)).map((item) => ({ ...item }));
      putBits(list, guildId, 0n, view);
      putBits(list, roleId, view, 0n);
      for (const id of supportRoles) putBits(list, id, view, 0n);
      putBits(list, botRole, source.type === 2 || source.type === 13 ? voiceBotAllow : botAllow, 0n);
      return list;
    }

    for (const name of ['Русский', 'English', 'Español']) {
      let role = roles.find((item) => item.name === name);
      if (!role) {
        const created = await change(`создать роль ${name}`, 'POST', `/guilds/${guildId}/roles`, { name, permissions: '0', hoist: false, mentionable: false }, 'created');
        role = created ?? { id: `new:${name}`, name };
        roles.push(role);
      } else stats.unchanged++;
      languageRoles[name] = role;
    }

    const community = channels.find((item) => item.id === '1553336873814990869');
    if (!community) throw new Error('не найдена категория 💬 СООБЩЕСТВО');
    const sources = new Map(mirrors.map((mirror) => {
      const sourceTypes = mirror.type === undefined ? [0, 5, 15, 16] : [mirror.type];
      const channel = channels.find((item) => ruCategories.includes(item.parent_id) && item.name === mirror.ru && sourceTypes.includes(item.type));
      if (!channel) throw new Error(`не найден русский канал ${mirror.ru}`);
      return [mirror.ru, channel];
    }));
    const mapped = [];
    for (const branch of branches) {
      let category = channels.find((item) => item.type === 4 && item.name === branch.name);
      const permissions = desiredOverwrites(community, languageRoles[branch.role].id);
      if (!category) {
        const created = await change(`создать категорию ${branch.name}`, 'POST', `/guilds/${guildId}/channels`, { name: branch.name, type: 4, permission_overwrites: permissions }, 'created');
        category = created ?? { id: `new:${branch.lang}`, name: branch.name, type: 4, permission_overwrites: permissions };
        channels.push(category);
      } else {
        const changed = stats.changed;
        await syncOverwrites(category, permissions, true);
        if (apply && stats.changed !== changed) channels.splice(0, channels.length, ...await api(`/guilds/${guildId}/channels`));
      }
      mapped.push([category.id, branch.lang]);
      const old = obsolete[branch.lang];
      const oldChannel = channels.find((item) => item.parent_id === category.id && item.name === old.name && item.type === old.type);
      if (oldChannel) {
        await change(`удалить канал ${branch.name} / ${old.name}`, 'DELETE', `/channels/${oldChannel.id}`);
        channels.splice(channels.indexOf(oldChannel), 1);
      }
      for (const mirror of mirrors) {
        const source = sources.get(mirror.ru);
        const name = mirror[branch.lang];
        const config = { name, type: source.type, parent_id: category.id };
        if (source.type === 2 || source.type === 13) {
          for (const field of ['bitrate', 'user_limit', 'rtc_region', 'video_quality_mode']) if (field in source) config[field] = source[field];
        } else {
          config.topic = '';
          if ('rate_limit_per_user' in source) config.rate_limit_per_user = source.rate_limit_per_user;
          if (source.type === 15) {
            for (const field of ['default_reaction_emoji', 'default_sort_order', 'default_forum_layout']) if (field in source) config[field] = source[field];
            if (!('default_forum_layout' in config) && 'default_layout' in source) config.default_forum_layout = source.default_layout;
          }
        }
        const expected = desiredOverwrites(source, languageRoles[branch.role].id);
        let channel = channels.find((item) => item.parent_id === category.id && item.name === name && item.type === source.type);
        if (!channel) {
          const created = await change(`создать канал ${branch.name} / ${name}`, 'POST', `/guilds/${guildId}/channels`, { ...config, permission_overwrites: expected }, 'created');
          channel = created ?? { ...config, id: `new:${branch.lang}:${name}`, permission_overwrites: expected };
          channels.push(channel);
        } else {
          const patch = Object.fromEntries(Object.entries(config).filter(([key, value]) => key !== 'type' && key !== 'parent_id' && (key === 'topic' ? Boolean(channel[key]) : JSON.stringify(channel[key] ?? null) !== JSON.stringify(value ?? null))));
          if (Object.keys(patch).length) {
            await change(`настроить канал ${branch.name} / ${name}`, 'PATCH', `/channels/${channel.id}`, patch);
            Object.assign(channel, patch);
          } else stats.unchanged++;
          await syncOverwrites(channel, expected, true);
        }
      }
      for (const channel of channels.filter((item) => item.parent_id === category.id)) mapped.push([channel.id, branch.lang]);
    }

    for (const categoryId of ruCategories) {
      let entries = channels.filter((item) => item.id === categoryId || item.parent_id === categoryId);
      if (!entries.some((item) => item.id === categoryId)) throw new Error(`не найдена русская категория ${categoryId}`);
      if (apply) entries.sort((a, b) => Number(b.id === categoryId) - Number(a.id === categoryId));
      for (let index = 0; index < entries.length; index++) {
        const channel = entries[index];
        if (channel.id === supportChannel) continue;
        if (sharedChannels.has(channel.id)) {
          const name = sharedChannels.get(channel.id);
          if (channel.name !== name) await change(`переименовать ${channel.name} → ${name}`, 'PATCH', `/channels/${channel.id}`, { name });
          else stats.unchanged++;
          const languageIds = [languageRoles.English.id, languageRoles.Español.id, languageRoles.Русский.id];
          for (const entry of channel.permission_overwrites ?? []) {
            if (languageIds.includes(entry.id)) await change(`удалить права ${name} / ${entry.id}`, 'DELETE', `/channels/${channel.id}/permissions/${entry.id}`);
          }
          continue;
        }
        mapped.push([channel.id, 'ru']);
        const everyone = (channel.permission_overwrites ?? []).find((item) => item.id === guildId);
        if (everyone && (BigInt(everyone.deny ?? 0) & view)) continue;
        const desired = (channel.permission_overwrites ?? []).map((item) => ({ ...item }));
        putBits(desired, languageRoles.English.id, 0n, view);
        putBits(desired, languageRoles.Español.id, 0n, view);
        putBits(desired, languageRoles.Русский.id, view, 0n);
        const changed = stats.changed;
        await syncOverwrites(channel, desired.filter((item) => [languageRoles.English.id, languageRoles.Español.id, languageRoles.Русский.id].includes(item.id)));
        if (apply && channel.id === categoryId && stats.changed !== changed) {
          channels.splice(0, channels.length, ...await api(`/guilds/${guildId}/channels`));
          entries = [channels.find((item) => item.id === categoryId), ...channels.filter((item) => item.parent_id === categoryId)];
        }
      }
    }

    let sequence = 0n;
    const snowflake = () => (((BigInt(Date.now()) - 1420070400000n) << 22n) | sequence++).toString();
    const normalizeOption = (option) => {
      const { emoji, ...data } = option;
      for (const key of ['emoji_id', 'emoji_name', 'emoji_animated']) delete data[key];
      if (!emoji) return data;
      if (emoji.id) data.emoji_id = emoji.id;
      if (emoji.name) data.emoji_name = emoji.name;
      data.emoji_animated = emoji.animated ?? false;
      return data;
    };
    const prompts = onboarding.prompts.map((prompt) => ({ ...prompt, options: prompt.options.map((option) => ({ ...option })) }));
    let languagePrompt = prompts.find((prompt) => prompt.title === languageTitle);
    if (!languagePrompt) {
      languagePrompt = { id: snowflake(), title: languageTitle, type: 0, single_select: true, required: true, in_onboarding: true, options: [] };
      prompts.unshift(languagePrompt);
    } else {
      prompts.splice(prompts.indexOf(languagePrompt), 1);
      prompts.unshift(languagePrompt);
    }
    for (const [title, emoji] of [['Русский', '🇷🇺'], ['English', '🇬🇧'], ['Español', '🇪🇸']]) {
      let option = languagePrompt.options.find((item) => item.title === title);
      if (!option) {
        option = { id: snowflake(), title, description: '', emoji: { name: emoji }, role_ids: [], channel_ids: [] };
        languagePrompt.options.push(option);
      }
      option.role_ids = [languageRoles[title].id];
    }
    const rename = [
      ['1553342928691400706', 'Игровой сервер · Game server · Servidor', [['Европа', 'Европа · Europe · Europa'], ['Америка', 'Америка · America · América'], ['Азия', 'Азия · Asia · Asia'], ['TW-HK-MO', 'TW-HK-MO']]],
      ['1553342928691400713', 'Показывать утечки? · Show leaks? · ¿Mostrar filtraciones?', [['Да', 'Да · Yes · Sí']]],
      ['1553342928783679521', 'Уведомления · Notifications · Notificaciones', [['1553342928783679524', 'Новости · News · Noticias'], ['1553342928783679525', 'Баннеры · Banners · Gachapones']]],
    ];
    for (const [id, title, options] of rename) {
      const prompt = prompts.find((item) => item.id === id);
      if (!prompt) { console.warn(`Discord: вопрос ${id} не найден`); continue; }
      prompt.title = title;
      for (const [oldTitle, newTitle] of options) {
        const option = prompt.options.find((item) => item.id === oldTitle || item.title === oldTitle || item.title === newTitle);
        if (option) option.title = newTitle;
        else console.warn(`Discord: вариант «${oldTitle}» не найден`);
      }
    }
    const nextOnboarding = { enabled: onboarding.enabled, mode: onboarding.mode, default_channel_ids: onboarding.default_channel_ids, prompts: prompts.map((prompt) => ({ ...prompt, options: prompt.options.map(normalizeOption) })) };
    const currentOnboarding = { ...nextOnboarding, prompts: onboarding.prompts.map((prompt) => ({ ...prompt, options: prompt.options.map(normalizeOption) })) };
    if (JSON.stringify(nextOnboarding) !== JSON.stringify(currentOnboarding)) await change('обновить онбординг', 'PUT', `/guilds/${guildId}/onboarding`, nextOnboarding);
    else stats.unchanged++;
    if (apply) {
      const current = await api(`/channels/${supportChannel}`);
      const original = supportOverwrites.map((item) => [BigInt(item.id), BigInt(item.type), BigInt(item.allow ?? 0), BigInt(item.deny ?? 0)].join(':')).sort();
      const actual = (current.permission_overwrites ?? []).map((item) => [BigInt(item.id), BigInt(item.type), BigInt(item.allow ?? 0), BigInt(item.deny ?? 0)].join(':')).sort();
      if (JSON.stringify(original) !== JSON.stringify(actual)) {
        for (const entry of supportOverwrites) {
          await api(`/channels/${supportChannel}/permissions/${entry.id}`, 'PUT', { type: entry.type, allow: entry.allow, deny: entry.deny });
          stats.changed++;
        }
        const originalIds = new Set(supportOverwrites.map((item) => item.id));
        for (const entry of current.permission_overwrites ?? []) {
          if (originalIds.has(entry.id)) continue;
          await api(`/channels/${supportChannel}/permissions/${entry.id}`, 'DELETE');
          stats.changed++;
        }
        console.log('Discord: восстановил права поддержка');
      }
    }
    console.log(`DISCORD_CHANNEL_LANGS = "${mapped.map(([id, lang]) => `${id}:${lang}`).join(',')}"`);
    console.log(`Discord: ${apply ? 'создано' : 'будет создано'} ${stats.created}, ${apply ? 'изменено' : 'будет изменено'} ${stats.changed}, без изменений ${stats.unchanged}`);
  } catch (error) {
    console.error(`Discord: ${error instanceof Error ? error.message : String(error)}`);
    if (String(error).includes('HTTP 403')) console.error('Discord: боту нужны права Управлять ролями, Управлять каналами, Управлять вебхуками, Управлять сервером');
    process.exitCode = 1;
  }
}
