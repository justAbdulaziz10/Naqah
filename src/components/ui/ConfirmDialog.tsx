"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";

/** Mount it only while asking. Focus starts on the safe choice, and Escape counts as cancelling. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  tone = "danger",
  extra,
  children,
  confirmDisabled = false,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** "danger" for replacing or deleting; "primary" for a deliberate action like placing a call. */
  tone?: "danger" | "primary";
  /** A third way out that gives something up, like leaving without saving. Always last. */
  extra?: { label: string; onClick: () => void };
  /** Anything the person must see or answer before confirming. */
  children?: ReactNode;
  confirmDisabled?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="naqah-dialog m-auto w-[calc(100vw-2rem)] max-w-md rounded-[var(--radius-sheet)] bg-cream p-5 text-espresso shadow-lift backdrop:bg-espresso/45 sm:p-6"
    >
      <h2 id={titleId} className="naqah-heading text-xl">{title}</h2>
      <p id={bodyId} className="naqah-body mt-2 text-muted">{body}</p>
      {children}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {/* showModal() focuses the first control, so the safe choice comes first. */}
        <Button variant="secondary" className="max-sm:w-full" onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={tone} className="max-sm:w-full" disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</Button>
        {extra ? <Button variant="ghost" className="text-danger! max-sm:w-full" onClick={extra.onClick}>{extra.label}</Button> : null}
      </div>
    </dialog>
  );
}
