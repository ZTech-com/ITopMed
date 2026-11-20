"use client";

import { useEffect, useRef } from "react";

/**
 * Telegram's own "Log in with Telegram" button (Login Widget). It runs in
 * `data-auth-url` mode: after the person confirms in Telegram, Telegram's script
 * sends this page to `authUrl` with the signed fields, which our server checks.
 * (`data-onauth` is not used: Telegram's script would need eval, which our CSP forbids.)
 * The script is inserted from our own nonce-carrying bundle ('strict-dynamic');
 * its iframe comes from oauth.telegram.org (frame-src in src/proxy.ts).
 */
export function TelegramWidget({ bot, authUrl, lang, label }: { bot: string; authUrl: string; lang: string; label: string }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.setAttribute("data-telegram-login", bot);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-radius", "10");
    // No photo: the button keeps one width and never pushes the layout.
    s.setAttribute("data-userpic", "false");
    s.setAttribute("data-request-access", "write");
    s.setAttribute("data-lang", lang);
    s.setAttribute("data-auth-url", authUrl);
    el.appendChild(s);
    return () => {
      el.replaceChildren();
    };
  }, [bot, authUrl, lang]);

  return <div ref={box} role="group" aria-label={label} className="flex min-h-12 max-w-full items-center justify-center overflow-hidden" />;
}
