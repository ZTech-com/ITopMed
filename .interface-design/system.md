# ITop Med — interface system ("Yumshoq")

Persistent design decisions. Code is the source of truth: tokens live in
`src/app/globals.css`, components in `src/components/ui/` and `src/components/shell/`.
Change a value there first, then update this file.

## Who and what it should feel like
- **People:** clinic receptionists, doctors, nurses, cashiers and the clinic owner in
  Uzbekistan, on a shared reception PC, a doctor's laptop or a phone between patients;
  the founder in the SuperAdmin console. Many are not "computer people".
- **Jobs:** register a patient and take payment in one screen; see who is next; write the
  visit; know today's money.
- **Feel:** *yumshoq* (soft, calm) — a clean clinic corridor in daylight, not a hospital
  machine and not a startup dashboard. Quiet surfaces, one confident ink action per screen.

## Signature
- **Ink pill.** The one primary action and the active navigation item are ink-black pills
  (light pill with ink text in dark mode). Nothing else is that dark.
- **"Next in the queue" card.** On the reception desk the next patient is the only inverted
  (ink) panel: the room's focal point, like the ticket screen in the waiting room.
- **Day tracks.** Charts draw every day as a quiet track, so an empty week still reads as a week.

## Colour (one hue family: blue-grey)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #eef1f5 | #0c0f14 | page ground |
| `--surface` | #ffffff | #161a21 | cards, panels, inputs |
| `--surface-2` | #f7f8fa | #1c212a | table heads, chart tracks, hover |
| `--surface-sunken` | #e6eaf0 | #10141a | neutral badges, skeletons, read-only |
| `--sidebar` | #f7f8fa | #12161c | floating sidebar panel |
| `--text` / `-2` / `-3` | #16181d / #4d5361 / #5b6170 | #f2f3f5 / #b3bac7 / #98a0ae | primary / supporting / meta |
| `--accent` | #1f56c7 | #7ea8ff | links, information, chart bars |
| `--accent-solid` | #16181d | #f2f3f5 | the ink pill (with `--on-accent` text) |
| semantic | success / warning / danger (+ `-soft`) | desaturated, lighter in dark | status only |

Rules: colour communicates (status, action), never decorates. No gradients, no glass.
White text only on `*-solid` fills. Raw hex only in brand artwork.

## Type
- **Manrope** (Latin + Cyrillic), `next/font`. Bold weights carry hierarchy.
- Page title 26 → 34px / 800 / -0.03em, balanced. Card title 16 / 700. Body 14–15 / 400–500.
  Labels 13 / 500. Meta 12 / 400 `text-3`. Table heads 12 / 500 uppercase +0.04em.
- Figures: `tabular-nums`; stat values scale with their card (`clamp(…, 12cqi, 2rem)`), the
  currency may wrap under the digits, never the digits themselves (`moneyFormatter()`).

## Space, shape, depth
- Base unit 4px. Card padding 20 → 24px (`px-5 sm:px-6`). Page gutter 16/24/32px. Max width 1240px.
- Radius scale: controls 12px (`--radius-control`), alerts 16px, cards 24px (`--radius-card`),
  sidebar / auth card 28px, buttons and nav items full pills.
- Depth: **surface shifts + hairline borders** (`--border` 7% ink). Shadows only for things
  that float (`--shadow-pop`: menus, skip link). No dramatic shadows.
- Hit areas ≥ 44px for primary controls (`md` button 44px, nav item 44px, menu button 44px).

## Components (values)
- **Button** primary = ink pill · md 44px h · px-5 · 14/600; secondary = surface + hairline;
  ghost = text-2 → sunken on hover; danger = `--danger-solid`. Press: scale .97.
- **Input / select** 44px h · radius 12 · `border-strong` · focus = accent border + 4px focus ring.
- **Card** surface · radius 24 · hairline · `CardHeader` divides with a hairline.
- **Badge** soft tone pill with a 6px dot. **Alert** soft tone, radius 16.
- **Table** `<Table>`: phone = cards (first cell is the title), desktop = rows with hairlines.
- **Sidebar** 280px floating panel on the ground; footer: install, language and theme stacked (one row clips the labels at 280px),
  user with security + sign-out.
- **Loading**: `PageSkeleton` (`loading.tsx` in the clinic workspace and console) mirrors a
  page — title, four figures, one panel — so nothing jumps when content arrives.

## Motion
- Tokens: `--ease-out` cubic-bezier(.23,1,.32,1) · `--ease-in-out` (.77,0,.175,1) ·
  `--dur-press` 120ms · `--dur-quick` 160ms · `--dur-panel` 220ms.
- Page content rises 4px on enter (`animate-rise`); phone menu panel drops in (`animate-drop`);
  skeletons breathe (opacity only). Only `transform` / `opacity` / colours animate.
- Frequent actions (typing, search, queue calls) get no decorative motion.
- `prefers-reduced-motion`: all motion collapses to instant; skeletons hold still.

## Checks after any UI change
`npm run lint · typecheck · test · i18n:check · build`, then `npm run ui:audit` (phone,
tablet, desktop × light, dark) must report no problems. Large sums: test with tens of millions.
