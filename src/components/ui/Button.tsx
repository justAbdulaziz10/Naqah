import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "gold" | "danger" | "light";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-[background,color,box-shadow,transform] duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 select-none whitespace-nowrap";

const variants: Record<Variant, string> = {
  primary: "bg-brown text-cream shadow-soft hover:bg-brown-deep",
  secondary: "bg-cream text-espresso border border-stone hover:border-sand hover:bg-white",
  ghost: "text-espresso hover:bg-espresso/5",
  gold: "bg-gold text-espresso shadow-soft hover:brightness-105",
  danger: "bg-danger text-cream hover:brightness-110",
  light: "bg-cream text-espresso hover:bg-white shadow-soft",
};

const sizes: Record<Size, string> = {
  sm: "min-h-11 px-4 text-sm",
  md: "h-11 px-5 text-[0.95rem]",
  lg: "h-13 px-7 text-base",
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
        "inline-flex size-11 items-center justify-center rounded-full text-espresso transition hover:bg-espresso/5 active:scale-95",
        className,
      )}
      {...props}
    />
  );
}
