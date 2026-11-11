import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { AuthFrame, AuthHeading } from "@/components/auth/AuthFrame";
import { InitialPlanSelection } from "@/components/setup/onboarding/InitialPlanSelection";
import { ButtonLink } from "@/components/ui";
import type { Locale } from "@/domain/types";
import { isLocale } from "@/i18n/config";
import { getMessages } from "@/i18n/messages";
import { planSelectionResumePath } from "@/lib/account/plan-selection-paths";
import { safeReturnPath } from "@/lib/supabase/auth-input";
import { initialPlanState } from "@/server/farm/actions";
import { ACCOUNT_DATA } from "@/components/entry/paths";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string | string[] }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const messages = getMessages(isLocale(locale) ? locale : "ar");
  return { title: messages.onboarding.plans.title, robots: { index: false } };
}

export default function ChoosePlanPage(props: Props) {
  return <Suspense fallback={null}><ChoosePlanContent {...props} /></Suspense>;
}

async function ChoosePlanContent({ params, searchParams }: Props) {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) notFound();
  const locale: Locale = rawLocale;
  const m = getMessages(locale);
  if (!ACCOUNT_DATA) redirect(`/${locale}/start`);

  const query = await searchParams;
  const rawNext = Array.isArray(query.next) ? query.next.length === 1 ? query.next[0] : null : query.next;
  const next = safeReturnPath(rawNext);
  const result = await initialPlanState();
  if (!result.ok) {
    if (result.error === "unauthenticated") {
      const chooser = `/${locale}/choose-plan${next ? `?next=${encodeURIComponent(next)}` : ""}`;
      redirect(`/${locale}/login?next=${encodeURIComponent(chooser)}`);
    }
    return (
      <AuthFrame demoLink={false}>
        <AuthHeading title={m.onboarding.plans.title} lead={m.auth.unavailable} />
        <p role="alert" className="mt-5 leading-relaxed text-danger">{m.account.loadFailed}</p>
        <ButtonLink size="lg" href={`/${locale}/choose-plan${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="mt-6 w-full shadow-none!">{m.setup.plans.initial.retry}</ButtonLink>
      </AuthFrame>
    );
  }

  const { ownerId, state } = result.data;
  if (!state.required) redirect(planSelectionResumePath(locale, state.setupComplete, next));
  return <InitialPlanSelection ownerId={ownerId} existingFarm={state.existingFarm} next={next} />;
}
