"use client";

import { Translate } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { otherLocale, searchForLocale } from "@/i18n/config";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";

const subscribeNever = () => () => {};

/** Links to the same page, query included, in the other language and remembers the choice. */
export function LocaleSwitcher({ className, tone = "dark" }: { className?: string; tone?: "dark" | "light" }) {
  const { locale, m } = useI18n();
  const pathname = usePathname() ?? `/${locale}`;
  const target = otherLocale(locale);
  // Read after hydration: useSearchParams would opt static pages out of prerendering.
  const search = useSyncExternalStore(subscribeNever, () => window.location.search, () => "");
  const href = pathname.replace(new RegExp(`^/${locale}(?=/|$)`), `/${target}`) + searchForLocale(search, locale, target);
  return (
    <Link
      href={href}
      lang={target}
      aria-label={m.common.switchLanguageLabel}
      onClick={() => {
        document.cookie = `naqah-locale=${target}; path=/; max-age=31536000; samesite=lax`;
      }}
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-full px-3.5 text-sm font-semibold transition",
        tone === "dark" ? "text-espresso hover:bg-espresso/5" : "text-cream hover:bg-cream/10",
        className,
      )}
    >
      <Translate size={18} weight="regular" aria-hidden />
      <span className={target === "ar" ? "font-arabic" : undefined}>{m.common.switchLanguage}</span>
    </Link>
  );
}
