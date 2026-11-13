import { setDefaultResultOrder } from 'node:dns';
import { loadConfig } from './config.mjs';
import { createBridge } from './server.mjs';

let bridge;
try {
  const config = loadConfig();
  // Before any connection: OpenAI, the upstream and the closed notice all resolve through dns.lookup.
  setDefaultResultOrder(config.dnsOrder);
  bridge = createBridge({ config });
  bridge.server.on('error', () => {
    console.error('{"event":"server_failed"}');
    process.exitCode = 1;
  });
  bridge.server.listen(config.port, () => console.log(JSON.stringify({ event: 'server_listening', dnsOrder: config.dnsOrder })));
} catch {
  console.error('{"event":"configuration_invalid"}');
  process.exitCode = 1;
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => {
      console.error('{"event":"shutdown_timeout"}');
      process.exit(1);
    }, 12_000);
    timeout.unref();
    void Promise.resolve(bridge?.close()).catch(() => {
      process.exitCode = 1;
    }).finally(() => clearTimeout(timeout));
  });
}
