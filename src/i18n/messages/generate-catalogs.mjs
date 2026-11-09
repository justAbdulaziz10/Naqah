import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUTPUT_DIR = resolve(REPO_ROOT, "src/i18n/messages/.generated");

export const MESSAGE_MODULES = [
  { key: "common", file: "common.ts", exportName: "common" },
  { key: "landing", file: "landing.ts", exportName: "landing" },
  { key: "onboarding", file: "onboarding.ts", exportName: "onboarding" },
  { key: "setup", file: "setup.ts", exportName: "setup" },
  { key: "app", file: "app.ts", exportName: "app" },
  { key: "lab", file: "lab.ts", exportName: "lab" },
  { key: "auth", file: "auth.ts", exportName: "auth" },
  { key: "account", file: "account.ts", exportName: "account" },
  { key: "visual", file: "visual.ts", exportName: "visual" },
  { key: "voiceLab", file: "voiceLab.ts", exportName: "voiceLab" },
  { key: "integrations.section", file: "integrations/section.ts", exportName: "section" },
  { key: "integrations.pwa", file: "integrations/pwa.ts", exportName: "pwa" },
  { key: "integrations.calendar", file: "integrations/calendar.ts", exportName: "calendar" },
  { key: "integrations.whatsapp", file: "integrations/whatsapp.ts", exportName: "whatsapp" },
  { key: "integrations.weather", file: "integrations/weather.ts", exportName: "weather" },
  { key: "integrations.phone", file: "integrations/phone.ts", exportName: "phone" },
];

function propertyName(property) {
  if (!property.name) return undefined;
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) return property.name.text;
  return undefined;
}

export function extractLocaleObject(source, sourceName, exportName, locale) {
  const sourceFile = ts.createSourceFile(sourceName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== exportName) continue;
      if (!declaration.initializer || !ts.isCallExpression(declaration.initializer)) continue;
      const [definitions] = declaration.initializer.arguments;
      if (!definitions || !ts.isObjectLiteralExpression(definitions)) continue;
      const localized = definitions.properties.find(
        (property) => ts.isPropertyAssignment(property) && propertyName(property) === locale,
      );
      if (localized && ts.isPropertyAssignment(localized) && ts.isObjectLiteralExpression(localized.initializer)) {
        return localized.initializer.getText(sourceFile);
      }
    }
  }
  throw new Error(`Could not find ${exportName}.${locale} in ${sourceName}`);
}

export function renderLocaleCatalog(entries) {
  const rootEntries = entries.filter((entry) => !entry.key.includes("."));
  const integrationEntries = entries.filter((entry) => entry.key.startsWith("integrations."));
  const source = `import type { Messages } from "../index";\n\nexport const messages: Messages = {\n${rootEntries
    .map((entry) => `  ${entry.key}: ${entry.object},`)
    .join("\n")}\n  integrations: {\n${integrationEntries
    .map((entry) => `    ${entry.key.slice("integrations.".length)}: ${entry.object},`)
    .join("\n")}\n  },\n};\n`;
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, removeComments: true },
    fileName: "catalog.ts",
    reportDiagnostics: true,
  });
  const errors = result.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
  if (errors.length) {
    throw new Error(ts.formatDiagnostics(errors, {
      getCurrentDirectory: () => REPO_ROOT,
      getCanonicalFileName: (fileName) => fileName,
      getNewLine: () => "\n",
    }));
  }
  return result.outputText;
}

export function createLocaleCatalog(locale, readSource = (file) => readFileSync(resolve(REPO_ROOT, "src/i18n/messages", file), "utf8")) {
  const entries = MESSAGE_MODULES.map(({ key, file, exportName }) => ({
    key,
    object: extractLocaleObject(readSource(file), file, exportName, locale),
  }));
  return renderLocaleCatalog(entries);
}

export function generateCatalogs() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const locale of ["ar", "en"]) {
    writeFileSync(resolve(OUTPUT_DIR, `${locale}.mjs`), createLocaleCatalog(locale));
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  generateCatalogs();
}
