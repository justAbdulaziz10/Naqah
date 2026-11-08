import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
const root = fileURLToPath(new URL('../../', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '');
const taskC = process.env.NAQAH_TASK_C_ROOT?.replaceAll('\\', '/').replace(/\/$/, '');
const expected = 'a5817455f913fbb64bde1d80825a47ca29f49526';
const aliases = [];
if (taskC) {
  if (execFileSync('git', ['-C', taskC, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== expected ||
      execFileSync('git', ['-C', taskC, 'status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Expected clean pinned Task C checkout');
  aliases.push({ find: '@task-c/contract', replacement: taskC + '/src/server/voice/contract.ts' });
  aliases.push({ find: '@task-c/actions', replacement: taskC + '/src/domain/actions.ts' });
  aliases.push({ find: /^@\/domain(?=\/|$)/, replacement: taskC + '/src/domain' });
}
aliases.push({ find: '@', replacement: root + '/src' });
export default defineConfig({
  root, resolve: { alias: aliases },
  test: { include: [taskC ? 'supabase/local-validation/task-links-c.pg.test.mjs' : 'supabase/local-validation/task-links.pg.test.mjs'], testTimeout: 60000, hookTimeout: 60000, fileParallelism: false },
});
