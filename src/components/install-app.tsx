"use client";

import { Download, Share } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * "Install app" for every platform:
 *  - Chromium (Android, Windows, macOS, Linux, ChromeOS): native install prompt.
 *  - iOS/iPadOS Safari (no prompt API): short Share → "Add to Home Screen" hint.
 * Hidden when already running as an installed app.
 */
export function InstallApp({ compact }: { compact?: boolean }) {
  const t = useTranslations("pwa");
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(true);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    // Platform detection runs after hydration on purpose (client-only facts).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInstalled(standalone);
    const ua = navigator.userAgent;
    setIos(/iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || (!prompt && !ios)) return null;

  if (prompt) {
    return (
      <button
        type="button"
        onClick={async () => {
          await prompt.prompt();
          const choice = await prompt.userChoice;
          if (choice.outcome === "accepted") setInstalled(true);
          setPrompt(null);
        }}
        className="flex h-9 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-accent-soft px-3 text-[13px] font-semibold text-accent hover:opacity-90"
      >
        <Download aria-hidden className="size-4" />
        {t("install")}
      </button>
    );
  }
  return (
    <p className={compact ? "hidden" : "flex items-start gap-2 rounded-[10px] bg-accent-soft px-3 py-2 text-[12.5px] leading-snug text-accent"}>
      <Share aria-hidden className="mt-0.5 size-4 shrink-0" />
      {t("iosHint")}
    </p>
  );
}
