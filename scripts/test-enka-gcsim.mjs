import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { applyBuilds, enkaToBuilds } from '../src/lib/enka-gcsim.ts';

const presets = JSON.parse(readFileSync('public/data/sim-presets.json', 'utf8'));
const enka = JSON.parse(readFileSync('scripts/fixtures/enka-sample.json', 'utf8'));
const { builds, skipped } = enkaToBuilds(enka, presets.ids);
console.log(JSON.stringify({ builds, skipped }, null, 2));
assert.ok(builds.length > 0, 'В фикстуре нет распознанных персонажей');
for (const build of builds) {
  assert.ok(build.level >= 1 && build.level <= build.maxLevel);
  assert.ok([20, 40, 50, 60, 70, 80, 90].includes(build.maxLevel));
  assert.ok(build.cons >= 0 && build.cons <= 6);
  assert.ok(build.talents.every((level) => level >= 1 && level <= 15));
  assert.equal(Object.values(build.sets).reduce((sum, count) => sum + count, 0), 5);
  assert.ok(build.stats.cr > 0 && build.stats.cr < 1);
  assert.ok(build.stats.atk > 0);
}

await import(pathToFileURL(resolve('public/gcsim/wasm_exec.js')).href);
const go = new globalThis.Go();
const wasm = gunzipSync(readFileSync('public/gcsim/gcsim.wasm.gz'));
const { instance } = await WebAssembly.instantiate(wasm, go.importObject);
void go.run(instance);

function check(value) {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed?.error) throw new Error(parsed.error);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return value;
}

const bySlug = new Map(builds.map((build) => [build.slug, build]));
let tested = 0, failed = 0;
for (const [slug, preset] of Object.entries(presets.presets)) {
  if (!preset.members.some((member) => bySlug.has(member.slug))) continue;
  const { config, applied, warnings } = applyBuilds(preset, bySlug);
  for (const warning of warnings) console.log(`— ${slug}: ${warning}`);
  const expected = preset.members.filter((member) => bySlug.has(member.slug));
  if (applied.length !== expected.length) {
    console.error(`✗ ${slug}: применено ${applied.length} из ${expected.length} билдов`);
    failed++;
    continue;
  }
  try {
    check(globalThis.validateConfig(config));
  } catch (error) {
    console.error(`✗ ${slug}: ${error.message}`);
    failed++;
    continue;
  }
  try {
    check(globalThis.initializeAggregator(config));
    check(globalThis.initializeWorker(config));
    for (let i = 0; i < 20; i++) check(globalThis.aggregate(check(globalThis.simulate())));
    const { stats } = JSON.parse(check(globalThis.flush()));
    console.log(`✓ ${slug}: эталон ${preset.dps} DPS → билд ${Math.round(stats.dps.mean)} DPS`);
    tested++;
  } catch (error) {
    console.error(`✗ ${slug}: ${error.message}`);
    failed++;
  }
}
console.log(`Проверено: ${tested}; ошибок: ${failed}`);
if (!tested) console.error('Не проверен ни один пресет');
process.exit(failed || !tested ? 1 : 0);
