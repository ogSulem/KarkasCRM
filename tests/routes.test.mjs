// Маршруты API: интерфейс не должен ходить в никуда, а список «только для админа»
// не должен охранять путь, которого на сервере нет. Обе ошибки уже случались:
// /api/prices/ours числился в ADMIN_ONLY без обработчика — менеджер получал внятный
// 403, а админ вместо загрузки прайса видел 404. Проверка статическая: читает
// исходники, сервер не поднимает, поэтому не зависит от портов и данных.
// Запуск: node --test tests/routes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');
const feSrc = read('frontend/public/app.js');
const beSrc = ['backend/src/server.js', 'backend/src/competitors.js'].map(read).join('\n');

// Пути, которые вызывает интерфейс: литералы '/api/…', шаблоны `/api/…${id}…`
// и склейки вида '/api/deals/' + id + '/print'. Подстановка заменяется на {}.
function frontendPaths(src) {
  const out = new Set();
  for (const m of src.matchAll(/['"`](\/api\/[^'"`\s]*)['"`]/g)) out.add(m[1].replace(/\$\{[^}]*\}/g, '{}'));
  for (const m of src.matchAll(/['"`](\/api\/[^'"`\s]*\/)['"`]\s*\+/g)) out.add(m[1] + '{}');
  // '/api/deals/' — префикс склейки (он же станет '/api/deals/{}'),
  // '/api/' + table + '/' + id — путь целиком динамический, статически не проверить
  return [...out].map(p => p.split('?')[0])
    .filter(p => p.length > 5 && p !== '/api/' && !p.endsWith('/') && !/^\/api\/\{\}/.test(p));
}

// Маршруты сервера: сравнения p === '/api/…', префиксы p.startsWith(…) и
// регэкспы p.match(/^\/api\/…/). Общий префикс '/api/' маршрутом не считается —
// это 404-заглушка, с ней «покрытым» оказался бы любой путь.
function backendRoutes(src) {
  const eq = new Set(), pre = new Set(), res = [];
  for (const m of src.matchAll(/p\s*===?\s*'(\/api\/[^']+)'/g)) eq.add(m[1]);
  for (const m of src.matchAll(/p\.startsWith\(\s*'(\/api\/[^']+)'/g)) if (m[1] !== '/api/') pre.add(m[1]);
  for (const m of src.matchAll(/\/(\^(?:[^/\\\n]|\\.)+)\/(?=[a-z]*\s*[).;,])/g)) {
    if (!/api/.test(m[1])) continue;
    try { res.push(new RegExp(m[1].replace(/\\\//g, '/'))) } catch { /* неразобранный литерал маршрутом не считается */ }
  }
  return p => eq.has(p) || [...pre].some(x => p.startsWith(x)) || res.some(r => r.test(p));
}

// Вместо {} подставляем и число, и строку: часть маршрутов принимает только \d+
const covers = (match, p) => (p.includes('{}') ? ['1', 'abc'].map(s => p.replaceAll('{}', s)) : [p]).some(match);

test('каждый путь API, который вызывает интерфейс, существует на сервере', () => {
  const match = backendRoutes(beSrc);
  const paths = frontendPaths(feSrc);
  assert.ok(paths.length > 50, 'пути интерфейса собраны: ' + paths.length);
  const orphans = paths.filter(p => !covers(match, p));
  assert.deepEqual(orphans, [], 'интерфейс обращается к несуществующим маршрутам: ' + orphans.join(', '));
});

test('список «только для админа» охраняет существующие маршруты', () => {
  const block = /const ADMIN_ONLY = \[([\s\S]*?)\];/.exec(beSrc);
  assert.ok(block, 'список ADMIN_ONLY найден');
  const match = backendRoutes(beSrc);
  // /^\/api\/prices\/ours(\/.*)?$/  →  /api/prices/ours
  const guarded = [...block[1].matchAll(/\/(\^[^]*?\$)\//g)]
    .map(m => m[1].replace(/^\^/, '').replace(/\$$/, '').replace(/\([^()]*\)\??$/, '').replace(/\\\//g, '/'));
  assert.ok(guarded.length >= 8, 'список прав прочитан целиком: ' + guarded.length + ' — ' + guarded.join(', '));
  const orphans = guarded.filter(p => !match(p));
  assert.deepEqual(orphans, [], 'права проверяются для маршрута, которого нет на сервере: ' + orphans.join(', '));
});

test('подсказка к закрытому маршруту относится к тому же пути, что и само правило', () => {
  const hints = [...beSrc.matchAll(/const ADMIN_ONLY_HINT = \[([\s\S]*?)\];/g)].map(m => m[1]).join('\n');
  const guarded = [.../const ADMIN_ONLY = \[([\s\S]*?)\];/.exec(beSrc)[1].matchAll(/\/(\^[^]*?\$)\//g)].map(m => m[1]);
  const hinted = [...hints.matchAll(/\/(\^[^]*?\$)\//g)].map(m => m[1]);
  assert.ok(hinted.length > 0, 'подсказки есть');
  const stray = hinted.filter(h => !guarded.includes(h));
  assert.deepEqual(stray, [], 'подсказка написана для пути, который не закрыт: ' + stray.join(', '));
});

test('детектор несуществующих маршрутов сам работает', () => {
  const match = backendRoutes(beSrc);
  assert.ok(!match('/api/definitely-not-a-route'), 'выдуманный путь не находится — иначе проверка ничего не ловит');
  assert.ok(match('/api/health') && match('/api/deals/1') && match('/api/prices/ours'), 'настоящие пути находятся');
  const fake = frontendPaths(feSrc + "\napi('/api/definitely-not-a-route');\n");
  assert.ok(fake.some(p => !covers(match, p)), 'добавленный в интерфейс выдуманный путь оказывается в сиротах');
});
