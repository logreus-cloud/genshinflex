export type SimIds = { chars: Record<string, string>; weapons: Record<string, string>; sets: Record<string, string> };
export type SimBuild = {
  slug: string; level: number; maxLevel: number; cons: number; talents: [number, number, number];
  weapon: { key: string; refine: number; level: number; maxLevel: number } | null;
  sets: Record<string, number>;
  unknownSets?: number;                   // вещи из сетов, которых нет в gcsim: их бонус теряется
  stats: Record<string, number>;
};

const prop: Record<string, string> = {
  FIGHT_PROP_HP: 'hp', FIGHT_PROP_HP_PERCENT: 'hp%',
  FIGHT_PROP_ATTACK: 'atk', FIGHT_PROP_ATTACK_PERCENT: 'atk%',
  FIGHT_PROP_DEFENSE: 'def', FIGHT_PROP_DEFENSE_PERCENT: 'def%',
  FIGHT_PROP_CHARGE_EFFICIENCY: 'er', FIGHT_PROP_ELEMENT_MASTERY: 'em',
  FIGHT_PROP_CRITICAL: 'cr', FIGHT_PROP_CRITICAL_HURT: 'cd',
  FIGHT_PROP_HEAL_ADD: 'heal', FIGHT_PROP_PHYSICAL_ADD_HURT: 'phys%',
  FIGHT_PROP_FIRE_ADD_HURT: 'pyro%', FIGHT_PROP_ELEC_ADD_HURT: 'electro%',
  FIGHT_PROP_WATER_ADD_HURT: 'hydro%', FIGHT_PROP_GRASS_ADD_HURT: 'dendro%',
  FIGHT_PROP_WIND_ADD_HURT: 'anemo%', FIGHT_PROP_ROCK_ADD_HURT: 'geo%',
  FIGHT_PROP_ICE_ADD_HURT: 'cryo%',
};
const maxLevels = [20, 40, 50, 60, 70, 80, 90];
// Путешественник (Итер 10000005, Люмин 10000007) — стихию берём по максимальной энергии: у персонажа ненулевое ровно одно поле 70–76
const TRAVELER_ELEMENT: Record<string, string> = { '70': 'pyro', '71': 'electro', '72': 'hydro', '73': 'dendro', '74': 'anemo', '75': 'cryo', '76': 'geo' };
// После полного возвышения персонажа можно поднять до 95 и 100 уровня — потолок тогда 95 или 100, gcsim это понимает
const charCap = (level: number, promote: number) => (promote === 6 && level > 90 ? (level <= 95 ? 95 : 100) : maxLevels[promote]);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const number = (value: unknown): number | null => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const integer = (value: unknown, min: number, max: number) => {
  const n = number(value);
  return n !== null && Number.isInteger(n) && n >= min && n <= max ? n : null;
};

export function enkaToBuilds(body: unknown, ids: SimIds): { builds: SimBuild[]; skipped: number[] } {
  const builds: SimBuild[] = [], skipped: number[] = [];
  const list = record(body).avatarInfoList;
  for (const value of Array.isArray(list) ? list : []) {
    const avatar = record(value);
    const avatarId = integer(avatar.avatarId, 1, Number.MAX_SAFE_INTEGER);
    if (avatarId === null) continue;
    let slug = Object.hasOwn(ids.chars, String(avatarId)) ? ids.chars[String(avatarId)] : undefined;
    if (avatarId === 10000005 || avatarId === 10000007) {
      const fight = record(avatar.fightPropMap);
      const energy = Object.keys(TRAVELER_ELEMENT).find((k) => (number(fight[k]) ?? 0) > 0);
      slug = energy ? `traveler-${TRAVELER_ELEMENT[energy]}` : undefined;
    }
    const props = record(avatar.propMap);
    const level = integer(record(props['4001']).val, 1, 100);
    const promote = integer(record(props['1002']).val, 0, 6);
    if (!slug || level === null || promote === null || level > charCap(level, promote)) {
      skipped.push(avatarId);
      continue;
    }
    const skills = Object.values(record(avatar.skillLevelMap)).map((v) => integer(v, 1, 15));
    const talents: [number, number, number] = skills.length >= 3 && skills[0] !== null && skills[1] !== null && skills.at(-1) !== null
      ? [skills[0]!, skills[1]!, skills.at(-1)!] : [1, 1, 1];
    const sets: Record<string, number> = {}, sums: Record<string, number> = {};
    let unknownSets = 0;
    let weapon: SimBuild['weapon'] = null;
    for (const value of Array.isArray(avatar.equipList) ? avatar.equipList : []) {
      const item = record(value), equipped = record(item.weapon), flat = record(item.flat);
      if (item.weapon) {
        const key = Object.hasOwn(ids.weapons, String(item.itemId)) ? ids.weapons[String(item.itemId)] : undefined;
        const wLevel = integer(equipped.level, 1, 100);
        const wPromote = integer(equipped.promoteLevel, 0, 6);
        const affixes = Object.values(record(equipped.affixMap));
        const affix = affixes.length ? integer(affixes[0], 0, 4) : 0;
        if (key && wLevel !== null && wPromote !== null && wLevel <= maxLevels[wPromote] && affix !== null) {
          weapon = { key, refine: 1 + affix, level: wLevel, maxLevel: maxLevels[wPromote] };
        }
        continue;
      }
      if (!item.reliquary) continue;
      const set = Object.hasOwn(ids.sets, String(flat.setId)) ? ids.sets[String(flat.setId)] : undefined;
      if (set) sets[set] = (sets[set] ?? 0) + 1;
      else if (flat.setId) unknownSets++;
      const stats = [flat.reliquaryMainstat, ...(Array.isArray(flat.reliquarySubstats) ? flat.reliquarySubstats : [])];
      for (const value of stats) {
        const stat = record(value), id = String(stat.mainPropId ?? stat.appendPropId);
        const name = Object.hasOwn(prop, id) ? prop[id] : undefined;
        const amount = number(stat.statValue);
        if (!name || amount === null) continue;
        sums[name] = (sums[name] ?? 0) + (name.includes('%') || ['er', 'cr', 'cd', 'heal'].includes(name) ? amount / 100 : amount);
      }
    }
    const stats = Object.fromEntries(Object.entries(sums).map(([name, value]) => [name, +value.toFixed(4)]));
    builds.push({
      slug, level, maxLevel: charCap(level, promote), cons: Math.min(6, Array.isArray(avatar.talentIdList) ? avatar.talentIdList.length : 0),
      talents, weapon, sets, stats, unknownSets,
    });
  }
  return { builds, skipped };
}

