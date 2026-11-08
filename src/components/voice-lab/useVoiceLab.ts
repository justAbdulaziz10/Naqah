"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "@/domain/types";
import { asksToClarify, TurnLoop, type ProviderEvent, type ToolReply } from "./turnLoop";
import { addResponseUsage, addTranscribeUsage, NO_USAGE, type LabPricing, type LabUsage } from "./usage";

export type LabMode = "voice" | "text";
export type LabPhase = "idle" | "connecting" | "live" | "ended" | "failed";

export interface LabFact { id: string; group: "said" | "report"; label: string; value: string; certainty: "reported" | "approximate" | "unknown" | "verified" | null }
export type LabVerdict = { kind: "would_save" } | { kind: "would_reject"; reason: string } | { kind: "declined" } | { kind: "ended" } | { kind: "fallback" };
export interface LabView {
  step: string;
  done: boolean;
  isSummary: boolean;
  queue: string[];
  answered: number;
  question: string;
  summary: string | null;
  facts: LabFact[];
  findings: string[];
  contract: { valid: true } | { valid: false; field: string };
  verdict: LabVerdict | null;
}

export type TranscriptEntry =
  | { id: string; role: "worker" | "agent"; text: string; pending: boolean; interrupted?: boolean }
  | { id: string; role: "tool"; refused: string | null; name: string; clarifying: boolean; declined: boolean };

export interface InspectorEntry { id: number; at: number; kind: string; detail?: string; error?: boolean }
export interface LabError { code: string; detail?: string }

export interface LabStatus {
  model: string;
  configured: boolean;
  source: "farm" | "sample";
  ranch: string;
  worker: string;
  queue: string[];
}

export type LabAccess = "loading" | "ready" | "signed_out" | "private" | "error";

type ApiResult = { ok: true } & Record<string, unknown> | { ok: false; error: string; provider?: string };

