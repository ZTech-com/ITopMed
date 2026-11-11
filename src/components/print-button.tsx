"use client";

import { Printer } from "lucide-react";
import { buttonClass } from "./ui/primitives";

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass("secondary")}>
      <Printer aria-hidden className="size-4" />
      {label}
    </button>
  );
}
