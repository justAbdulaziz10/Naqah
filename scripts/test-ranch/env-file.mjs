// LOCAL OPERATOR TOOLING. Parses a small dotenv-style file without expanding shell variables.
import { readFileSync } from "node:fs";

export function parseEnvFile(source) {
  const values = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) throw new Error("Invalid env file");
    let value = match[2].trim();
    if (value.startsWith("\"") || value.startsWith("'")) {
      const quote = value[0];
      let close = -1;
      for (let index = 1; index < value.length; index += 1) {
        if (quote === '"' && value[index] === "\\") { index += 1; continue; }
        if (value[index] === quote) { close = index; break; }
      }
      if (close < 1 || !/^\s*(?:#.*)?$/.test(value.slice(close + 1))) throw new Error("Invalid env file");
      value = value.slice(1, close);
      if (quote === '"') value = value.replace(/\\([\\"nrt])/g, (_all, escape) => ({ "\\": "\\", '"': '"', n: "\n", r: "\r", t: "\t" })[escape]);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[match[1]] = value;
  }
  return values;
}

export function readEnvFile(path) {
  return parseEnvFile(readFileSync(path, "utf8"));
}

export function envFromArgs(argv, processEnv = process.env) {
  const fileFlag = argv.indexOf("--env-file");
  const positional = argv.find((part) => !part.startsWith("--"));
  const path = fileFlag >= 0 ? argv[fileFlag + 1] : positional;
  return { ...processEnv, ...(path ? readEnvFile(path) : {}) };
}
