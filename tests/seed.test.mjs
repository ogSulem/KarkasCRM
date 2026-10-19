import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
const dir = mkdtempSync(join(tmpdir(), 'karkas-seed-'));
process.env.DATA_DIR = dir;
process.env.PORT = '0';
const { server } = await import('../backend/src/server.js');
await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
await new Promise(resolve => server.close(resolve));
const run = (...args) => spawnSync(process.execPath, ['--experimental-sqlite', 'backend/src/seed-demo.js', ...args], { env: process.env, encoding: 'utf8' });
const db = new DatabaseSync(join(dir, 'crm.db'));
try {
  assert.notEqual(run().status, 0, 'требуется подтверждение');
  const first = run('--confirm-test-data'); assert.equal(first.status, 0, first.stderr);
  for (const table of ['contacts', 'deals', 'tasks']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 5);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM templates').get().n, 1);
  assert.notEqual(run('--confirm-test-data').status, 0, 'непустая база защищена');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM contacts').get().n, 5);
  console.log('✅ Тестовый seed: подтверждение, связанные записи, защита повторного запуска');
} finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
