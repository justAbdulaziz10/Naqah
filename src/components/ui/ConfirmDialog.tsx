"use client";

import { useEffect, useId, useRef } from "react";
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
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** "danger" for replacing or deleting; "primary" for a deliberate action like placing a call. */
  tone?: "danger" | "primary";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
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
      className="m-auto w-[calc(100vw-2rem)] max-w-md rounded-2xl border border-stone bg-cream p-5 text-espresso shadow-lift backdrop:bg-espresso/40 sm:p-6"
    >
      <h2 id={titleId} className="text-lg font-bold">{title}</h2>
      <p id={bodyId} className="mt-2 leading-relaxed text-muted">{body}</p>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {/* showModal() focuses the first control, so the safe choice comes first. */}
        <Button variant="secondary" className="max-sm:w-full" onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={tone} className="max-sm:w-full" onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </dialog>
  );
}
