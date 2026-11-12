# Handoff: Almanac — Personal Goal-Setting & Habit Tracking App

## Overview
Almanac is a private, local-first mobile web app for one person's daily goal-setting, habit tracking, and reflection practice, with a Claude-powered AI guide. This handoff covers the visual language and three fully-designed screens (Dashboard, Goals, Habits) plus the navigation shell and AI Guide panel that wrap all nine screens.

## About the Design Files
The bundled file (`Almanac.dc.html`) is a **design reference built in HTML** — a working, click-through prototype showing intended look, layout, and interaction, not production code to copy directly. The task is to **recreate this design in the target codebase's real stack**: server-rendered EJS templates, vanilla ES6 JavaScript, and hand-written CSS (no frontend framework). Rebuild the markup as EJS partials/views, port the interaction logic (drawer toggle, tab switching, checkbox/streak toggling, goal card expand/collapse, AI sheet open/close) to vanilla JS, and translate the inline styles below into a small hand-written CSS token system (custom properties), not inline styles.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and component styling below are final — implement pixel-close, using the exact hex values and scale given. Where a value isn't specified, infer from the nearest listed token rather than inventing new ones.

## Product Requirements (for context)
- Local-first, offline except for the AI guide (which calls the Claude API — key stored in Settings).
- One user, no accounts/teams/social layer, no onboarding funnel — opens straight to Dashboard.
- Nine screens behind one navigation: Dashboard, Goals, Focus Areas, Habits, How You Feel, Reflection, Wisdom Library, AI Guide, Settings. This handoff fully specifies Dashboard, Goals, Habits, and the shared nav/AI shell; the other five screens are stubbed as placeholders in the prototype and still need real designs before build.
- Goals have three tiers — annual → monthly → weekly — linked parent→child, with progress that should conceptually roll up (the prototype hardcodes progress values; the real app should compute rollups from child completion).
- Desktop and mobile: this handoff is the **mobile** layout (phone-width, drawer nav). A desktop/wide layout was explored earlier in the project and can be requested separately — do not assume it from this document.
- Dark mode is required by the product spec but out of scope for this handoff (light mode only was designed).
- WCAG 2.1 AA — carry through the focus-ring, contrast, and hit-target rules noted below.

## Design Tokens

### Colors
| Token | Hex | Usage |
|---|---|---|
| `--color-bg` | `#f7f5f0` | App background (page/phone-screen ground) |
| `--color-surface` | `#ffffff` | Card fills |
| `--color-text` | `#201e1d` | Body/heading text |
| `--color-accent` (green, base) | `#1f6e52` | Primary actions, checkmarks, active nav, progress bar fill, links |
| `--color-accent-100…900` | `#e3efe9, #c3ddd1, #9cc7b5, #6fa98f, #3d8865, #185940, #123f2e, #0c2c20, #081d15` | Tints (100–300) for fills/hovers/badges; base (500-ish/`--color-accent`) for primary UI; deep steps (700–900) for text-on-tint and pressed states |
| `--color-accent-2` (orange, base) | `#c97a3a` | Secondary spot color — high-priority tags only, used sparingly |
| `--color-accent-2-100…900` | `#fbeee0, #f5d9b8, #eab883, #dd9a5c, #c97a3a, #a8632c, #824b21, #5e3618, #3c220f` | Same ramp usage as green, for the orange role |
| `--color-neutral-100…900` | `#f8f4f4 … #2d2b2b` | Neutral fills (empty progress-bar track, inactive nav icon badges, placeholder icon backgrounds) |
| `--color-divider` | `#201e1d` at 16% opacity | Hairline separators (used sparingly — see Layout Philosophy) |
| Focus ring | `2px solid var(--color-accent)`, `2px` outline-offset | Every interactive element's `:focus-visible` |

Priority tag colors: **high** → orange tint (`accent-2-100` bg / `accent-2-800` text), **medium** → green tint (`accent-100` bg / `accent-800` text), **low** → neutral tint (`neutral-100` bg / `neutral-800` text).

### Typography
- Single family throughout: **Inter** (Google Fonts, weights 400/500/600/700 + italic 400), for both headings and body — `--font-heading` and `--font-body` both map to Inter.
- Heading weight: 600.
- Scale (unchanged from base system): h1 42px / h2 32px / h3 25px / h4 20px / h5 16px / h6 13px (h6 uppercase, 0.08em tracking, used as section eyebrows like "Today's focus"). Body text 15px, line-height 1.55.
- Pull quotes (the daily wisdom quote) are italic, ~16px, serif-style weight retained at regular 400.

