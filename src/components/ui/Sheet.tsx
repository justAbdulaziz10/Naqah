"use client";

import { X } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A panel for details one step away from a list: it rises from the bottom on phones (within thumb
 * reach) and slides in from the end edge on wider screens. Mount it only while open. Built on a
 * modal <dialog>, so focus stays inside, Escape closes it, and focus returns to what opened it.
 * Elevated on purpose: a sheet sits above the page, unlike the flat cards beneath it.
 */
export function Sheet({
  title,
  description,
  closeLabel,
  onClose,
  footer,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  /** Actions pinned to the bottom of the panel. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [closing, setClosing] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      // The sheet unmounts rather than closing, so hand focus back to whatever opened it.
      requestAnimationFrame(() => opener?.isConnected && opener.focus({ preventScroll: true }));
    };
  }, []);

  // The panel leaves the way it came, then the parent unmounts it. Reduced motion closes at once.
  function requestClose() {
    if (closing) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return onClose();
    setClosing(true);
    setTimeout(onClose, 230);
  }

  return (
    <dialog
      ref={dialogRef}
      data-state={closing ? "closing" : "open"}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      className="naqah-sheet fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-transparent p-0 text-espresso backdrop:bg-transparent"
    >
      <div aria-hidden className="naqah-sheet-backdrop absolute inset-0 bg-espresso/45" onClick={requestClose} />
      <div
        className={cn(
          "naqah-sheet-panel absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-[1.5rem] bg-cream shadow-lift",
          "md:inset-y-0 md:end-0 md:start-auto md:max-h-none md:w-[min(30rem,92vw)] md:rounded-none md:rounded-s-[1.5rem]",
          className,
        )}
      >
        <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-stone md:hidden" />
        <header className="flex shrink-0 items-start justify-between gap-4 px-5 pb-4 pt-4 sm:px-7 md:pt-7">
          <div className="min-w-0">
            <h2 id={titleId} className="text-2xl font-semibold leading-tight tracking-[-0.01em]">{title}</h2>
            {description ? <div id={descriptionId} className="mt-1 text-sm leading-relaxed text-muted">{description}</div> : null}
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label={closeLabel}
            className="naqah-press -me-2 -mt-1 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors duration-[var(--duration-micro)] hover:bg-espresso/5 hover:text-espresso"
          >
            <X size={20} aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 sm:px-7">{children}</div>
        {footer ? <div className="shrink-0 border-t border-stone/70 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-7">{footer}</div> : null}
      </div>
    </dialog>
  );
}
