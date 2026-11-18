"use client";

import { useEffect, useRef, useState } from "react";
import type { Board } from "@/server/queue/board";

interface Labels {
  title: string;
  now: string;
  waiting: string;
  number: string;
  cabinet: string;
  inVisit: string;
  empty: string;
  soundOn: string;
  soundHint: string;
  /** "{number}-raqam. {name}. {cabinet}ga kiring." */
  spoken: string;
  spokenNoCabinet: string;
  offline: string;
}

const POLL_MS = 4000;

/** A short two-tone chime (no audio file needed). */
function chime(ctx: AudioContext) {
  const now = ctx.currentTime;
  for (const [i, f] of [880, 660].entries()) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, now + i * 0.35);
    g.gain.exponentialRampToValueAtTime(0.35, now + i * 0.35 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.35 + 0.32);
    o.connect(g).connect(ctx.destination);
    o.start(now + i * 0.35);
    o.stop(now + i * 0.35 + 0.34);
  }
}

/**
 * Speaks the call with the best available voice: Uzbek, then Turkish (reads
 * Latin Uzbek closely), then Russian. Browsers ship different voices; where
 * none fits, the chime and the screen still work.
 */
function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const voices = window.speechSynthesis.getVoices();
  const pick = ["uz", "tr", "ru"].map((l) => voices.find((v) => v.lang.toLowerCase().startsWith(l))).find(Boolean);
  const u = new SpeechSynthesisUtterance(text);
  if (pick) {
    u.voice = pick;
    u.lang = pick.lang;
  }
  u.rate = 0.9;
  window.speechSynthesis.speak(u);
}

const fill = (tpl: string, v: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");

export function WaitingRoomBoard({ token, initial, labels }: { token: string; initial: Board; labels: Labels }) {
  const [board, setBoard] = useState(initial);
  const [online, setOnline] = useState(true);
  const [sound, setSound] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  // Calls already announced: "<id>:<count>" (a recall has a higher count and is announced again).
  const announced = useRef(new Set(initial.calls.map((c) => `${c.id}:${c.calls}`)));

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/tv/${token}`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const next = (await r.json()) as Board;
        if (stop) return;
        setOnline(true);
        setBoard(next);
        const fresh = next.calls.filter((c) => c.state === "called" && !announced.current.has(`${c.id}:${c.calls}`));
        for (const c of fresh) announced.current.add(`${c.id}:${c.calls}`);
        if (fresh.length && sound && next.voice && audio.current) {
          chime(audio.current);
          for (const c of fresh.reverse()) {
            const v = { number: String(c.number ?? ""), name: c.spoken, cabinet: c.cabinet ?? "" };
            window.setTimeout(() => speak(fill(c.cabinet ? labels.spoken : labels.spokenNoCabinet, v)), 800);
          }
        }
      } catch {
        if (!stop) setOnline(false);
      }
    };
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [token, sound, labels.spoken, labels.spokenNoCabinet]);

  const enableSound = () => {
    audio.current = audio.current ?? new AudioContext();
    void audio.current.resume();
    chime(audio.current);
    window.speechSynthesis?.getVoices();
    setSound(true);
  };

  const [latest, ...earlier] = board.calls;
  return (
    <main className="min-h-dvh bg-black p-6 text-white md:p-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[18px] text-white/70">{board.clinic} · {board.branch}</p>
          <h1 className="text-[34px] font-bold md:text-[44px]">{labels.title}</h1>
        </div>
        <div className="flex items-center gap-3">
          {!online ? <span className="rounded-full bg-danger-solid text-on-accent px-4 py-2 text-[16px] font-semibold">{labels.offline}</span> : null}
          {board.voice && !sound ? (
            <button type="button" onClick={enableSound} className="rounded-full bg-accent-solid text-on-accent px-5 py-3 text-[18px] font-semibold" title={labels.soundHint}>
              🔊 {labels.soundOn}
            </button>
          ) : null}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section aria-live="polite" className="rounded-[28px] bg-white/5 p-6 md:p-8">
          <p className="mb-4 text-[22px] uppercase tracking-wide text-white/60">{labels.now}</p>
          {latest ? (
            <div className="rounded-[24px] bg-accent-solid text-on-accent p-6 md:p-10">
              <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
                <span className="text-[96px] font-black leading-none tabular-nums md:text-[140px]">{latest.number ?? "—"}</span>
                <span className="min-w-0 break-words text-[40px] font-bold md:text-[56px]">{latest.name}</span>
              </div>
              <p className="mt-4 text-[32px] font-semibold md:text-[44px]">
                {latest.cabinet ? `${labels.cabinet}: ${latest.cabinet}` : latest.doctor}
                {latest.state === "inVisit" ? <span className="ml-4 rounded-full bg-white/20 px-4 py-1 align-middle text-[22px]">{labels.inVisit}</span> : null}
              </p>
            </div>
          ) : (
            <p className="text-[28px] text-white/60">{labels.empty}</p>
          )}
          {earlier.length ? (
            <ul className="mt-6 grid gap-3 md:grid-cols-2">
              {earlier.map((c) => (
                <li key={c.id} className="flex items-baseline justify-between gap-4 rounded-[18px] bg-white/10 px-5 py-4">
                  <span className="text-[40px] font-bold tabular-nums">{c.number ?? "—"}</span>
                  <span className="min-w-0 flex-1 break-words text-[24px]">{c.name}</span>
                  <span className="text-[22px] text-white/80">{c.state === "inVisit" ? labels.inVisit : (c.cabinet ?? "")}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="rounded-[28px] bg-white/5 p-6 md:p-8">
          <p className="mb-4 text-[22px] uppercase tracking-wide text-white/60">{labels.waiting}</p>
          {board.waiting.length ? (
            <ul className="grid grid-cols-3 gap-3">
              {board.waiting.map((w, i) => (
                <li key={`${w.number}-${i}`} className="rounded-[16px] bg-white/10 py-4 text-center text-[36px] font-bold tabular-nums">
                  {w.number ?? "—"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[22px] text-white/60">—</p>
          )}
        </section>
      </div>
    </main>
  );
}
