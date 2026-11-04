import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-[var(--radius-card)] border border-stone/80 bg-cream shadow-soft", className)} {...props} />;
}

export function CardHeader({
  title,
  icon,
  action,
  subtitle,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  subtitle?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 pt-5 sm:px-6 sm:pt-6", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon ? (
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-gold-soft text-brown">{icon}</span>
        ) : null}
        <div className="min-w-0">
          <h2 className="truncate text-[1.02rem] font-bold text-espresso">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("px-5 pb-5 pt-4 sm:px-6 sm:pb-6", className)} {...props} />;
}