export function applyBuilds(
  preset: { config: string; members: { slug: string; alias: string }[] },
  builds: Map<string, SimBuild>,
): { config: string; applied: string[]; warnings: string[] } {
  let lines = preset.config.split('\n');
  const applied: string[] = [], warnings: string[] = [];
  for (const { slug, alias } of preset.members) {
    const build = builds.get(slug);
    if (!build) continue;
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const character = new RegExp(`^(\\s*)${escaped}\\s+char\\b`);
    const weapon = new RegExp(`^(\\s*)${escaped}\\s+add\\s+weapon=`);
    const artifact = new RegExp(`^\\s*${escaped}\\s+add\\s+(?:set=|stats\\b)`);
    const charIndex = lines.findIndex((line) => character.test(line));
    const weaponIndex = lines.findIndex((line) => weapon.test(line));
    if (charIndex < 0 || weaponIndex < 0) {
      warnings.push(`${slug}: не найдена строка персонажа или оружия`);
      continue;
    }
    const command = (line: string) => {
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"' && line[i - 1] !== '\\') quoted = !quoted;
        if (line[i] === '#' && !quoted) return line.slice(0, i);
      }
      return line;
    };
    const params = (line: string) => command(line).match(/\+params=\[[^\]]*\]/)?.[0] ?? '';
    const prefix = lines[charIndex].match(character)![1];
    lines[charIndex] = `${prefix}${alias} char lvl=${build.level}/${build.maxLevel} cons=${build.cons} talent=${build.talents.join(',')}${params(lines[charIndex]) ? ` ${params(lines[charIndex])}` : ''};`;
    const original = lines[weaponIndex];
    if (build.weapon) {
      const oldKey = command(original).match(/\bweapon="([^"]+)"/)?.[1];
      const keep = oldKey === build.weapon.key ? params(original) : '';
      const indent = original.match(weapon)![1];
      lines[weaponIndex] = `${indent}${alias} add weapon="${build.weapon.key}" refine=${build.weapon.refine} lvl=${build.weapon.level}/${build.weapon.maxLevel}${keep ? ` ${keep}` : ''};`;
    } else warnings.push(`${slug}: неизвестное оружие, оставлено эталонное`);
    lines = lines.filter((line) => !artifact.test(line));
    const insert = lines.findIndex((line) => weapon.test(line));
    const sets = Object.entries(build.sets).sort((a, b) => b[1] - a[1]);
    const four = sets.find(([, count]) => count >= 4);
    const chosen = four ? [[four[0], 4] as const] : sets.filter(([, count]) => count >= 2).slice(0, 2).map(([key]) => [key, 2] as const);
    const additions = chosen.map(([key, count]) => `${alias} add set="${key}" count=${count};`);
    const stats = Object.entries(build.stats).filter(([, value]) => Number.isFinite(value));
    if (stats.length) additions.push(`${alias} add stats ${stats.map(([key, value]) => `${key}=${value}`).join(' ')};`);
    else warnings.push(`${slug}: нет статов артефактов`);
    if ((build.unknownSets ?? 0) >= 2) warnings.push(`${slug}: сет артефактов неизвестен gcsim, его бонус не учтён`);
    lines.splice(insert + 1, 0, ...additions);
    applied.push(slug);
  }
  return { config: lines.join('\n'), applied, warnings };
}
