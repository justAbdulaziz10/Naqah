try {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3300}/voice-bridge/health`, {
    signal: AbortSignal.timeout(4000), redirect: 'error',
  });
  if (!response.ok || (await response.json()).ok !== true) process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
