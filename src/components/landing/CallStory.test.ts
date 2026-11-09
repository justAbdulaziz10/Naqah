import { readFileSync } from "node:fs";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Locale } from "@/domain/types";
import { I18nProvider } from "@/i18n/client";
import { CallStory } from "./CallStory";

const ElementI18nProvider = I18nProvider as unknown as ComponentType<{
  locale: Locale;
  children?: ReactNode;
}>;

describe("landing call story server render", () => {
  it("ships the first call visual and stage image in visible markup", () => {
    const markup = renderToStaticMarkup(
      createElement(ElementI18nProvider, { locale: "en" }, createElement(CallStory)),
    );

    expect(markup).toContain("Calling Ahmed");
    expect(markup).toContain("NAQAH calls Ahmed");
    expect(markup).toContain("evening.jpg");
    expect(markup).toContain("transform:scaleX(0)");
  });

  it("keeps sequence and saved-mark motion from hiding their content", () => {
    const css = readFileSync(new URL("./landing.css", import.meta.url), "utf8");
    const sequenceKeyframes = css.match(/@keyframes naqah-seq\s*\{\s*from\s*\{([^}]*)\}/)?.[1] ?? "";
    const stampKeyframes = css.match(/@keyframes naqah-stamp\s*\{\s*from\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(sequenceKeyframes).toMatch(/translate:/);
    expect(stampKeyframes).toMatch(/scale:/);
    expect(sequenceKeyframes).not.toMatch(/opacity\s*:\s*0/);
    expect(stampKeyframes).not.toMatch(/opacity\s*:\s*0/);
    expect(css).toMatch(/\.naqah-progress\s*\{[^}]*transition:\s*transform/);
    expect(css).toMatch(/\[dir="rtl"\] \.naqah-progress\s*\{\s*transform-origin:\s*right center;/);
    expect(css).not.toMatch(/cubic-bezier\(0\.34, 1\.56, 0\.64, 1\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition: none;/);
  });
});
