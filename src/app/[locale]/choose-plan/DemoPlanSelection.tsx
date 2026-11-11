"use client";

import { useRef, type ReactNode } from "react";
import { DEMO_AUTOFILL, DemoFillButton } from "@/components/demo/DemoFill";
import { AuthHeadingAction } from "@/components/auth/AuthFrame";

export function DemoPlanSelection({ children }: { children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  if (!DEMO_AUTOFILL) return children;
  return (
    <AuthHeadingAction value={
        <DemoFillButton onFill={() => {
          container.current?.querySelector<HTMLInputElement>('input[name="plan"][value="ultimate"]')?.click();
          requestAnimationFrame(() => container.current?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus());
        }} />
    }>
      <div ref={container}>{children}</div>
    </AuthHeadingAction>
  );
}
