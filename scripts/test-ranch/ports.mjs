// LOCAL TEST SUPPORT. Reserves only loopback ports in the operator rehearsal range.
import { createServer } from "node:net";

export async function reserveLoopbackPorts(count, { start = 55500, end = 55599 } = {}) {
  const reservations = [];
  for (let port = start; port <= end && reservations.length < count; port += 1) {
    const server = createServer();
    const available = await new Promise((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => resolve(true));
    });
    if (available) reservations.push({ port, server });
  }
  if (reservations.length !== count) {
    await Promise.all(reservations.map(({ server }) => new Promise((resolve) => server.close(resolve))));
    throw new Error("Insufficient loopback ports in 55500–55599");
  }
  let closed = false;
  return {
    ports: reservations.map(({ port }) => port),
    async close() {
      if (closed) return;
      closed = true;
      await Promise.all(reservations.map(({ server }) => new Promise((resolve) => server.close(() => resolve()))));
    },
  };
}
