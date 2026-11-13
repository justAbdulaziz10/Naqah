import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Premium v2 controls. Primary = brown fill, secondary = hairline outline, tertiary = text link.
 * Every size is at least 44px tall; the press gives a little under the finger (`naqah-press`),
 * focus is the shared brown ring, and a disabled control looks disabled without fading its label
 * below contrast. "ghost", "gold", "danger" and "light" stay for existing callers.
 */
type Variant = "primary" | "secondary" | "tertiary" | "ghost" | "gold" | "danger" | "light";
type Size = "sm" | "md" | "lg";

const base =
  "naqah-press inline-flex items-center justify-center gap-2 rounded-full font-semibold select-none whitespace-nowrap transition-[background-color,color,border-color,box-shadow] duration-[var(--duration-micro)] ease-[var(--ease-standard)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown disabled:pointer-events-none disabled:cursor-not-allowed";

const variants: Record<Variant, string> = {
  primary: "bg-brown text-cream hover:bg-brown-deep disabled:bg-stone disabled:text-muted",
  secondary: "border border-stone bg-cream text-espresso hover:border-brown/60 hover:bg-cream disabled:border-stone/70 disabled:text-muted",
  tertiary: "naqah-link rounded-md px-1! text-brown hover:text-brown-deep disabled:text-muted disabled:no-underline",
  ghost: "text-espresso hover:bg-espresso/5 disabled:text-muted",
  gold: "bg-gold text-espresso shadow-soft hover:brightness-105 disabled:bg-stone disabled:text-muted",
  danger: "bg-danger text-cream hover:brightness-110 disabled:bg-stone disabled:text-muted",
  light: "bg-cream text-espresso shadow-soft hover:bg-cream disabled:text-muted",
};

const sizes: Record<Size, string> = {
  sm: "min-h-11 px-4 text-sm",
  md: "min-h-11 px-5 text-[0.95rem]",
  lg: "min-h-13 px-7 text-base",
};

export interface ButtonStyleProps {
  variant?: Variant;
  size?: Size;
  className?: string;
}

export const buttonClass = ({ variant = "primary", size = "md", className }: ButtonStyleProps) =>
  cn(base, variants[variant], sizes[size], className);

export function Button({ variant, size, className, ...props }: ButtonStyleProps & ComponentProps<"button">) {
  return <button type="button" className={buttonClass({ variant, size, className })} {...props} />;
}

export function ButtonLink({
  variant,
  size,
  className,
  href,
  children,
  ...props
}: ButtonStyleProps & { href: string; children: ReactNode } & Omit<ComponentProps<typeof Link>, "href">) {
  return (
    <Link href={href} className={buttonClass({ variant, size, className })} {...props}>
      {children}
    </Link>
  );
}

export function IconButton({ className, label, ...props }: ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "naqah-press inline-flex size-11 items-center justify-center rounded-full text-espresso transition-colors duration-[var(--duration-micro)] hover:bg-espresso/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown disabled:pointer-events-none disabled:text-muted",
        className,
      )}
      {...props}
    />
  );
}
