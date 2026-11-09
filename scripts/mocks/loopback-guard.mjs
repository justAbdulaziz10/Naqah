/**
 * LOCAL TEST ONLY. Preloaded into the bridge (node --import) so that no socket can leave the machine,
 * whatever URL the bridge is configured with. Attempts are written to stderr as `[guard] blocked <host>`.
 */
import net from "node:net";

const loopback = /^(localhost|127\.\d+\.\d+\.\d+|::1|::ffff:127\.0\.0\.1)$/;
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = typeof first === "object" && first !== null ? first : { host: args[1] };
  const host = options.host ?? (options.path ? "localhost" : "localhost");
  if (!options.path && !loopback.test(String(host))) {
    process.stderr.write(`[guard] blocked ${host}\n`);
    process.nextTick(() => this.destroy(new Error(`Blocked non-loopback connection to ${host}`)));
    return this;
  }
  return connect.apply(this, args);
};
