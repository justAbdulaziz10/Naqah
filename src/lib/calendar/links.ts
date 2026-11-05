export interface GoogleEventInput {
  title: string;
  start: string | Date;
  end: string | Date;
  details: string;
}

function googleDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new RangeError("Invalid Google Calendar event date");
  return (
    String(date.getUTCFullYear()).padStart(4, "0") +
    String(date.getUTCMonth() + 1).padStart(2, "0") +
    String(date.getUTCDate()).padStart(2, "0") +
    "T" +
    String(date.getUTCHours()).padStart(2, "0") +
    String(date.getUTCMinutes()).padStart(2, "0") +
    String(date.getUTCSeconds()).padStart(2, "0") +
    "Z"
  );
}

/** Convert a site origin and snapshot to the protocol used by calendar subscriptions. */
export function webcalUrl(origin: string, encoded: string): string {
  const url = new URL("/api/calendar", origin);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Calendar origin must use HTTP or HTTPS");
  }
  url.searchParams.set("s", encoded);
  return url.toString().replace(/^https?:/, "webcal:");
}

export function googleSubscribeUrl(webcal: string): string {
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("cid", webcal);
  return url.toString();
}

export function googleEventUrl({ title, start, end, details }: GoogleEventInput): string {
  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", title);
  url.searchParams.set("dates", googleDate(start) + "/" + googleDate(end));
  url.searchParams.set("details", details);
  return url.toString();
}

/** Trigger a .ics download when the browser exposes the required file APIs. */
export function downloadIcs(filename: string, text: string): boolean {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    typeof URL.revokeObjectURL !== "function" ||
    typeof document.createElement !== "function" ||
    !document.body ||
    typeof document.body.append !== "function"
  ) {
    return false;
  }

  let anchor: HTMLAnchorElement | null = null;
  let objectUrl: string | null = null;
  try {
    anchor = document.createElement("a");
    if (typeof anchor.click !== "function" || typeof anchor.remove !== "function") return false;
    objectUrl = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    if (typeof window.setTimeout === "function") {
      const downloadUrl = objectUrl;
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
    } else {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    try {
      anchor?.remove();
    } catch {
      // Cleanup is best-effort when a browser partially implements the DOM API.
    }
    if (objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // The browser can reject revocation for an already-released object URL.
      }
    }
    return false;
  }
  return true;
}
