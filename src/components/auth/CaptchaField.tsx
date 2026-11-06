'use client';

import { useEffect, useRef } from 'react';
import { useI18n } from '@/i18n/client';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }

function loadTurnstile() {
  return new Promise<Turnstile>((resolve, reject) => {
    if (window.turnstile) { resolve(window.turnstile); return; }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    const script = existing ?? Object.assign(document.createElement('script'), { src: SCRIPT_SRC, async: true });
    script.addEventListener('load', () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile missing'))));
    script.addEventListener('error', reject);
    if (!existing) document.head.append(script);
  });
}

/** Tokens are single-use: bump `resetKey` after each send attempt to get a fresh one. */
export function CaptchaField({ siteKey, resetKey, onToken, onFailed }: {
  siteKey: string;
  resetKey: number;
  onToken: (token: string) => void;
  onFailed: () => void;
}) {
  const { locale, m: { auth: m } } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const callbacks = useRef({ onToken, onFailed });
  useEffect(() => { callbacks.current = { onToken, onFailed }; });

  useEffect(() => {
    let active = true;
    loadTurnstile().then((turnstile) => {
      if (!active || !box.current) return;
      widget.current = turnstile.render(box.current, {
        sitekey: siteKey,
        language: locale,
        theme: 'light',
        size: 'flexible',
        callback: (token: string) => callbacks.current.onToken(token),
        'expired-callback': () => callbacks.current.onToken(''),
        'error-callback': () => { callbacks.current.onToken(''); callbacks.current.onFailed(); },
      });
    }).catch(() => { if (active) callbacks.current.onFailed(); });
    return () => {
      active = false;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, locale]);

  useEffect(() => {
    if (resetKey && widget.current) window.turnstile?.reset(widget.current);
  }, [resetKey]);

  return <div ref={box} role="group" aria-label={m.captchaLabel} className="min-h-[65px]" />;
}