### Spacing (8px-adjacent scale, already 1.25× "airy")
`--space-1: 5px`, `--space-2: 10px`, `--space-3: 15px`, `--space-4: 20px`, `--space-6: 30px`, `--space-8: 40px`. Use these for all padding/gap/margin — don't introduce arbitrary pixel values.

### Radius & Elevation
- `--radius-sm: 1px`, `--radius-md: 2px` (cards, buttons, inputs), `--radius-lg: 4px` (dialogs/sheets).
- The phone-frame chrome itself (device bezel in the prototype) uses a much larger radius (34px) — that's presentation chrome for the prototype only, not a UI token; a real mobile web page has no device bezel.
- Bottom sheet (AI Guide) radius: `16px 16px 0 0` (top corners only) — an intentional exception to `--radius-lg` because it's a full-bleed sheet, not a card.
- Shadows: `--shadow-sm: 0 1px 2px rgba(45,43,43,.14)`, `--shadow-md: 0 3px 10px rgba(45,43,43,.16)`, `--shadow-lg: 0 12px 32px rgba(45,43,43,.22)`. Cards use `sm`; the floating AI button and bottom sheet use `md`/`lg`.

### Layout Philosophy
No boxes or dividers as a general structuring device — hierarchy comes from type scale and whitespace. `.card` (white fill, `shadow-sm`, `radius-md`, `space-3` padding) is reserved for genuinely discrete listings: a goal, a stat summary. Checklist rows (today's focus, habits) are NOT cards — they're plain rows separated by a 1px 6%-opacity hairline, tighter than a card would allow, because they're a repeating list, not discrete objects.

## Icons
Hand-drawn inline SVGs in this prototype (24×24 viewbox, ~1.7 stroke weight, rounded caps/joins, no fill except solid glyphs like the flame/sparkle/target-dot). Recommend replacing with a real icon set in production — a small set of Feather/Lucide-style line icons matches this weight and would need no restyling. Icons used: home, target (bullseye), compass, check-square, heart, book, quote marks, sparkle (AI), sliders (settings), flame (streak), plus-circle, chevron.

## Navigation Shell
- **Top bar**: sticky, `space-3`/`space-4` padding, hamburger icon button (opens drawer) on the left, current screen title center-left (`font-heading` 600 18px), today's date right-aligned (11px, 55%-opacity text).
- **Drawer**: slides in from the left over a scrim, 78% width capped at 300px, `--color-surface` background, `shadow-lg`. Lists all 9 destinations as icon+label rows (26×26px icon badge + 14px label). Active row: `accent-100` row background, `accent-800` text/icon, icon badge `accent-200`, 600 weight. Inactive: transparent, default text, `neutral-200` icon badge, 400 weight. Tapping the scrim or a row closes the drawer.
- **AI Guide launcher**: 52px circular floating button, bottom-right, `--color-accent` fill, sparkle icon, `shadow-md`, sits above content on every screen.
- **AI Guide sheet**: bottom sheet sliding up over the content, 80% max-height, `16px 16px 0 0` radius, header with title + close (×), scrollable message list (chat bubbles: incoming = `surface` fill; outgoing = `accent-100` fill / `accent-800` text, right-aligned, 88% max-width), footer input row (`.input` + circular primary send button).

## Screens

### 1. Dashboard (home)
**Purpose**: readable in ~5 seconds — today's priorities, habits, and a progress pulse.
**Layout** (single column, `space-4` side padding):
1. Eyecatcher line "Good morning" (12px uppercase, 55%-opacity) + h1 "Here's today." (26px).
2. **Stat row**: 2×2 grid, `space-2` gap, 4 cards — Progress (%), Focus (done/total), Habits (done/total), Active goals (count). Each: `card-kicker` label + big number (24px, 600 weight).
3. **Today's focus** (h6 eyecatcher): rows of the day's top-3 priority items — pulled from the weekly-tier goals. Each row: 22px circular checkbox (tap to toggle; filled `accent` + white check when done, done items get 50%-opacity strikethrough title), title (15px, 600, `font-heading`), area subtitle (11px, muted), priority tag pill on the right (see priority tag colors above).
4. **Today's habits**: same row pattern as focus items but with a streak counter (flame icon + day count, `accent-700`) instead of a priority tag; hairline row separators.
5. **This week's goals**: monthly-tier goals as label + % row + thin (6px) progress bar underneath.
6. **Annual goals** card: card containing 3 thin progress bars (one per annual goal), each with an 11px label above.
7. **Focus areas**: status rows — colored dot (green = on track, orange = neglected) + area name + short status text (e.g. "Quiet for 3 weeks").
8. **Quick actions**: row of 3 secondary buttons with icons — "Priority", "Log mood", "Log habit".
9. **Daily wisdom quote**: italic pull-quote (16px) + attribution (12px, muted), separated from quick actions by a single hairline top border (the one deliberate divider on the page, marking the day's close).

### 2. Goals
**Purpose**: the tiered goal system — annual → monthly → weekly, with progress rollup and reflection notes.
**Layout**:
1. h1 "Goals".
2. Segmented control (3 native-radio options): Annual / Monthly / Weekly — filters the list below.
3. List of goal cards (`.card`, `shadow-sm`, stacked with `space-3` gap). Each card:
   - Optional parent breadcrumb line above the title: `↳ {parent goal title}` (11px, muted) — only for monthly/weekly items.
   - Title (card-title, 17px) + priority tag pill, in a row.
   - Thin progress bar (6px).
   - Meta row (11px, muted): "{progress}% complete · Due {date} · {focus area}".
   - Tapping the card expands it in place to show: success criteria line, and — for goals that have them — a two-column "What worked" / "What didn't work" notes section (10.5px uppercase labels in `accent-700` / `accent-2-700`, 12.5px body text at 85% opacity).
4. "New {tier} goal" full-width secondary button pinned at the bottom of the list.

**Data shape per goal**: id, tier (annual/monthly/weekly), parent id (nullable), title, focus area, priority (high/medium/low), progress %, target date, success criteria text, notes.worked, notes.didntWork.

### 3. Habits
**Purpose**: daily check-off, streaks, and consistency at a glance.
**Layout**:
1. h1 "Habits".
2. **Today** section: same checkbox-row pattern as Dashboard's habit list (checkbox, name, area subtitle, streak badge).
3. **This week** section: a 7-day completion grid — header row of single-letter day labels (M T W T F S S), then one row per habit: habit name (truncates with ellipsis) + 7 dots (14px circles, filled `accent` if completed that day, `neutral-200` if not).
4. **Consistency, last 14 days**: a simple bar chart — 14 thin bars, height mapped to that day's completion %, `accent-300` fill, 56px chart height, no axis labels (illustrative, not interactive).

**Data shape per habit**: id, name, focus area, current streak (days), doneToday (bool), last-7-days completion array.

## Interactions & Behavior
- Drawer: hamburger toggles open/closed; scrim click or row tap closes it and (for a nav row) navigates.
- AI sheet: launcher button toggles open/closed; header × also closes.
- Goals tabs: radio-style segmented control, single-select, filters the visible list — no page reload.
- Goal card tap: toggles that card's expanded state; only inline expand, no modal/navigation.
- Checkboxes (focus items, habits): tap toggles done/not-done instantly, optimistic, no confirmation. Completing an item should feel quiet — a subtle fill + check, no motion beyond a fast (~150ms) transition; avoid celebratory animation for routine checks per the product's "earned and understated" tone. Milestone celebrations (streak milestones, goal completion) aren't designed yet — flag for a follow-up design pass before implementing anything more than a quiet badge/color change.
- All transitions should be CSS-based and under ~200ms (drawer slide, sheet slide, hover/press states) per the performance constraint.
- Placeholder screens (Focus Areas, How You Feel, Reflection, Wisdom Library, Settings): centered icon + screen name + "not part of this design pass" note + "Back to Dashboard" ghost button. These are stand-ins only — real layouts are still needed.

## Accessibility notes
- Maintain 2px accent `:focus-visible` outlines on every interactive element (checkboxes, nav rows, tabs, buttons, inputs) — never rely on browser default focus.
- Checkbox and nav row hit targets should be at least 44×44px in the real build even though the prototype's visual circle is 22px — pad the tappable area.
- Text on tinted fills (tags, chat bubbles) uses the deep ramp step (700/800) specifically to clear 4.5:1 contrast on the light tint backgrounds — don't substitute the base accent color for small text.

## Assets
No photography or custom illustration in this design. All icons are inline hand-drawn SVGs (see Icons section) — swap for a real icon library in production. Font: Inter via Google Fonts.

## Files
- `Almanac.dc.html` — the interactive HTML prototype covering Dashboard, Goals, Habits, the nav drawer, and the AI Guide sheet. Open directly in a browser. View source for exact markup/inline-style values not called out numerically above.
- `screenshots/` — static captures of each screen/state for quick reference:
  - `01-dashboard.png`
  - `02-goals-annual-expanded.png` — Goals, Annual tab, first card expanded showing the What worked / What didn't notes
  - `03-goals-monthly.png` — Goals, Monthly tab, with parent-goal breadcrumbs
  - `04-habits.png` — Today checklist, weekly grid, and consistency chart
  - `05-nav-drawer.png` — the open navigation drawer over the Habits screen
  - `06-ai-guide-sheet.png` — the AI Guide bottom sheet, open with a sample conversation
  - `07-placeholder-screen.png` — the stand-in state for the five screens not yet designed (Settings shown)
