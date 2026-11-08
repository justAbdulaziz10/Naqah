"use client";

import { CheckCircle } from "@phosphor-icons/react";
import { useEffect, useSyncExternalStore } from "react";

interface ToastItem {
  id: number;
  message: string;
}

let current: ToastItem | null = null;
let counter = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Confirms that something the owner just did took effect. One at a time; the newest replaces the last. */
export function toast(message: string) {
  current = { id: ++counter, message };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Mount once per app shell. Sits above the phone's bottom navigation. */
export function Toaster() {
  const item = useSyncExternalStore(subscribe, () => current, () => null);

  useEffect(() => {
    if (!item) return;
    const timer = setTimeout(() => {
      if (current?.id === item.id) {
        current = null;
        emit();
      }
    }, 3600);
    return () => clearTimeout(timer);
  }, [item]);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 lg:bottom-8">
      {item ? (
        <p key={item.id} className="naqah-toast inline-flex max-w-md items-center gap-2.5 rounded-full bg-espresso px-5 py-3 text-sm font-medium text-cream shadow-lift">
          <CheckCircle size={18} weight="fill" className="shrink-0 text-ok-soft" aria-hidden />
          {item.message}
        </p>
      ) : null}
    </div>
  );
}
