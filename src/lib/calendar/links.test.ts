import { describe, expect, it } from "vitest";
import { googleEventUrl, googleSubscribeUrl, webcalUrl } from "./links";

describe("calendar links", () => {
  it("builds a webcal feed URL and Google subscribe link", () => {
    const feed = webcalUrl("https://demo.naqah.app", "eyJsIjoiYXIifQ");
    const feedUrl = new URL(feed);
    const google = new URL(googleSubscribeUrl(feed));

    expect(feedUrl.protocol).toBe("webcal:");
    expect(feedUrl.pathname).toBe("/api/calendar");
    expect(feedUrl.searchParams.get("s")).toBe("eyJsIjoiYXIifQ");
    expect(google.searchParams.get("cid")).toBe(feed);
  });

  it("creates a UTC Google event template with encoded text and details", () => {
    const url = new URL(
      googleEventUrl({
        title: "Check water",
        start: "2026-11-06T14:00:00.000Z",
        end: "2026-11-06T14:30:00.000Z",
        details: "Farm: North Farm",
      }),
    );

    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Check water");
    expect(url.searchParams.get("dates")).toBe("20261106T140000Z/20261106T143000Z");
    expect(url.searchParams.get("details")).toBe("Farm: North Farm");
  });

  it("rejects an invalid origin or event time", () => {
    expect(() => webcalUrl("mailto:owner@example.com", "s")).toThrow();
    expect(() =>
      googleEventUrl({ title: "Task", start: "not-a-date", end: "2026-11-06T00:00:00Z", details: "" }),
    ).toThrow("Invalid Google Calendar event date");
  });
});
