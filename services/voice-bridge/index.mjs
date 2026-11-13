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

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    const timeout = setTimeout(() => process.exit(1), 1000);
    timeout.unref();
    void bridge?.close().then(() => clearTimeout(timeout)).catch(() => {
      process.exitCode = 1;
    });
  });
}
