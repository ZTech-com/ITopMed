/**
 * Small server-rendered bar chart (no chart library, no client JS): fixed
 * height, bars scale to the largest value, readable day labels at any width.
 * The numbers are also in a table for screen readers.
 */
export function BarChart({ label, bars }: { label: string; bars: { key: string; short: string; value: number; display: string; highlight?: boolean }[] }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <figure className="space-y-2">
      <div className="flex h-40 items-end gap-1.5 sm:gap-2" role="img" aria-label={label}>
        {bars.map((b, i) => (
          // Each day is a quiet track, so an empty week still reads as a week (not a blank box).
          <div key={b.key} className="flex h-full min-w-0 flex-1 flex-col justify-end overflow-hidden rounded-[10px] bg-tile" title={`${b.short}: ${b.display}`}>
            {/* Hatched blue for the days, solid ink for the highlighted one (today). */}
            <div
              className={`bar-grow w-full rounded-[10px] ${b.highlight ? "bg-[var(--chart-b)]" : "hatch"}`}
              style={{ height: `${b.value > 0 ? Math.max(3, Math.round((b.value / max) * 100)) : 0}%`, animationDelay: `${120 + i * 28}ms` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 sm:gap-2" aria-hidden>
        {bars.map((b) => (
          <span key={b.key} className={`min-w-0 flex-1 text-center text-[12px] tabular-nums ${b.highlight ? "font-semibold text-text" : "text-text-3"}`}>
            {b.short}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {bars.map((b) => (
            <tr key={b.key}>
              <th scope="row">{b.short}</th>
              <td>{b.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
