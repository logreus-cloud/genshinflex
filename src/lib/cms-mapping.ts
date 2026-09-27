type Value = string | number | boolean | null | Value[] | { [key: string]: Value };
type RecordValue = { [key: string]: Value };

const objectTypes: Record<string, string> = {
  'build:weapons[]': 'weaponChoice',
  'build:artifacts[]': 'artifactChoice',
  'build:mainStats': 'mainStats',
  'build:teams[]': 'team',
  'build:sources[]': 'source',
  'build:external[]': 'externalLink',
  'build:videos[]': 'video',
  'banner:featured[]': 'featuredCharacter',
  'banner:sources[]': 'source',
  'rotation:cast[]': 'rotationCast',
  'rotation:halves[]': 'rotationHalf',
  'rotation:halves[].need[]': 'elementGroup',
  'rotation:floors[]': 'rotationFloor',
  'rotation:floors[].chambers[]': 'rotationChamber',
  'rotation:floors[].chambers[].halves[]': 'rotationEnemyHalf',
  'rotation:floors[].chambers[].halves[].enemies[]': 'enemy',
  'rotation:floors[].teams[]': 'rotationTeam',
  'rotation:stages[]': 'rotationStage',
  'rotation:stages[].halves[]': 'rotationEnemyHalf',
  'rotation:stages[].halves[].enemies[]': 'enemyText',
  'rotation:teams[]': 'rotationTeam',
  'rotation:sources[]': 'source',
  'endgameGuide:teams[]': 'team',
  'endgameGuide:external[]': 'externalLink',
  'weaponGuide:external[]': 'externalLink',
};

const localized = new Set([
  'rotation:note',
  'rotation:tags[]',
  'rotation:buffs[]',
  'rotation:cast[].title',
  'rotation:halves[].label',
  'rotation:halves[].tip',
  'rotation:floors[].disorder[]',
  'rotation:floors[].chambers[].name',
  'rotation:floors[].chambers[].halves[].note',
  'rotation:floors[].chambers[].halves[].enemies[].note',
  'rotation:floors[].teams[].name',
  'rotation:floors[].teams[].note',
  'rotation:stages[].name',
  'rotation:stages[].halves[].note',
  'rotation:stages[].halves[].enemies[].note',
  'rotation:teams[].name',
  'rotation:teams[].note',
]);

const needs = 'rotation:halves[].need[]';
const enemyPaths = new Set([
  'rotation:floors[].chambers[].halves[].enemies[]',
  'rotation:stages[].halves[].enemies[]',
]);

function hash(value: unknown): string {
  let result = 2166136261;
  for (const char of JSON.stringify(value)) {
    result ^= char.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

export function bodyHash(body: unknown): string | undefined {
  if (body === undefined) return undefined;
  return hash(body);
}

function convert(value: Value, type: string, path: string, direction: 'to' | 'from', index = 0): Value {
  const key = `${type}:${path}`;
  if (direction === 'to' && localized.has(key) && typeof value === 'string') {
    return { _type: 'localeString', ...(path.endsWith('[]') ? { _key: `${index}-${hash(value)}` } : {}), ru: value };
  }
  if (direction === 'from' && localized.has(key) && value && !Array.isArray(value) && typeof value === 'object') {
    return (value as RecordValue).ru ?? '';
  }
  if (direction === 'to' && key === needs && Array.isArray(value)) {
    return { _type: 'elementGroup', _key: `${index}-${hash(value)}`, elements: value };
  }
  if (direction === 'from' && key === needs && value && typeof value === 'object' && !Array.isArray(value)) {
    return (value as RecordValue).elements;
  }
  if (direction === 'to' && enemyPaths.has(key) && typeof value === 'string') {
    return { _type: 'enemyText', _key: `${index}-${hash(value)}`, name: value };
  }
  if (direction === 'from' && enemyPaths.has(key) && value && typeof value === 'object' && !Array.isArray(value) && 'name' in value) {
    return (value as RecordValue).name;
  }
  if (Array.isArray(value)) {
    return value.map((item, itemIndex) => convert(item, type, `${path}[]`, direction, itemIndex));
  }
  if (value && typeof value === 'object') {
    const fields: RecordValue = {};
    for (const [field, item] of Object.entries(value)) {
      if (direction === 'from' && field.startsWith('_')) continue;
      fields[field] = convert(item, type, path ? `${path}.${field}` : field, direction);
    }
    if (direction === 'to') {
      const objectType = objectTypes[key];
      if (objectType) {
        fields._type = objectType;
        if (path.endsWith('[]')) fields._key = `${index}-${hash(value)}`;
      }
    }
    return fields;
  }
  return value;
}

export function toSanityData(type: string, data: RecordValue): RecordValue {
  const result = convert(data, type, '', 'to') as RecordValue;
  if (type === 'news' && typeof result.date === 'string') {
    result.dateTime = result.date;
    result.date = result.date.slice(0, 10);
  }
  return result;
}

export function fromSanityData(type: string, document: RecordValue): RecordValue {
  const data = convert(document, type, '', 'from') as RecordValue;
  for (const field of ['body', 'bodyMarkdown', 'bodyHash', 'dateTime']) delete data[field];
  if (type === 'news' && typeof document.dateTime === 'string' && document.dateTime.slice(0, 10) === document.date) data.date = document.dateTime;
  if (type === 'build' || type === 'weaponGuide' || type === 'endgameGuide') delete data.lang;
  if (['news', 'rotation', 'banner', 'weaponGuide', 'endgameGuide'].includes(type)) delete data.slug;
  return data;
}
