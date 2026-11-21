/**
 * Small server-rendered bar chart (no chart library, no client JS): fixed
 * height, bars scale to the largest value, readable day labels at any width.
 * The numbers are also in a table for screen readers.
 */
export function BarChart({ label, bars }: { label: string; bars: { key: string; short: string; value: number; display: string; highlight?: boolean }[] }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <figure className="space-y-2">
      <div className="flex h-36 items-end gap-1 sm:gap-1.5" role="img" aria-label={label}>
        {bars.map((b) => (
          // Each day is a quiet track, so an empty week still reads as a week (not a blank box).
          <div key={b.key} className="flex h-full min-w-0 flex-1 flex-col justify-end overflow-hidden rounded-[8px] bg-surface-2" title={`${b.short}: ${b.display}`}>
            <div
              className={`w-full rounded-[8px] ${b.highlight ? "bg-accent-solid" : "bg-accent"}`}
              style={{ height: `${b.value > 0 ? Math.max(3, Math.round((b.value / max) * 100)) : 0}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1 sm:gap-1.5" aria-hidden>
        {bars.map((b) => (
          <span key={b.key} className={`min-w-0 flex-1 text-center text-[11px] tabular-nums ${b.highlight ? "font-semibold text-text" : "text-text-3"}`}>
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
