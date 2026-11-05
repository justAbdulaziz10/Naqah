"use client";

import { useCallback, useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface InstallState {
  canInstall: boolean;
  isInstalled: boolean;
  isIOS: boolean;
}

const subscribers = new Set<(state: InstallState) => void>();
let deferredPrompt: InstallPromptEvent | null = null;
let installed = false;
let ios = false;
let listenersAttached = false;

function publishInstallState() {
  const state = { canInstall: Boolean(deferredPrompt), isInstalled: installed, isIOS: ios };
  for (const subscriber of subscribers) subscriber(state);
}

function attachInstallListeners() {
  if (typeof window === "undefined" || listenersAttached) return;
  listenersAttached = true;

  const standaloneQuery = typeof window.matchMedia === "function"
    ? window.matchMedia("(display-mode: standalone)")
    : null;
  const updateStandalone = () => {
    const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
    installed = Boolean(standaloneQuery?.matches || navigatorWithStandalone.standalone);
    publishInstallState();
  };
  const userAgent = window.navigator.userAgent;
  ios = /iPad|iPhone|iPod/.test(userAgent)
    || (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  updateStandalone();

  const onBeforeInstallPrompt = (event: Event) => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    publishInstallState();
  };
  const onAppInstalled = () => {
    deferredPrompt = null;
    installed = true;
    publishInstallState();
  };

  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onAppInstalled);
  standaloneQuery?.addEventListener?.("change", updateStandalone);
}

export function useInstallPrompt() {
  const [canInstall, setCanInstall] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const update = (state: InstallState) => {
      setCanInstall(state.canInstall);
      setIsInstalled(state.isInstalled);
      setIsIOS(state.isIOS);
    };
    subscribers.add(update);
    attachInstallListeners();
    publishInstallState();
    return () => {
      subscribers.delete(update);
    };
  }, []);

  const install = useCallback(async () => {
    const prompt = deferredPrompt;
    if (!prompt) return false;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      deferredPrompt = null;
      if (choice.outcome === "accepted") installed = true;
      publishInstallState();
      return choice.outcome === "accepted";
    } catch {
      deferredPrompt = null;
      publishInstallState();
      return false;
    }
  }, []);

  return { canInstall, install, isInstalled, isIOS };
}
