"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useSyncExternalStore } from "react";

const DuneCanvas = dynamic(() => import("./DuneCanvas").then((m) => m.DuneCanvas), { ssr: false, loading: () => null });

const subscribeNever = () => () => {};
let probed: boolean | null = null;
/** Probed once on the client; the server renders the CSS night only. */
function hasWebgl() {
  if (probed === null) {
    try {
      const probe = document.createElement("canvas");
      probed = Boolean(probe.getContext("webgl2") || probe.getContext("webgl"));
    } catch {
      probed = false;
    }
  }
  return probed;
}

/**
 * The hero's sky. The CSS night (gradient and stars) is always underneath; the WebGL scene fades in over it.
 * Without WebGL, the dusk photograph stands in for the dunes under a dark scrim.
 */
export function DuneScene({ className = "" }: { className?: string }) {
  const webgl = useSyncExternalStore(subscribeNever, hasWebgl, () => null);

  return (
    <div aria-hidden className={`absolute inset-0 overflow-hidden ${className}`}>
      <div className="night-stars absolute inset-0 bg-[linear-gradient(to_bottom,var(--night-0)_0%,var(--dusk)_58%,var(--dusk-2)_74%,var(--night-1)_100%)]" />
      {webgl === false ? (
        <>
          <Image
            src="/images/landing/hero-herd-dusk.jpg"
            alt=""
            fill
            sizes="100vw"
            className="object-cover object-[50%_8%] opacity-80 [mask-image:linear-gradient(to_bottom,transparent_8%,black_42%)]"
          />
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(11,8,6,0.1),rgba(11,8,6,0.55)_60%,var(--night-1))]" />
        </>
      ) : null}
      {webgl ? <DuneCanvas /> : null}
    </div>
  );
}
