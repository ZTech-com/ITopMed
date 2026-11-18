"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Keeps a queue screen current: refreshes the server data every few seconds,
 * but never while someone is typing in a field or the tab is hidden.
 */
export function AutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden) return;
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable)) return;
      if (document.querySelector("details[open]")) return;
      router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(id);
  }, [router, seconds]);
  return null;
}
