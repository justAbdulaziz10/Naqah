import { Suspense, type ComponentProps } from "react";
import { requestIdentity } from "@/components/auth/AuthNavigation";
import { EntryActionsClient } from "./EntryActions";

type Props = Omit<ComponentProps<typeof EntryActionsClient>, "initialIdentity">;

async function ValidatedEntryActions(props: Props) {
  return <EntryActionsClient {...props} initialIdentity={await requestIdentity()} />;
}

/** Request-only identity, like the navigation: never cache one owner's action in another's page. */
export function EntryActions(props: Props) {
  return (
    <Suspense fallback={<EntryActionsClient {...props} initialIdentity={{ status: "unknown" }} />}>
      <ValidatedEntryActions {...props} />
    </Suspense>
  );
}
