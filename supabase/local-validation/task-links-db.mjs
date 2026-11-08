// LOCAL ONLY. Real PostgreSQL, with a SQL-backed Supabase fetch transport (not hosted Auth/PostgREST).
import { execFile, execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
export const q = (value) => `'${String(value).replaceAll("'", "''")}'`;
export function args() {
  const db = process.env.NAQAH_TEST_DB ?? '';
  if (!/^naqah_task_links_[a-zA-Z0-9_]+$/.test(db)) throw new Error('Only named disposable task-link databases are allowed');
  for (const host of [process.env.PGHOST ?? '127.0.0.1', process.env.PGHOSTADDR ?? '']) {
    if (!['', '127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Local PostgreSQL only');
  }
  return ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-d', db];
}
export function sql(query) {
  return execFileSync('psql', args(), { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
export async function sqlAsync(query) {
  // execFile has no stdin option: explicitly write the local SQL and capture errors privately.
  return new Promise((resolve, reject) => {
    const child = execFile('psql', args(), { encoding: 'utf8', maxBuffer: 8_000_000 }, (error, stdout, stderr) => {
      if (error) { error.stderr = stderr; reject(error); } else resolve(stdout.trim());
    });
    child.stdin.end(query);
  });
}
export const json = (query) => JSON.parse(sql(query) || 'null');
export function assertLocal() {
  const address = sql('select host(inet_server_addr())');
  if (!['127.0.0.1', '::1'].includes(address)) throw new Error('Refusing non-loopback database');
  if (sql("select shobj_description(oid, 'pg_database') from pg_database where datname=current_database()") !== 'NAQAH disposable worker-call-link validation') {
    throw new Error('Disposable database marker missing');
  }
}
const tables = new Set(['farms', 'workers', 'camels', 'resources', 'custom_questions', 'criteria', 'emergency_categories',
  'reports', 'calls', 'task_tickets', 'no_answer_tickets', 'pending_worker_calls', 'report_call_runs', 'relays', 'events', 'voice_events']);
const identifier = (name) => { if (!/^[a-z_]+$/.test(name)) throw new Error('Unsafe SQL identifier'); return `"${name}"`; };
export function sqlClient() {
  return createClient('http://127.0.0.1:1', 'local-test-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init = {}) => {
      const url = new URL(String(input));
      const name = url.pathname.split('/').at(-1);
      try {
        let result;
        if (name === 'apply_farm_changes' && init.method === 'POST') {
          const body = JSON.parse(init.body);
          result = await sqlAsync(`set role service_role; select public.apply_farm_changes(${q(body.p_farm_id)}, ${Number(body.p_expected_revision)}, ${q(JSON.stringify(body.p_changes))}::jsonb, ${body.p_event_id == null ? 'null' : q(body.p_event_id)}, ${q(JSON.stringify(body.p_outcome))}::jsonb);`);
        } else {
          if (!tables.has(name) || (init.method && init.method !== 'GET')) throw new Error('Unsupported local transport operation');
          const filters = [];
          for (const [key, value] of url.searchParams) {
            if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
            const column = identifier(key);
            if (value.startsWith('eq.')) filters.push(`${column} = ${q(value.slice(3))}`);
            else if (value.startsWith('in.(') && value.endsWith(')')) filters.push(`${column} in (${value.slice(4, -1).split(',').map(q).join(',')})`);
            else throw new Error('Unsupported local filter');
          }
          const ordering = url.searchParams.get('order')?.split(',').map((part) => {
            const [key, direction] = part.split('.'); return `${identifier(key)} ${direction === 'desc' ? 'desc' : 'asc'}`;
          }).join(',');
          const limit = Number(url.searchParams.get('limit') ?? 10000), offset = Number(url.searchParams.get('offset') ?? 0);
          if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(offset) || limit < 0 || offset < 0) throw new Error('Unsafe paging');
          let value = 'to_jsonb(r)';
          if (name === 'pending_worker_calls') value += ` || jsonb_build_object('worker_call_attempts', (select coalesce(jsonb_agg(a), '[]') from worker_call_attempts a where a.pending_call_id=r.id), 'pending_worker_call_tasks', (select coalesce(jsonb_agg(l), '[]') from pending_worker_call_tasks l where l.pending_call_id=r.id and l.farm_id=r.farm_id))`;
          if (name === 'reports') value += ` || jsonb_build_object('report_answers', (select coalesce(jsonb_agg(a), '[]') from report_answers a where a.report_id=r.id), 'findings', (select coalesce(jsonb_agg(f), '[]') from findings f where f.report_id=r.id))`;
          result = await sqlAsync(`set role service_role; select coalesce(jsonb_agg(${value}), '[]') from (select * from public.${identifier(name)} ${filters.length ? 'where ' + filters.join(' and ') : ''} ${ordering ? 'order by ' + ordering : ''} limit ${limit} offset ${offset}) r;`);
        }
        return new Response(result || 'null', { status: 200, headers: { 'Content-Type': 'application/json' } });
      } catch (error) {
        const code = error.stderr?.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] ?? 'XX000';
        return new Response(JSON.stringify({ code, message: 'Local PostgreSQL rejected the operation' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
    } },
  });
}
