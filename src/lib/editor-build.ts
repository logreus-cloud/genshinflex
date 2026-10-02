import type { CollectionEntry } from 'astro:content';
import { fieldOrder } from '@genshinflex/content-model';

type Build = CollectionEntry<'builds'>['data'];
type EditorBuild = Omit<Build, 'updated'> & { updated: string; body: string };

const TEMPLATED = 'Краткий билд по данным сообщества';
// Все поля схемы передаются редактору; исключений сейчас нет.
export const EXCLUDED_BUILD_FIELDS: readonly string[] = [];

export function editorBuild(build: Build, body: string, { t, stat }: {
  t: (value: string) => string;
  stat: (value: string) => string;
  lang: string;
}): EditorBuild {
  const note = (s?: string) => (s ? t(s) : '');
  const source = build as Record<string, unknown>;
  const values = Object.fromEntries(fieldOrder('builds')
    .filter((key) => !EXCLUDED_BUILD_FIELDS.includes(key))
    .map((key) => {
      switch (key) {
        case 'role': return [key, t(build.role)];
        case 'updated': return [key, build.updated.toISOString().slice(0, 10)];
        case 'weapons': return [key, build.weapons.map((w) => ({ slug: w.slug, note: note(w.note) }))];
        case 'artifacts': return [key, build.artifacts.map((a) => ({ sets: a.sets, note: note(a.note) }))];
        case 'mainStats': return [key, {
          sands: stat(build.mainStats.sands), goblet: stat(build.mainStats.goblet), circlet: stat(build.mainStats.circlet),
        }];
        case 'substats': return [key, build.substats.map(stat)];
        case 'teams': return [key, build.teams.map((tm) => ({
          name: note(tm.name), members: tm.members, note: note(tm.note),
        }))];
        case 'rotations': return [key, build.rotations.map((rotation) => ({
          ...rotation, name: note(rotation.name), note: note(rotation.note),
        }))];
        default: return [key, source[key]];
      }
    }));
  return { ...values, body: body.startsWith(TEMPLATED) ? '' : body } as EditorBuild;
}
