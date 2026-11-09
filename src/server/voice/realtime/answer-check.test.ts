import { describe, expect, it } from "vitest";
import { answer, start, type CallSession } from "@/domain/conversation/engine";
import { fromRiyadh } from "@/domain/clock";
import { createDemoWorkspace } from "@/domain/seed";
import { herdAnswerFromWords, refuseAnswer } from "./answer-check";

const NOW = fromRiyadh(2026, 11, 5, 17, 10);

function at(id: string): CallSession {
  const ws = createDemoWorkspace("ar", "ultimate", fromRiyadh(2026, 11, 4, 9, 0));
  const started = start(ws, NOW, "report_call");
  const ringing = started.commit?.(ws) ?? ws;
  const session = answer(started.session, ringing, NOW, { value: "answer" }).session;
  const index = session.data.queue?.findIndex((item) => item.id === id) ?? -1;
  expect(index).toBeGreaterThanOrEqual(0);
  return { ...session, step: "report_question", data: { ...session.data, reportIndex: index } };
}

describe("worker words against the chosen answer", () => {
  const health = at("herd_health");
  const feed = at("feed_level");

  it.each(["العلف زين", "الماء تمام", "السور سليم", "the feed is fine"])("refuses %s as a herd-health answer", (heard) => {
    expect(refuseAnswer(health, { value: "yes" }, heard, "ar")).toBe("answer_off_topic");
  });

  it.each(["كلها بخير", "الحلال زين", "الحمد لله", "زين", "ما فيها شي", "لا ما فيه مريض"])("accepts %s as a herd-health answer", (heard) => {
    expect(refuseAnswer(health, { value: "yes" }, heard, "ar")).toBeNull();
  });

  it("keeps a reply that answers the question and adds something else", () => {
    expect(refuseAnswer(health, { value: "yes" }, "الحلال زين بس العلف خلص", "ar")).toBeNull();
  });

  it("does not record all camels well without words that say so", () => {
    expect(refuseAnswer(health, { value: "yes" }, "الجو حار اليوم", "ar")).toBe("answer_unclear");
    expect(refuseAnswer(health, { value: "yes" }, "", "ar")).toBe("answer_unclear");
    expect(refuseAnswer(health, { value: "unknown" }, "ما أدري", "ar")).toBeNull();
    expect(refuseAnswer(health, { value: "no" }, "وحدة تعبانة", "ar")).toBeNull();
  });

  it("lets the worker's clear words decide the herd-health answer", () => {
    expect(herdAnswerFromWords(health, { value: "no" }, "لا ما فيه مريض", "ar")).toEqual({ value: "yes" });
    expect(herdAnswerFromWords(health, { value: "yes" }, "وحدة تعبانة", "ar")).toEqual({ value: "no" });
    expect(herdAnswerFromWords(health, { value: "unknown" }, "الجو حار اليوم", "ar")).toEqual({ value: "unknown" });
    expect(herdAnswerFromWords(health, { value: "no" }, "لا", "ar")).toEqual({ value: "no" });
    expect(herdAnswerFromWords(health, { value: "no" }, "", "ar")).toEqual({ value: "no" });
    expect(herdAnswerFromWords(feed, { value: "low" }, "لا ما فيه مريض", "ar")).toEqual({ value: "low" });
  });

  it("treats a camel name as the topic", () => {
    expect(refuseAnswer(health, { value: "no" }, "مبروكة والعلف", "ar", ["مبروكة"])).toBeNull();
  });

  it("leaves short replies on stock questions alone", () => {
    expect(refuseAnswer(feed, { value: "low" }, "باقي شوي", "ar")).toBeNull();
    expect(refuseAnswer(feed, { value: "good" }, "الحلال زين", "ar")).toBe("answer_off_topic");
    expect(refuseAnswer(feed, { value: "good" }, null, "ar")).toBeNull();
  });
});
