/**
 * LOCAL TEST ONLY. Starts the real bridge code with shorter limits, so timeouts can be observed in a test
 * without waiting for their production values. Limits and the bridge paths come from the environment.
 */
import { pathToFileURL } from "node:url";

const { createBridge } = await import(pathToFileURL(process.env.NAQAH_TEST_BRIDGE_SERVER).href);
const { loadConfig } = await import(pathToFileURL(process.env.NAQAH_TEST_BRIDGE_CONFIG).href);
const config = loadConfig();
const bridge = createBridge({ config, limits: JSON.parse(process.env.NAQAH_TEST_BRIDGE_LIMITS ?? "{}") });
bridge.server.listen(config.port, () => console.log('{"event":"server_listening"}'));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => process.exit(0));
