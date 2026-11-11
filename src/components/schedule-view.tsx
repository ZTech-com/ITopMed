import { getFormatter, getTranslations } from "next-intl/server";
import { formatHm } from "@/server/scheduling/time";
import { Form } from "./ui/form";
import { buttonClass } from "./ui/primitives";

export interface ScheduleBlockView {
  id: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  branch: { name: string };
  room: { name: string } | null;
}

/** Localized weekday name for ISO weekday 1–7 (2030-01-07 is a Monday). */
export async function weekdayNames() {
  const format = await getFormatter();
  return Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, format.dateTime(new Date(Date.UTC(2030, 0, 6 + d)), { weekday: "long", timeZone: "UTC" })])) as Record<number, string>;
}

/** Weekly working hours grouped by day; optional remove buttons for schedule managers. */
export async function ScheduleView({ blocks, removeAction, slug }: { blocks: ScheduleBlockView[]; removeAction?: (s: never, fd: FormData) => Promise<unknown>; slug?: string }) {
  const [t, names] = await Promise.all([getTranslations("clinic.doctors"), weekdayNames()]);
  if (blocks.length === 0) return <p className="px-6 py-5 text-[14px] text-text-2">{t("noBlocks")}</p>;
  const days = [1, 2, 3, 4, 5, 6, 7].filter((d) => blocks.some((b) => b.weekday === d));
  return (
    <ul className="divide-y divide-border">
      {days.map((d) => (
        <li key={d} className="grid gap-2 px-6 py-3 sm:grid-cols-[160px_1fr]">
          <p className="text-[14px] font-medium capitalize">{names[d]}</p>
          <ul className="space-y-1.5">
            {blocks
              .filter((b) => b.weekday === d)
              .map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
                  <span>
                    <span className="font-medium tabular-nums">
                      {formatHm(b.startMinute)}–{formatHm(b.endMinute)}
                    </span>
                    <span className="text-text-2">
                      {" "}
                      · {b.branch.name}
                      {b.room ? ` · ${b.room.name}` : ""}
                    </span>
                  </span>
                  {removeAction && slug ? (
                    <Form action={removeAction as never} className="space-y-0">
                      <input type="hidden" name="$slug" value={slug} />
                      <input type="hidden" name="type" value="block" />
                      <input type="hidden" name="id" value={b.id} />
                      <button className={buttonClass("ghost", "sm")}>{t("remove")}</button>
                    </Form>
                  ) : null}
                </li>
              ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
