import Link from "next/link";
import type { Locale } from "@/domain/types";
import { cn } from "@/lib/cn";
import { CamelMark } from "./CamelMark";

/** Camel mark + bilingual name set in type (the name is never merged into the mark). */
export function Logo({ locale, className, tone = "dark", href }: { locale: Locale; className?: string; tone?: "dark" | "light"; href?: string }) {
  const content = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <CamelMark className="h-7 w-auto shrink-0" />
      <span className={cn("text-[1.05rem] font-bold tracking-[0.08em]", tone === "dark" ? "text-espresso" : "text-cream")}>
        {locale === "ar" ? <span className="font-arabic tracking-normal text-[1.2rem]">ناقة</span> : "NAQAH"}
      </span>
    </span>
  );
  return href ? (
    <Link href={href} aria-label={locale === "ar" ? "ناقة — الرئيسية" : "NAQAH — home"} className="rounded-lg">
      {content}
    </Link>
  ) : (
    content
  );
}