async function api(body: object, init: RequestInit = {}): Promise<{ status: number; data: ApiResult }> {
  const response = await fetch("/api/voice-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), ...init });
  const data = (await response.json().catch(() => ({ ok: false, error: "server_error" }))) as ApiResult;
  return { status: response.status, data };
}

const CONNECT_TIMEOUT_MS = 20_000;

/** One browser test call: peer connection, the tool round trip, and everything needed to tear it down. */
export function useVoiceLab(locale: Locale) {
  const [access, setAccess] = useState<LabAccess>("loading");
  const [status, setStatus] = useState<LabStatus | null>(null);
  const [phase, setPhase] = useState<LabPhase>("idle");
  const [mode, setMode] = useState<LabMode>("voice");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [view, setView] = useState<LabView | null>(null);
  const [usage, setUsage] = useState<LabUsage>(NO_USAGE);
  const [pricing, setPricing] = useState<LabPricing | null>(null);
  const [events, setEvents] = useState<InspectorEntry[]>([]);
  const [error, setError] = useState<LabError | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [agentActive, setAgentActive] = useState(false);
  const [canInterrupt, setCanInterrupt] = useState(false);
  const [workerSpeaking, setWorkerSpeaking] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  const live = useRef<{
    closeState: string | null; loop: TurnLoop | null; pc: RTCPeerConnection | null; dc: RTCDataChannel | null; stream: MediaStream | null;
    audio: HTMLAudioElement | null; audioContext: AudioContext | null; raf: number | null; state: string | null;
    timers: ReturnType<typeof setTimeout | typeof setInterval>[]; serial: number;
  }>({ closeState: null, loop: null, pc: null, dc: null, stream: null, audio: null, audioContext: null, raf: null, state: null, timers: [], serial: 0 });
  const eventId = useRef(0);

  const log = useCallback((kind: string, detail?: string, isError = false) => {
    const entry: InspectorEntry = { id: ++eventId.current, at: Date.now(), kind, detail, error: isError };
    setEvents((list) => [entry, ...list].slice(0, 200));
  }, []);

  /** Idempotent: every path out of a call ends here, including leaving the page. */
  const teardown = useCallback(() => {
    const run = live.current;
    run.serial += 1;
    run.loop?.close();
    for (const timer of run.timers) clearTimeout(timer as ReturnType<typeof setTimeout>);
    if (run.raf !== null) cancelAnimationFrame(run.raf);
    run.dc?.close();
    run.pc?.close();
    run.stream?.getTracks().forEach((track) => track.stop());
    if (run.audio) run.audio.srcObject = null;
    void run.audioContext?.close().catch(() => undefined);
    // Hang up on OpenAI's side too, so a closed tab can't leave a billed session open.
    if (run.closeState) void api({ op: "close", state: run.closeState }, { keepalive: true }).catch(() => undefined);
    live.current = { closeState: null, loop: null, pc: null, dc: null, stream: null, audio: null, audioContext: null, raf: null, state: null, timers: [], serial: run.serial };
    setAgentActive(false);
    setCanInterrupt(false);
    setWorkerSpeaking(false);
    setMicLevel(0);
    setSecondsLeft(null);
  }, []);

  const failWith = useCallback((code: string, detail?: string) => {
    log("error", detail ? `${code} · ${detail}` : code, true);
    setError({ code, detail });
    setPhase("failed");
    teardown();
  }, [log, teardown]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { status: code, data } = await api({ op: "status", locale });
        if (!active) return;
        if (data.ok) {
          setStatus(data as unknown as LabStatus);
          setAccess("ready");
        } else {
          setAccess(code === 401 ? "signed_out" : code === 404 ? "private" : "error");
        }
      } catch {
        if (active) setAccess("error");
      }
    })();
    return () => { active = false; };
  }, [locale]);

  useEffect(() => {
    window.addEventListener("pagehide", teardown);
    return () => {
      window.removeEventListener("pagehide", teardown);
      teardown();
    };
  }, [teardown]);

  const upsert = useCallback((id: string, role: "worker" | "agent", change: (text: string) => string, pending: boolean) => {
    setTranscript((list) => {
      const index = list.findIndex((entry) => entry.id === id);
      if (index < 0) return [...list, { id, role, text: change(""), pending }];
      const entry = list[index];
      if (entry.role === "tool") return list;
      return [...list.slice(0, index), { ...entry, text: change(entry.text), pending }, ...list.slice(index + 1)];
    });
  }, []);

  const onProvider = useCallback((event: ProviderEvent, loop: TurnLoop, responseItems: Map<string, string>) => {
    const item = String(event.item_id ?? "");
    switch (event.type) {
      case "input_audio_buffer.speech_started": setWorkerSpeaking(true); break;
      case "input_audio_buffer.speech_stopped": setWorkerSpeaking(false); break;
      case "input_audio_buffer.committed": upsert(item, "worker", (text) => text, true); break;
      case "conversation.item.input_audio_transcription.delta": upsert(item, "worker", (text) => text + String(event.delta ?? ""), true); break;
      case "conversation.item.input_audio_transcription.completed":
        upsert(item, "worker", () => String(event.transcript ?? "").trim(), false);
        setUsage((total) => addTranscribeUsage(total, event.usage));
        break;
      case "conversation.item.input_audio_transcription.failed":
        upsert(item, "worker", (text) => text, false);
        log("transcription_failed", String((event.error as { code?: string } | undefined)?.code ?? ""), true);
        break;
      case "response.output_audio_transcript.delta":
      case "response.output_text.delta":
        responseItems.set(String(event.response_id), item);
        upsert(item, "agent", (text) => text + String(event.delta ?? ""), true);
        break;
      case "response.output_audio_transcript.done": upsert(item, "agent", () => String(event.transcript ?? ""), false); break;
      case "response.output_text.done": upsert(item, "agent", () => String(event.text ?? ""), false); break;
    }
    loop.handle(event);
    setAgentActive(loop.busy);
    setCanInterrupt(loop.canInterrupt);
  }, [log, upsert]);

  const start = useCallback(async (nextMode: LabMode) => {
    teardown();
    const serial = live.current.serial;
    const current = () => live.current.serial === serial;
    setMode(nextMode);
    setPhase("connecting");
    setError(null);
    setTranscript([]);
    setView(null);
    setUsage(NO_USAGE);
    setEvents([]);

    if (!window.RTCPeerConnection) return failWith("webrtc_unsupported");
    if (nextMode === "voice") {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return failWith("mic_insecure");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (!current()) return stream.getTracks().forEach((track) => track.stop());
        live.current.stream = stream;
      } catch (cause) {
        if (!current()) return;
        const name = cause instanceof DOMException ? cause.name : "";
        return failWith(name === "NotAllowedError" || name === "SecurityError" ? "mic_denied" : name === "NotFoundError" ? "mic_missing" : name === "NotReadableError" ? "mic_busy" : "mic_failed", name);
      }
    }

    try {
      const run = live.current;
      const pc = new RTCPeerConnection();
      run.pc = pc;
      const audio = new Audio();
      audio.autoplay = true;
      run.audio = audio;
      pc.ontrack = (trackEvent) => { audio.srcObject = trackEvent.streams[0] ?? null; };
      if (run.stream) {
        const [track] = run.stream.getAudioTracks();
        track.onended = () => { if (current()) failWith("mic_lost"); };
        pc.addTrack(track, run.stream);
        startMeter(run.stream, run, setMicLevel);
      } else {
        pc.addTransceiver("audio", { direction: "recvonly" });
      }

      const dc = pc.createDataChannel("oai-events");
      run.dc = dc;
      pc.onconnectionstatechange = () => {
        if (!current()) return;
        log("connection", pc.connectionState);
        if (pc.connectionState === "failed") failWith("connection_failed");
        if (pc.connectionState === "disconnected") {
          run.timers.push(setTimeout(() => { if (current() && pc.connectionState === "disconnected") failWith("connection_lost"); }, 5_000));
        }
      };

      await pc.setLocalDescription(await pc.createOffer());
      if (!current()) return;
      // Not aborted on cancel: the server would still create the call, and only this reply can hang it up.
      const opened = await api({ op: "open", mode: nextMode, locale, sdp: pc.localDescription?.sdp ?? "" });
      if (!current()) {
        if (opened.data.ok) void api({ op: "close", state: opened.data.closeState }, { keepalive: true }).catch(() => undefined);
        return;
      }
      if (!opened.data.ok) return failWith(opened.data.error, opened.data.provider);

      const reply = opened.data as unknown as { answer: string; state: string; closeState: string; opening: string; view: LabView; pricing: LabPricing | null; maxSeconds: number };
      run.state = reply.state;
      run.closeState = reply.closeState;
      setView(reply.view);
      setPricing(reply.pricing);

      const responseItems = new Map<string, string>();
      const loop = new TurnLoop({
        send: (message) => { if (dc.readyState === "open") dc.send(JSON.stringify(message)); },
        log: (kind, detail) => log(kind, detail),
        fail: (code, detail) => failWith(code, detail),
        finished: (reason) => {
          log("call_finished", reason);
          setPhase("ended");
          teardown();
        },
        usage: (value) => setUsage((total) => addResponseUsage(total, value)),
        interrupted: ({ responseId, itemId }) => {
          // Generation can finish before playback does, leaving only the audio item to mark.
          const id = itemId ?? (responseId ? responseItems.get(responseId) : undefined);
          if (id) setTranscript((list) => list.map((entry) => entry.id === id && entry.role === "agent" ? { ...entry, interrupted: true, pending: false } : entry));
        },
        runTool: async ({ name, args, spoke, heard, workerUtterance, heardSummary }): Promise<ToolReply> => {
          const { data, status: code } = await api({ op: "tool", state: run.state, name, args, spoke, heard, workerUtterance, heardSummary });
          // A reply from a call that was reset must not land in the next one.
          if (!current()) return { output: "{}", end: null, goodbye: null };
          if (!data.ok) throw new Error(`${data.error}${code ? ` (${code})` : ""}`);
          const result = data as unknown as ToolReply & { state: string; refused: string | null; view: LabView };
          run.state = result.state;
          setView(result.view);
          log(result.refused ? "tool_refused" : "tool_ok", result.refused ? `${name}: ${result.refused}` : `${name} ${JSON.stringify(args)}`);
          const toolEntry: TranscriptEntry = { id: `tool-${++eventId.current}`, role: "tool", name, refused: result.refused, clarifying: asksToClarify(result.refused), declined: name === "confirm_report" && args.confirmed === false };
          setTranscript((list) => [...list, toolEntry]);
          return result;
        },
      }, nextMode, reply.opening);
      run.loop = loop;

      dc.onmessage = (message) => {
        if (!current()) return;
        let event: ProviderEvent;
        try {
          event = JSON.parse(message.data as string) as ProviderEvent;
        } catch {
          return failWith("provider_invalid");
        }
        if (event.type === "session.created") setPhase("live");
        onProvider(event, loop, responseItems);
      };
      dc.onclose = () => { if (current() && run.loop) failWith("connection_lost"); };

      await pc.setRemoteDescription({ type: "answer", sdp: reply.answer });
      if (!current()) return;
      run.timers.push(setTimeout(() => { if (current() && !loop.isReady) failWith("connect_timeout"); }, CONNECT_TIMEOUT_MS));

      setSecondsLeft(reply.maxSeconds);
      const endsAt = Date.now() + reply.maxSeconds * 1000;
      run.timers.push(setInterval(() => {
        if (!current()) return;
        const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
        setSecondsLeft(left);
        if (left === 0) {
          log("call_finished", "time_limit");
          setPhase("ended");
          teardown();
        }
      }, 1000));
    } catch (cause) {
      if (!current()) return;
      failWith("connect_failed", cause instanceof Error ? cause.name : undefined);
    }
  }, [failWith, locale, log, onProvider, teardown]);

  const sendText = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !live.current.loop) return;
    setTranscript((list) => [...list, { id: `typed-${++eventId.current}`, role: "worker", text: trimmed, pending: false }]);
    live.current.loop.sendText(trimmed);
  }, []);

  const interrupt = useCallback(() => {
    live.current.loop?.interrupt();
    setCanInterrupt(false);
  }, []);

  const end = useCallback(() => {
    log("call_finished", "owner_ended");
    setPhase("ended");
    teardown();
  }, [log, teardown]);

  const reset = useCallback(() => {
    teardown();
    setPhase("idle");
    setError(null);
    setTranscript([]);
    setView(null);
    setUsage(NO_USAGE);
    setEvents([]);
  }, [teardown]);

  return { access, status, phase, mode, transcript, view, usage, pricing, events, error, secondsLeft, agentActive, canInterrupt, workerSpeaking, micLevel, start, sendText, interrupt, end, reset };
}

function startMeter(stream: MediaStream, run: { audioContext: AudioContext | null; raf: number | null }, setLevel: (value: number) => void) {
  const context = new AudioContext();
  run.audioContext = context;
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  let last = 0;
  const tick = (time: number) => {
    run.raf = requestAnimationFrame(tick);
    if (time - last < 120) return;
    last = time;
    analyser.getByteTimeDomainData(samples);
    let peak = 0;
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
    setLevel(Math.min(1, peak / 64));
  };
  run.raf = requestAnimationFrame(tick);
}
