// Офлайн-проверка схем Studio тем же валидатором, что использует Sanity, — без доступа к проекту.
// Запуск: npm run validate -w @genshinflex/studio (собирается esbuild — схемы импортируют файлы без расширения)
import { validateSchema, groupProblems } from '@sanity/schema/_internal';
import { schemaTypes } from './schemas/index.ts';

const result = validateSchema(schemaTypes);
const problems = groupProblems(result.getTypes());
const errors = problems.flatMap((group) => group.problems.filter((p) => p.severity === 'error').map((p) => ({ path: group.path, message: p.message })));
const warnings = problems.flatMap((group) => group.problems.filter((p) => p.severity === 'warning').map((p) => ({ path: group.path, message: p.message })));
for (const w of warnings) console.log('предупреждение:', w.path.map((x) => x.name ?? x.type ?? x.kind).join(' › '), '—', w.message);
for (const e of errors) console.log('ОШИБКА:', e.path.map((x) => x.name ?? x.type ?? x.kind).join(' › '), '—', e.message);
console.log(`Схема: ${schemaTypes.length} типов, ошибок ${errors.length}, предупреждений ${warnings.length}`);
process.exit(errors.length ? 1 : 0);
