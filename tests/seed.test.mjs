// Проверка начального заполнения: demo / base / off и защита непустой базы.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';

const boot = (mode) => {
  const dir = mkdtempSync(join(tmpdir(), 'karkas-seed-'));
  const env = { ...process.env, DATA_DIR: dir, PORT: '0', SEED_MODE: mode };
  const r = spawnSync(process.execPath, ['--experimental-sqlite', '-e', `
    process.env.DATA_DIR=${JSON.stringify(dir)}; process.env.PORT='0'; process.env.SEED_MODE=${JSON.stringify(mode)};
    const { server, db } = await import(${JSON.stringify(join(process.cwd(), 'backend/src/server.js'))});
    await new Promise(r2 => server.listening ? r2() : server.once('listening', r2));
    const out = {
      contacts: db.prepare('SELECT COUNT(*) n FROM contacts').get().n,
      deals: db.prepare('SELECT COUNT(*) n FROM deals').get().n,
      tasks: db.prepare('SELECT COUNT(*) n FROM tasks').get().n,
      convs: db.prepare('SELECT COUNT(*) n FROM conversations').get().n,
      products: db.prepare('SELECT COUNT(*) n FROM products').get().n,
      templates: db.prepare('SELECT COUNT(*) n FROM templates').get().n,
      automations: db.prepare('SELECT COUNT(*) n FROM automations').get().n,
      competitors: db.prepare('SELECT COUNT(*) n FROM competitors').get().n,
    };
    console.log('SEEDOUT ' + JSON.stringify(out));
    server.close(() => process.exit(0));
  `], { env, encoding: 'utf8' });
  const m = String(r.stdout).match(/SEEDOUT (\{.*\})/);
  return { dir, out: m ? JSON.parse(m[1]) : null, stderr: r.stderr };
};

let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); if (!cond) failed++ };

// demo: полные примеры
let r = boot('demo');
ok('demo: клиенты, сделки, задачи, чаты', r.out && r.out.contacts === 7 && r.out.deals === 9 && r.out.tasks === 6 && r.out.convs === 3, JSON.stringify(r.out));
ok('demo: каталог, шаблоны, правило, конкуренты', r.out && r.out.products === 7 && r.out.templates === 4 && r.out.automations === 1 && r.out.competitors === 2, JSON.stringify(r.out));
{
  const db = new DatabaseSync(join(r.dir, 'crm.db'));
  ok('demo: записи помечены demo=1', db.prepare('SELECT COUNT(*) n FROM contacts WHERE demo=1').get().n === 7);
  const msgs = db.prepare('SELECT COUNT(*) n FROM messages').get().n;
  ok('demo: история сообщений в чатах', msgs === 7, 'сообщений: ' + msgs);
  ok('demo: есть просроченная задача', db.prepare("SELECT COUNT(*) n FROM tasks WHERE due < datetime('now') AND done=0").get().n >= 1);
  db.close();
}
rmSync(r.dir, { recursive: true, force: true });

// base: правовая основа без примеров клиентов
r = boot('base');
ok('base: пусто по клиентам и сделкам', r.out && r.out.contacts === 0 && r.out.deals === 0 && r.out.convs === 0, JSON.stringify(r.out));
ok('base: каталог и шаблоны на месте', r.out && r.out.products === 7 && r.out.templates === 4 && r.out.automations === 1, JSON.stringify(r.out));
{
  const db = new DatabaseSync(join(r.dir, 'crm.db'));
  ok('base: начальные записи не помечены демо', db.prepare('SELECT COUNT(*) n FROM products WHERE demo=1').get().n === 0);
  db.close();
}
rmSync(r.dir, { recursive: true, force: true });

// off: совсем чисто
r = boot('off');
ok('off: база пуста', r.out && r.out.contacts === 0 && r.out.deals === 0 && r.out.products === 0, JSON.stringify(r.out));
rmSync(r.dir, { recursive: true, force: true });

