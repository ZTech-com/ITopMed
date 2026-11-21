"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * A figure that counts up from zero once when it mounts (~0.9 s, ease-out).
 * Works on already-formatted text such as "12 450 000 so'm": only the digits of a
 * single whole number are animated, the grouping separator and the words around
 * it stay as they are. Anything else (decimals, several numbers, no digits) is
 * shown as is. The server renders the final value (correct without JS); screen
 * readers always get the final value; reduced motion skips the animation.
 */
const NUMBER = /^(\D*?)(\d{1,3}(?:([\s  ,.'])\d{3})*|\d+)(\D*)$/;

export function CountUp({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const m = NUMBER.exec(value);
    if (!el || !m) return;
    const [, prefix, digits, sep = "", suffix] = m;
    const target = Number(digits!.replace(/\D/g, ""));
    if (!Number.isSafeInteger(target) || target < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const group = (n: number) => (sep ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep) : String(n));
    const start = performance.now();
    const ms = 900;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 4);
      el.textContent = `${prefix}${group(Math.round(target * eased))}${suffix}`;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    el.textContent = `${prefix}${group(0)}${suffix}`;
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      el.textContent = value;
    };
  }, [value]);
  return (
    <>
      {/* key: a new value mounts a fresh node, so React never edits the text this effect replaced. */}
      <span key={value} ref={ref} aria-hidden>
        {value}
      </span>
      <span className="sr-only">{value}</span>
    </>
  );
}
