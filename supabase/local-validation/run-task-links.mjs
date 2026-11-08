// LOCAL ONLY. A named, marked disposable database; never bootstrap a hosted Supabase project.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const db = process.env.NAQAH_TEST_DB ?? '';
if (!/^naqah_task_links_[a-zA-Z0-9_]+$/.test(db)) throw new Error('Set a disposable NAQAH_TEST_DB beginning naqah_task_links_');
for (const host of [process.env.PGHOST ?? '127.0.0.1', process.env.PGHOSTADDR ?? '']) {
  if (!['', 'localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('Refusing non-loopback PostgreSQL host');
}
process.env.PGHOST ??= '127.0.0.1';
const quote = (s) => `'${s.replaceAll("'", "''")}'`;
const args = ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'];
function sql(database, statement) { return execFileSync('psql', [...args, '-d', database], { input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim(); }
if (!['127.0.0.1', '::1'].includes(sql('postgres', 'select host(inet_server_addr())'))) throw new Error('Server is not loopback');
const existing = sql('postgres', `select coalesce(shobj_description(oid,'pg_database'),'') from pg_database where datname=${quote(db)}`);
if (sql('postgres', `select count(*) from pg_database where datname=${quote(db)}`) !== '0') {
  if (!process.argv.includes('--fresh') || existing !== 'NAQAH disposable worker-call-link validation') throw new Error('Preserving existing database; --fresh and its disposable marker required');
  sql('postgres', `drop database "${db}"`);
}
sql('postgres', `create database "${db}"`);
sql('postgres', `comment on database "${db}" is 'NAQAH disposable worker-call-link validation'`);
const file = (name) => execFileSync('psql', [...args, '-d', db, '-1', '-f', fileURLToPath(new URL(name, import.meta.url))], { stdio: ['ignore', 'pipe', 'pipe'] });
file('bootstrap.sql');
const migrations = readdirSync(new URL('../migrations/', import.meta.url)).filter((n) => n.endsWith('.sql')).sort();
for (const migration of migrations) {
  if (migration.startsWith('20261108000000_')) {
    sql(db, `insert into auth.users values ('99999999-9999-4999-8999-999999999999');
      insert into farms(id,owner_id,plan) values ('99999999-9999-4999-8999-999999999999','99999999-9999-4999-8999-999999999999','ultimate');
      insert into task_tickets(id,farm_id,instruction) values ('99999999-9999-4999-8999-999999999999','99999999-9999-4999-8999-999999999999','LOCAL TEST pre-migration legacy');
      insert into pending_worker_calls(id,farm_id,purpose,message,task_ticket_id) values ('99999999-9999-4999-8999-999999999999','99999999-9999-4999-8999-999999999999','instruction','LOCAL TEST pre-migration legacy','99999999-9999-4999-8999-999999999999');`);
  }
  file('../migrations/' + migration);
}
console.log(`Disposable loopback database ${db}: bootstrap and ${migrations.length} migrations applied; legacy fixture preserved.`);
// Spawn Vitest's installed CLI directly so this works on Windows and Unix without a shell.
const vitest = fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs', import.meta.url));
execFileSync(process.execPath, [vitest, 'run', '--config', 'supabase/local-validation/task-links.config.mjs'], { cwd: root, stdio: 'inherit', env: process.env });
