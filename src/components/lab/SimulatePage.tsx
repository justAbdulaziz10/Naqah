"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useI18n } from "@/i18n/client";
import { useIsAccount } from "@/store/workspace";
import { OwnerSimulation } from "./OwnerSimulation";

/** Signed-in owners practise on a copy of their ranch; the demo already simulates everything in the Call Lab. */
export function SimulatePage() {
  const account = useIsAccount();
  const router = useRouter();
  const { href } = useI18n();
  useEffect(() => {
    if (!account) router.replace(href("/app/lab"));
  }, [account, href, router]);
  return account ? <OwnerSimulation /> : null;
}
