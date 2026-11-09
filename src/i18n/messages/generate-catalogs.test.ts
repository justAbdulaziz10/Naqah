import { expect, it } from "vitest";
import { createLocaleCatalog, extractLocaleObject } from "./generate-catalogs.mjs";

it("extracts one locale while retaining its interpolation functions", () => {
  const source = `export const sample = defineMessages({
    en: { title: "English title", greet: (name: string) => \`Hello \${name}\` },
    ar: { title: "عنوان عربي", greet: (name: string) => \`أهلًا \${name}\` },
  });`;

  const arabic = extractLocaleObject(source, "sample.ts", "sample", "ar");
  expect(arabic).toContain("عنوان عربي");
  expect(arabic).toContain("أهلًا");
  expect(arabic).not.toContain("English title");
  expect(arabic).not.toContain("Hello");
});

it("generates client catalogs that contain only their selected locale", () => {
  const arabic = createLocaleCatalog("ar");
  const english = createLocaleCatalog("en");

  expect(arabic).toContain("استكشف العرض التجريبي");
  expect(arabic).not.toContain("Explore the demo");
  expect(english).toContain("Explore the demo");
  expect(english).not.toContain("استكشف العرض التجريبي");
});