// авто-выбор по домену: CRM_DOMAIN → base
r = boot(undefined); // без SEED_MODE и без домена — demo по умолчанию
ok('по умолчанию (без домена) — demo', r.out && r.out.contacts === 7, JSON.stringify(r.out));
rmSync(r.dir, { recursive: true, force: true });
{
  const dir = mkdtempSync(join(tmpdir(), 'karkas-seed-'));
  const env = { ...process.env, DATA_DIR: dir, PORT: '0', CRM_DOMAIN: 'crm.example.ru' };
  const res = spawnSync(process.execPath, ['--experimental-sqlite', '-e', `
    process.env.DATA_DIR=${JSON.stringify(dir)}; process.env.PORT='0'; process.env.CRM_DOMAIN='crm.example.ru';
    const { server, db } = await import(${JSON.stringify(join(process.cwd(), 'backend/src/server.js'))});
    await new Promise(r2 => server.listening ? r2() : server.once('listening', r2));
    console.log('SEEDOUT ' + JSON.stringify({ contacts: db.prepare('SELECT COUNT(*) n FROM contacts').get().n, products: db.prepare('SELECT COUNT(*) n FROM products').get().n }));
    server.close(() => process.exit(0));
  `], { env, encoding: 'utf8' });
  const m = String(res.stdout).match(/SEEDOUT (\{.*\})/);
  const out = m ? JSON.parse(m[1]) : null;
  ok('с доменом (прод) — base без клиентов', out && out.contacts === 0 && out.products > 0, JSON.stringify(out));
  rmSync(dir, { recursive: true, force: true });
}

// опечатка в режиме не должна молча включать демо-данные: при CRM_DOMAIN берём base
{
  const dir = mkdtempSync(join(tmpdir(), 'karkas-seed-'));
  const env = { ...process.env, DATA_DIR: dir, PORT: '0', SEED_MODE: 'производство', CRM_DOMAIN: 'crm.example.ru' };
  const res = spawnSync(process.execPath, ['--experimental-sqlite', '-e', `
    process.env.DATA_DIR=${JSON.stringify(dir)}; process.env.PORT='0';
    process.env.SEED_MODE='производство'; process.env.CRM_DOMAIN='crm.example.ru';
    const { server, db } = await import(${JSON.stringify(join(process.cwd(), 'backend/src/server.js'))});
    await new Promise(r2 => server.listening ? r2() : server.once('listening', r2));
    console.log('SEEDOUT ' + JSON.stringify({ contacts: db.prepare('SELECT COUNT(*) n FROM contacts').get().n, products: db.prepare('SELECT COUNT(*) n FROM products').get().n }));
    server.close(() => process.exit(0));
  `], { env, encoding: 'utf8' });
  const m = String(res.stdout).match(/SEEDOUT (\{.*\})/);
  const out = m ? JSON.parse(m[1]) : null;
  ok('неизвестный SEED_MODE на проде не включает демо-данные', out && out.contacts === 0 && out.products > 0, JSON.stringify(out));
  ok('о неизвестном режиме предупреждают в логе', /SEED_MODE=.*не распознан/.test(String(res.stderr || '') + String(res.stdout || '')));
  rmSync(dir, { recursive: true, force: true });
}

// ручной CLI: защита непустой базы и режим --base
{
  const dir = mkdtempSync(join(tmpdir(), 'karkas-cli-'));
  const env = { ...process.env, DATA_DIR: dir, PORT: '0', SEED_MODE: 'off' };
  await new Promise(resolve => {
    const srv = spawnSync(process.execPath, ['--experimental-sqlite', '-e', `
      process.env.DATA_DIR=${JSON.stringify(dir)}; process.env.PORT='0'; process.env.SEED_MODE='off';
      const { server } = await import(${JSON.stringify(join(process.cwd(), 'backend/src/server.js'))});
      await new Promise(r2 => server.listening ? r2() : server.once('listening', r2));
      setTimeout(() => { server.close(() => process.exit(0)); }, 300);
    `], { env, encoding: 'utf8' });
    resolve();
  });
  const run = (...args) => spawnSync(process.execPath, ['--experimental-sqlite', 'backend/src/seed-demo.js', ...args], { env, encoding: 'utf8' });
  assert.notEqual(run().status, 0, 'требуется подтверждение');
  const first = run('--confirm-test-data');
  assert.equal(first.status, 0, first.stderr);
  const db = new DatabaseSync(join(dir, 'crm.db'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM contacts').get().n, 7, 'демо: 7 клиентов');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM templates').get().n, 4, 'демо: 4 шаблона');
  assert.notEqual(run('--confirm-test-data').status, 0, 'непустая база защищена');
  db.close();
  rmSync(dir, { recursive: true, force: true });
  console.log('✅ CLI seed-demo.js: подтверждение, связанные записи, защита повторного запуска');
}

console.log(`\nИтого: ${failed === 0 ? 'все проверки пройдены ✅' : failed + ' проверок не пройдено ❌'}\n`);
process.exit(failed ? 1 : 0);
