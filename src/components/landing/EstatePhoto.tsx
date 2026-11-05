import Image from "next/image";
import type { Locale } from "@/domain/types";
import { WovenFragment } from "@/components/heritage/Woven";
import { cn } from "@/lib/cn";
import { LANDING_PHOTOS, type LandingPhotoId } from "./photos";

/**
 * One landing photograph slot. The flat ground shows while the image loads, and stands in as an
 * intentional plate (with a woven fragment) when no approved photograph exists for the slot yet.
 */
export function EstatePhoto({
  id,
  locale,
  sizes,
  className,
  ground = "bg-sand-soft",
  groundColor,
  fallbackTone = "light",
  eager = false,
  revealDelay,
}: {
  id: LandingPhotoId;
  locale: Locale;
  sizes: string;
  className?: string;
  ground?: string;
  /** A literal colour for the ground (e.g. a camel coat swatch); overrides `ground`. */
  groundColor?: string;
  fallbackTone?: "light" | "dark";
  eager?: boolean;
  /** Settle in once when scrolled into view (MotionRoot); the value orders it within its section, in ms. */
  revealDelay?: number;
}) {
  const photo = LANDING_PHOTOS[id];
  return (
    <div
      className={cn("relative overflow-hidden", !groundColor && ground, className)}
      style={groundColor ? { backgroundColor: groundColor } : undefined}
      {...(revealDelay === undefined
        ? {}
        : { "data-reveal": "", "data-reveal-kind": "picture", "data-reveal-delay": String(revealDelay) })}
    >
      {photo ? (
        <Image
          src={photo.src}
          alt={photo.alt[locale]}
          fill
          sizes={sizes}
          className="object-cover"
          style={{ objectPosition: photo.focus }}
          {...(eager ? { loading: "eager" as const, fetchPriority: "high" as const } : {})}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center" aria-hidden="true">
          <WovenFragment tone={fallbackTone} className="size-14 opacity-70" />
        </div>
      )}
    </div>
  );
}
