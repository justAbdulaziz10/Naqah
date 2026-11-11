"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DEMO_AUTOFILL, DemoFillButton } from "@/components/demo/DemoFill";
import { Button } from "@/components/ui";
import type { SetupFieldsProps, WorkspaceUpdate } from "@/components/setup/types";
import { useI18n } from "@/i18n/client";

type Props = SetupFieldsProps & {
  sample: () => WorkspaceUpdate;
  children: (fields: SetupFieldsProps, controls: ReactNode, preview: boolean) => ReactNode;
};

export function SettingsDemoDraft({ ws, onChange, sample, children }: Props) {
  const { m } = useI18n();
  const [edits, setEdits] = useState<WorkspaceUpdate[] | null>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const preview = edits !== null;
  useEffect(() => {
    if (preview) saveRef.current?.focus();
  }, [preview]);
  if (!DEMO_AUTOFILL) return children({ ws, onChange }, null, false);
  const draft = edits?.reduce((current, edit) => edit(current), ws) ?? ws;
  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <DemoFillButton onFill={() => {
        setEdits([sample()]);
        if (preview) saveRef.current?.focus();
      }} />
      {edits ? <>
        <span role="status" className="text-sm text-muted">{m.common.actions.notSaved}</span>
        <Button ref={saveRef} onClick={() => {
          onChange((current) => edits.reduce((latest, edit) => edit(latest), current));
          setEdits(null);
        }}>{m.common.actions.save}</Button>
        <Button variant="ghost" onClick={() => setEdits(null)}>{m.common.actions.cancel}</Button>
      </> : null}
    </div>
  );
  return children({
    ws: draft,
    onChange: (update) => {
      if (edits) setEdits((current) => [...(current ?? []), update]);
      else onChange(update);
    },
  }, controls, preview);
}
