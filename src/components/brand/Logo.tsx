import Link from "next/link";
import type { Locale } from "@/domain/types";
import { cn } from "@/lib/cn";
import { CamelMark } from "./CamelMark";

/** Camel mark + bilingual name set in type (the name is never merged into the mark). */
export function Logo({ locale, className, tone = "dark", href }: { locale: Locale; className?: string; tone?: "dark" | "light"; href?: string }) {
  const content = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {/* data-brand-mark: where the landing's woven intro lands the mark. The mark itself is unchanged. */}
      <span data-brand-mark className="inline-flex shrink-0">
        <CamelMark className="h-7 w-auto" />
      </span>
      <span className={cn("text-[1.05rem] font-bold tracking-[0.08em]", tone === "dark" ? "text-espresso" : "text-cream")}>
        {locale === "ar" ? <span className="font-arabic tracking-normal text-[1.2rem]">ناقة</span> : "NAQAH"}
      </span>
    </span>
  );
  return href ? (
    <Link href={href} aria-label={locale === "ar" ? "ناقة — الرئيسية" : "NAQAH — home"} className="relative inline-flex w-fit rounded-lg after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']">
      {content}
    </Link>
  ) : (
    content
  );
}
