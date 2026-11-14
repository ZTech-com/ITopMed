"use client";

import { Printer } from "lucide-react";
import { useEffect } from "react";
import { buttonClass } from "./ui/primitives";

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass("secondary")}>
      <Printer aria-hidden className="size-4" />
      {label}
    </button>
  );
}

/** Opens the print dialog once the page is shown, when the link asked for it (?print=1). */
export function AutoPrint() {
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("print") !== "1") return;
    const id = window.setTimeout(() => window.print(), 350);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}
