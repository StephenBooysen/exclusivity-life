# Handoff: Cachet — vetted membership dating app (14 screens)

## Overview

Cachet is an invitation-grade dating platform with human-reviewed admission on both sides. Men subscribe; women ("Select" side) join free after vetting. This package documents **14 mobile screens** covering the full member journey on both sides: the public door, application and vetting, tier checkout, daily introductions, profile detail, matches, messaging, and the interest/availability taxonomy added on top of the base PRD.

The product rules that drive nearly every UI decision:

1. **The bar at the door is the product** — verification and curation are made visible on every screen.
2. **She controls contact** — no man reaches a woman's inbox without her explicit like-back. No paid override, at any tier.
3. **Badges are evidence, never purchases.**
4. **No money moves between members.** The only payment flow is member → platform.
5. **No algorithmic attractiveness scoring** anywhere in ranking or display.

## About the design files

The files in `design/` are **design references created in HTML** — prototypes that show intended look, copy and behaviour. They are **not production code to copy directly**. `Cachet Mockups.dc.html` is a static, non-interactive artboard: 14 phone-sized panels laid out side by side on one canvas, so the whole flow can be read at once. There are no click handlers, no routing and no state in it.

The task is to **recreate these screens in the target codebase's own environment** using its established patterns. The PRD (`reference/Product Requirements.md`) specifies a mobile-first PWA on a native-JS Express stack with no build step (`nooblyjs-core`); if you are implementing against that, build these as server-rendered views + progressive enhancement rather than importing a framework. If no environment exists yet, choose the framework that fits the PRD's constraints and implement there.

## Fidelity

**High-fidelity.** Colours, typography, spacing, copy and component structure are final-intent and specified exactly below. Recreate pixel-close using the codebase's own component library where equivalents exist. Two deliberate exceptions:

- **All photography is placeholder** — the hatched steel-blue frames marked "duotone" stand in for real member photos. Real images must be wrapped in the design system's `.duotone` treatment (desaturate + accent colour wash).
- **Icons are text stand-ins** (`←`, `⋯`, `✓`, `›`). Replace with **Lucide icons at stroke-width 1.5**.

## Design tokens

The design system is **Industry** — a wireframe/blueprint aesthetic, inverted here onto a dark ground. `design/_ds/industry-…/styles.css` is the source of truth for the base tokens and component classes; the dark inversion is the `:root` override block in the `<helmet>` of the mockup file.

### Colour

| Role | Value | Use |
|---|---|---|
| Canvas / page ground | `#0a0c0d` | Behind everything (`html` + `body`) |
| Screen surface | `#0e1113` | Every phone screen's own background; also list-row backgrounds sitting on a 1px divider grid |
| Text | `#e7ebef` | Primary text |
| Text 78% | `rgba(231,235,239,.78)` | Secondary body copy |
| Text 60/55% | `rgba(231,235,239,.6)` / `.55` | Supporting copy, descriptions |
| Text 45/42/40% | `rgba(231,235,239,.45)` / `.42` / `.4` | Meta, timestamps, eyebrow labels, legal notes |
| Text 35/32% | `rgba(231,235,239,.35)` / `.32` | Faintest hints (allowance note, chat disclaimer) |
| Accent (steel) | `#8fb3d6` | Primary buttons, active tab, eyebrows, section labels, checkbox fill, badges ✓ |
| Accent hover | `#a8c4de` | Hover, emphasised numerals |
| Accent pressed / bright | `#c2d6e9` | Pressed state, highlighted badge title |
| Accent tint (fill) | `rgba(143,179,214,.06)` – `.16` | Selected tier card, outgoing chat bubble, tag-accent chip background |
| Divider (standard) | `rgba(231,235,239,.13)` | Section rules, tab bar top border, panel footers |
| Divider (grid gap) | `rgba(231,235,239,.10)` – `.12` | The 1px "grid" behind stacked list rows |
| Border (input/checkbox) | `rgba(231,235,239,.22)` – `.28` | Unselected chips, unchecked boxes, dashed upload slots |
| Photo placeholder | `#141c25` + `repeating-linear-gradient(45deg, rgba(143,179,214,.14) 0 1px, transparent 1px 10px)` | Stand-in for duotone imagery |
| Scrim | `rgba(10,12,13,.72)` | Bottom-sheet backdrop (B3) |

Do **not** introduce any hue other than the steel accent. There is no success-green, no danger-red: destructive actions (Unmatch, Block) are plain text rows.

### Type

- Headings: **Barlow Condensed**, weight 600, `letter-spacing: -0.01em` to `-0.02em` on large sizes, `line-height: 1.02–1.2`.
- Body: **Barlow**, weight 400 (500 for the status bar), `line-height: 1.5–1.6`.
- Eyebrow / label style: Barlow 400, **9.5–11px**, `letter-spacing: .18–.24em`, `text-transform: uppercase`.

| Element | Size / weight |
|---|---|
| Screen H1 (page title inside phone) | 29–34px Condensed 600 |
| Profile name | 32px Condensed 600 (age beside it: 19px Barlow, 50% text) |
| Card name (deck) | 24–26px Condensed 600 (age 16–17px, 50%) |
| Section heading in-screen | 19–22px Condensed 600 |
| Row title | 14–16px Condensed 600 |
| Body copy | 12.5–14px Barlow |
| Chat bubble | 13.5px Barlow, line-height 1.5 |
| Meta / timestamp | 11–12px Barlow |
| Legal / disclaimer | 10.5–11px Barlow, line-height 1.5 |
| Button label | 13–15px Condensed 600 |
| Tab bar label | 10px Condensed 600, `.16em`, uppercase |

### Spacing, geometry, elevation

- Screen frame: **390 × 844** (iPhone logical size), `overflow: hidden`, no rounded corners.
- Standard horizontal page gutter: **22px** (chat header/footer use 20px).
- Vertical rhythm: 6 / 9 / 12 / 14 / 18 / 22 / 26 / 30 / 38px.
- **Border radius: 0 everywhere.** Buttons, cards, chips, inputs, photos, bubbles — all square. This is non-negotiable in this system.
- No shadows. Depth comes from hairline borders and the 1px divider grid.
- **Blueprint frame**: every card, figure and framed object is a 1px `rgba(231,235,239,.13)` border plus four `+` registration marks at the corners (the design system's `.blueprint` + four `<i class="corner tl|tr|bl|br">` children — marks are 11px, drawn 6px *outside* the box, coloured 55% of text). Never drop the marks; never fill a card with a surface colour. The one solid object per screen is the primary button.
- Hit targets: buttons 40–56px tall, tab bar items 60px, list rows ≥44px.

### Component classes (from `styles.css`)

`.btn` + `.btn-primary` (solid accent fill, text `#0e1113`) / `.btn-secondary` (hairline outline) / `.btn-block`; `.tag` + `.tag-accent` (accent tint chip) / `.tag-neutral` / `.tag-outline`; `.input`; `.blueprint` + `.corner`; `.duotone`. Focus is a 2px accent `:focus-visible` outline at 2px offset — never a browser default.

---

## Screens

Panels are labelled on the canvas with a badge (`A1`…`A10`, `B0`…`B3`) and carry a `data-screen-label` attribute in the source. Group **A** is Marcus (male applicant → Elite subscriber). Group **B** is Lerato (Select side, free).

Every in-product screen (A6, A8, B1) ends with a 3-item tab bar: **INTROS · MATCHES · ACCOUNT**, 60px tall, 1px top divider, active item accent-coloured with a 2px accent bottom border.

Every screen starts with a mock status bar (14px top padding, 22px sides, 11px Barlow 500 at 45% text): time on the left, `5G · 84%` or `Wi-Fi · 51%` on the right. **Do not build this** — it's the device's own bar.

---

### A1 — Landing / the door
**Purpose:** convert a visitor into an applicant, and set expectations before they invest effort.

Layout (top → bottom): status bar → hero placeholder (`height: 352px`, `margin: 26px 22px 0`, 1px border) → content block (`padding: 30px 22px 0`, flex column, `flex: 1`) → footer pinned with `margin-top: auto`, `padding-bottom: 26px`.

- Wordmark: "CACHET", 11px Condensed 600, `.34em` tracking, uppercase, accent.
- Headline: "Membership,<br>by review." 40px Condensed 600, `line-height 1.02`, `-0.02em`.
- Sub: "Both sides apply. A person decides. Johannesburg." 14px, 58% text, `max-width: 30ch`.
- Trust row: `48h decision · Identity verified · No public profiles` — 11px, 42% text, flex with 18px gaps, `·` as separate spans.
- Primary: **Apply for membership**, 52px tall, 15px, `.04em`.
- Secondary: **Sign in**, 48px tall, outlined.

**Behaviour:** Apply → registration (email + password, or Google OAuth; account created `pending`, F1.1) → **A2 must be shown before any data is collected** (F1.2). Sign in → auth. Copy on this screen must position on curation and verification, never on provision (PRD §2).

---

### A2 — Criteria disclosure (F1.2)
**Purpose:** state the bar, in plain language, by side, before collecting anything.

Layout: status bar → back row (`←` 20px + eyebrow "BEFORE YOU BEGIN") → title block (`padding: 26px 22px 0`) → 4-row numbered list → footer pinned bottom.

- Title "What we assess" 31px; sub "These four, in this order. Nothing hidden, nothing else." 13.5px, 55%.
- The list is the **divider-grid pattern**: a flex column with `gap: 1px` on a `rgba(231,235,239,.12)` background and a 1px border of the same colour; each row is `background: #0e1113; padding: 16px`. The 1px gaps read as hairline rules. Use this pattern for every stacked list in this design.
- Each row: index `01`–`04` in 11px accent, then title (16px Condensed 600) + description (12.5px, 55%).
  1. **Identity** — "A liveness selfie, matched to your photos. Held 90 days, then deleted."
  2. **Photos** — "Three to six. One face, unobscured. Location data stripped on upload."
  3. **Standing** + `MEN ONLY` outline chip inline — "A twenty-minute call. **No bank statements, ever.**" (second sentence in `#a8c4de`)
  4. **A complete profile** — "Read by a reviewer against a written rubric. Never scored by a model."
- Footer note: 2px accent left border, 14px left padding — "A human reviews this. Decision inside 48 hours, with a reason."
- Primary block button: **Begin application**, 52px.

**Behaviour:** row 3 renders only for male applicants; the female variant swaps it for the photo-standards criterion. Both sides must be told exactly which criteria apply to them (PRD §2, "no hidden bar").

---

### A3 — Application step: photographs + liveness (F1.4, F1.5)
**Purpose:** upload 3–6 photos and complete the liveness selfie.

- Back row with a right-aligned "Saved" indicator (12px, 50%) — the application autosaves and is resumable (F1.7).
- **Progress:** 7 equal `flex: 1` bars, 2px tall, 5px gap; first 4 accent, rest `rgba(231,235,239,.16)`. Below it, eyebrow "STEP 4 OF 7".
- Title "Photographs" 29px; sub "Three minimum. One must show your face, unobscured." 13px.
- **Upload grid:** `grid-template-columns: repeat(3,1fr)`, `gap: 9px`, cells `aspect-ratio: 3/4`. Filled cells are photo placeholders (first has an accent-40% border and the label "1 · FACE"); empty cells are `1px dashed rgba(231,235,239,.22)` with a centred 20px `+`.
- Meta row under the grid: "3 of 6 uploaded" (left) / "JPEG · PNG · HEIC · 12 MB" (right), 11px 38%.
- **Liveness card** (blueprint, 16px padding, 26px above): 62×62 selfie placeholder + "Liveness check" (15px Condensed) + "A prompted pose. Matched to the photos above, then deleted at 90 days."
- Reassurance line: accent `✓` + "Location data is removed from every upload." 11.5px.
- Footer: **Save & exit** (`flex: 1`) + **Continue** (`flex: 2`), both 52px, 10px gap.

**Behaviour / rules:** EXIF including GPS stripped server-side on ingest; derived sizes generated; originals never reachable from an unauthenticated URL (F1.4 acceptance). Continue is disabled until 3 photos and one face-unobscured flag are present. Photo moderation happens before anything goes live (F7.5).

---

### A4 — Under review, with the interview gate (F2.3a, F2.3b)
**Purpose:** tell the applicant where they are, and make the mandatory interview unmissable.

- Header block (`padding: 44px 22px 0`): eyebrow "APPLICATION 4172" in accent; title "Under review" 34px; "Submitted 21/08 · 21:19. Decision expected by 23/08." 13.5px 55%.
- **Timeline** (`padding: 38px 22px 0`): each step is a flex row, `gap: 16px`; left rail is a 9×9 square marker (`margin-top: 5px`) plus a 1px vertical connector (`flex: 1`, `rgba(231,235,239,.16)`); right column has title (15px Condensed) + meta (12px 45%) and `padding-bottom: 26px`.
  - **Submitted** — filled accent marker — "21/08 · 21:19"
  - **Pre-screen cleared** — filled accent marker — "Automatic · no flags"
  - **Introductory call** — *outlined accent* marker, title in `#a8c4de` — "Thu 23/08 · 14:30 · 20 minutes", followed by a nested blueprint card: "Approval is not possible until this call is recorded as passed. It is how standing is established — there are no documents to send." + two 40px buttons, **Reschedule** (secondary) / **Add to calendar** (primary).
  - **Decision** — outlined 30%-white marker, title at 50% — "By email and in app"
- Footer: two links, "Withdraw application" (F1.10) / "Safety Centre" (F7.6).

**Behaviour:** the approve action is refused server-side (HTTP 409 `interview_required`) until an interview is recorded **passed** for any side that requires one — enforce in the API, not by hiding a button (F2.3b). Outcome values: passed / not passed / no show. Withdraw deletes the submission and all uploads.

---

### A5 — Tier selection after approval (F6.1, §5.1)
**Purpose:** a male member picks a tier and checks out before entering the product.

- Header: eyebrow "APPROVED · 23/08"; "Choose a membership" 30px; "Tiers buy volume, filters and discretion. Nothing else." 13px 50%.
- Three blueprint cards, 12px apart:
  - **Signature** — R899 /mo — "5 introductions daily · 10 likes". Title and price both 19px Condensed; the `/mo` suffix is 12px at 45%.
  - **Elite (selected)** — R2 499 /mo — border `#8fb3d6`, background `rgba(143,179,214,.06)`, price in `#a8c4de`, title 22px, `SELECTED` accent chip beside it. Feature grid `repeat(2,1fr)`, `gap: 6px 14px`, 12.5px at 70%: 12 introductions daily · 40 likes · Who liked you · Advanced filters · Travel mode · Read receipts · 2 boosts / month · 24h support. Foot note: "3-month and 12-month terms available at a discount."
  - **Noir** — `opacity: .62`, price replaced by "INVITATION" (12px, `.14em`, uppercase) — "Issued by the house. Not available at checkout."
- Footer note: "No tier buys a badge, an inbox, or a reversed decision. Cancel in two taps, effective at period end." Then primary block button **Continue · R2 499 / month**.

**Behaviour:** selection is single-choice; Noir is not selectable (invite-code only, F9.5). Checkout runs through a provider-abstracted `billingService`, stub provider by default, Stripe in production; no card data touches Cachet servers (F6.2). Entitlements are evaluated **server-side on every gated action** — a client claiming Noir still gets a 5-card deck (F6.4 acceptance). Cancellation must be two clicks with at most one optional reason question (F6.5).

---

### A6 — Daily introductions deck (F4.1, F4.4, F4.6)
**Purpose:** the core loop — a small, finite set of curated introductions.

- Header row: left "Today" (20px Condensed) + "Refreshed 06:00 · Elite" (11.5px 45%); right, allowance as `8/12` — the `8` in 20px `#a8c4de`, the `/12` at 35% — with "remaining" beneath.
- **Card** (blueprint, `flex: 1`): portrait placeholder fills the remaining height (`flex: 1; min-height: 0`), then an info block (`padding: 16px 16px 18px`, 1px top divider):
  - Name 26px + age 17px at 50%
  - "In-house counsel · 5–15 km" 13px 62% — occupation and **distance band only** (`<5 km`, `5–15 km`, `15–50 km`, `50 km+`); precise coordinates are never returned by any API (F3.3)
  - Verification chips: `IDENTITY VERIFIED`, `PHOTO VERIFIED` (`.tag-accent`)
  - Interest chips, 7px below: `Just dating`, `Girlfriend` (`.tag-outline`) — see "Interest taxonomy"
  - Prompt quote 13px 58%
- Actions: **Pass** (secondary) / **Like** (primary), both 56px, `flex: 1`, 12px gap.
- Hint under actions, centred, 11px 35%: "Passes are unlimited. A like is spent from today's 12."

**Behaviour:** deck generated nightly, sized by tier, refreshed 06:00 local (F4.1). Candidate filter: mutual gender preference, both active+approved, mutual age ranges, distance preference, not previously acted on, not blocked in either direction, not suspended (F4.2). Ranking is a documented score — preference fit, reciprocity likelihood, profile completeness, verification depth, recency, diversity term — **and no attractiveness model** (F4.3). Allowances reset 00:00 local; the remaining count must be shown *before* exhaustion, read from the same server source of truth; a like past the allowance returns HTTP 429 `allowance_exhausted` (F4.6). A mutual like creates a match and opens a conversation, notifying both sides (F4.5).

---

### A7 — Profile detail (F3)
**Purpose:** the full profile, with verification evidence legible.

- Photo header: 300px placeholder, `position: relative`, with `←` and `⋯` overlaid at `padding: 16px 18px`, and a 5-segment progress indicator bottom-left (22×2px bars, first solid white, rest 35%).
- Body (`padding: 22px 22px 0`, `flex: 1`, `overflow: hidden`): name 32px + age 19px; two meta lines at 13px 60% — "In-house counsel · LLB, Wits · 172 cm" and "Sandton · 5–15 km · Something serious".
- **Badge table** (divider grid, 20px above): each row `padding: 12px 14px`, `space-between`; title 14px Condensed, evidence line 11px at 45%, accent `✓` on the right.
  - Identity verified — "Liveness match · 12/08"
  - Photo verified — "Reviewer, human · 12/08"
  - Means verified — title and meta dimmed, right glyph `—`, meta "Not applicable — Select side"
- Prompt block: eyebrow "A DINNER I WOULD REPEAT" + answer 14px at 80%.
- Below that, further photos continue in the scroll (the mockup shows the next one clipped at the fold, deliberately).
- Footer bar (1px top divider): text links **Block** / **Report** at 12px 50%, then primary **Like** pushed right (48px, 34px inline padding).

**Behaviour:** first name only, age derived (never DOB), city + distance band only, no public URL and nothing indexable (F3.1, F3.4). Every badge stores evidence type, granting reviewer and date, and is revocable (F2.8). Edits to photos/bio re-enter moderation with the previous version staying live until the new one clears (F3.2).

---

### A8 — Matches (F5.7, F4.8)
**Purpose:** the inbox — what's new, what's waiting, who liked you.

- Header: "Matches" 28px + "Three open · one awaiting a first message" 11.5px 45%.
- **New match** as a highlighted blueprint row (`margin: 0 22px 14px`, `padding: 14px`, border `rgba(143,179,214,.5)`): 56×70 photo + name 17px Condensed + `NEW` accent chip + "Matched 19:41 · say something in 7 days".
- **Conversation rows** in the divider grid, 48×60 photo, name 16px Condensed, right-aligned timestamp 11px 40%, preview 12.5px 50% with `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`. Read state appears as the preview text "Read 21:02".
- **Liked you** strip (34px above, 1px top divider, 20px padding-top): eyebrow "LIKED YOU · 6", then 70×88 tiles with a final dashed `+3` tile.

**Behaviour:** a match expires if no message within 7 days, with a reminder at 5 days; expiry removes it from both inboxes (F5.7). "Who liked you" is Elite+ on the male side and always available on Select (F4.8); liking back from it creates an immediate match. Blocked members never appear here in either direction (F4.2 acceptance).

---

### A9 — Conversation (F5.2, F5.6)
**Purpose:** match-gated real-time messaging.

- Header (`padding: 16px 20px`, 1px bottom divider): `←`, 34×34 avatar, name 16px Condensed + "Matched today" 11px 42%, `⋯` right.
- Thread (`flex: 1`, `padding: 20px`, `gap: 12px`, flex column):
  - System line, centred, 11px 35%: "You matched at 19:41. Either of you can end this at any time."
  - Incoming bubble: `align-self: flex-start`, `max-width: 76%`, 1px `rgba(231,235,239,.15)` border, transparent fill, `padding: 11px 13px`, 13.5px/1.5.
  - Outgoing bubble: `align-self: flex-end`, background `rgba(143,179,214,.16)`, border `rgba(143,179,214,.4)`, same metrics.
  - Read receipt: right-aligned 10.5px at 38% — "Read 19:50". Typing indicator: left-aligned 10.5px at 30% — "typing…".
- Composer (1px top divider, `padding: 14px 20px 20px`): `.input` at `min-height: 44px` with placeholder "Message" + **Send** primary (44px, 20px inline padding).
- Disclaimer, 10.5px 32%: "Keep it on Cachet. Requests to move to another app, or for money, are reviewed."

**Behaviour:** messaging exists only between matched members — every send path (REST and socket) independently verifies an active, non-blocked match; a forged match id returns 403 (F5.1 acceptance). Delivery state, ordered history, pagination (F5.2). First messages are scanned for external-contact and transactional language: **flag for review, do not block** — pattern set tunable without deploy (F5.3, F7.4). Read receipts are reciprocal — a member who cannot show them cannot see them (F5.6). Typing/presence individually disableable (F5.8). Burst and daily rate caps server-side; suspended members cannot send (F5.5).

---

### A10 — "What are you looking for?" (paying member's interest filter) **[new, beyond the PRD]**
**Purpose:** let a paying member choose which of the interest categories his deck is drawn from.

- Back row + eyebrow "DISCOVERY · ELITE".
- Title "What are you looking for?" 29px; sub "Your deck is built only from members who chose the same. Selecting more widens it; selecting one narrows it hard." 12.5px 55%.
- Four groups (`gap: 18px`), each an accent eyebrow (9.5px, `.2em`, uppercase) over a wrapping chip row (`gap: 8px`):
  - **HOUSEHOLD** — Nanny · Au pair
  - **BUSINESS** — Discrete PA
  - **SOCIAL** — Atmosphere model · Model
  - **DATING** — Just dating · Friends with benefits · Girlfriend · Fiancé
  - Chip, unselected: 1px `rgba(231,235,239,.22)` border, text 70%, `padding: 7px 13px`, 12.5px. Selected: solid `#8fb3d6` fill, text `#0e1113`, trailing `✓`.
- **Result card** (blueprint, pinned with `margin-top: auto`): "214 members match" 15px Condensed + "Johannesburg · 15–50 km · 24–36" 11px 45%, with a `4 SELECTED` accent chip on the right.
- Footer note: "Interest filters are Elite and above. They change who you see — never who may message you." Then **Save preferences** (50px block primary).

**Behaviour:** multi-select, zero-selection state = no filter (all categories). The match count recomputes on every toggle (debounced server count query — never a client-side guess, since the pool is not fully loaded). Because this is a **tier-gated filter (Elite and above)**, gating must be enforced server-side like every other entitlement (F6.4). Selecting a category must **not** affect who may message whom.

---

### B0 — Select-side registration: "What are you open to?" **[new, beyond the PRD]**
**Purpose:** the female applicant declares which categories she is open to, during onboarding.

- Back row + right-aligned "Saved".
- Progress: 7 bars, first **6** accent; eyebrow "STEP 6 OF 7".
- Title "What are you open to?" 29px; sub "Choose any. Only members whose interests overlap yours will see you." 12.5px 55%.
- **Grouped checkbox list** in the divider grid (`padding: 0 22px`, `flex: 1`, `gap: 1px` on `rgba(231,235,239,.10)`, 1px top divider). Group header rows: 9.5px accent eyebrow, `.2em`, uppercase, `padding: 9–10px 0 4px`. Option rows: `padding: 7px 0`, `gap: 12px`, 14px label.
  - Checkbox, unchecked: 17×17, 1px `rgba(231,235,239,.28)`, square, no fill. Checked: filled `#8fb3d6` with an 11px `#0e1113` `✓`.
  - **HOUSEHOLD** — Nanny · Au pair
  - **BUSINESS** — Discrete PA
  - **SOCIAL** — Atmosphere model *(checked)* · Model
  - **DATING** — Just dating *(checked)* · Friends with benefits · Girlfriend *(checked)* · Fiancé
- Footer (1px top divider): live count + disclaimer, 11px 40% — "Three selected. Cachet takes no part in any arrangement and no money moves between members." Then **Continue** (50px block primary).

**Behaviour:** multi-select, at least one required to continue. Selections are part of the reviewed application — a reviewer sees them on the review screen, and they can be edited later from settings (re-entering moderation if the platform decides to review them, same as bio edits). The declared set is what A10's filter matches against.

**⚠ Compliance note — read before building.** The Household / Business / Social categories describe paid engagements, which cuts directly against PRD §2 (no compensated-dating mechanics) and the three enforceable rules carried into F5.3 and F7.4. Building them has consequences the PRD spells out: Apple Guideline 1.1.4 and Google Play's inappropriate-content policy exclude apps facilitating compensated dating; Stripe and Paystack list it as a restricted business; and FOSTA/SESTA plus SA Sexual Offences Act s.20 bear on intermediary liability. The mockups therefore keep the copy strictly non-transactional ("Cachet takes no part in any arrangement and no money moves between members"), keep these categories out of the messaging gate, and carry no rate, fee or offer field anywhere. **Do not add one.** Get a product/legal decision on whether these categories ship at all before wiring them into discovery.

---

### B1 — Select-side day (F4.8, F4.10)
**Purpose:** her version of the loop — reciprocity first, no upsell anywhere.

- Header: "Today" + "12 introductions · unlimited likes"; an `INCOGNITO` outline chip on the right.
- **Liked you · 4** strip: four 78×98 tiles, `gap: 9px`; hint below, 11px 35%: "Like back and the conversation opens immediately."
- Divider, then eyebrow "INTRODUCTION 1 OF 12" and the same deck card as A6, at slightly smaller type (name 24px, info padding `15px 16px 17px`). His chips: `IDENTITY`, `PHOTO`, `MEANS` (`.tag-accent`) + `PROFESSIONAL` (`.tag-neutral`), then interest chips `Looking for: Just dating`, `Girlfriend` (`.tag-outline`).
- Actions **Pass** / **Like**, 54px.

**Behaviour:** Select accounts are permanently free and **must carry no upsell surface at all** (§5.2). Select gets, by default, everything the paid tiers meter: 12 introductions, unlimited likes, who-liked-you, advanced filters, travel mode, read receipts, incognito. Incognito means she doesn't appear in others' decks or view lists, but her likes still reveal her (F4.10).

---

### B2 — His profile, badges with evidence (F2.8)
**Purpose:** let her judge the verification, not the marketing.

Same structure as A7 with a 290px photo header. Badge table has four rows; the **Means verified** row is emphasised — background `rgba(143,179,214,.08)`, title in `#c2d6e9`, meta "Interview passed · 06/08 · not a payment". Others: "Liveness match · 04/08", "Reviewer, human · 04/08", "Employer confirmed · 06/08". Footer bar: **Block** / **Report** links, then **Pass** (secondary, 22px inline padding) and **Like** (primary, 26px).

**Behaviour:** the "not a payment" meta is a required disclosure, not decoration — badges are never granted for payment at any tier (Principle 4). Means applies to the male side only, from a passed interview (F2.8 acceptance).

---

### B3 — Conversation controls sheet (F5.4, F7.1, F7.2)
**Purpose:** make ending contact trivially easy.

Chat screen behind at `opacity: .4`, under a full-bleed `rgba(10,12,13,.72)` scrim (`position: absolute; inset: 0`, content `align-items: flex-end`). The sheet is `width: 100%`, `background: #0e1113`, 1px top border `rgba(231,235,239,.16)`, `padding: 22px 22px 26px`, with a 38×3px grab handle centred above.

- Title "This conversation" 20px Condensed; sub "No one can message you unless you liked them back. Ending it is immediate and needs no reason." 12.5px 50%.
- Divider-grid rows (`padding: 15px`), each title 14px + description 11px 45%, chevron `›` at 40%:
  - **Unmatch** — "Closes it for both. Cannot be undone."
  - **Block** — "Silent. He is never told, and never appears again."
  - **Report** — "Hidden from you at once, before any decision."
  - **Read receipts** — "On. Reciprocal — off means you cannot see his." Right side shows state "On" in accent.
- **Close** secondary block button, 48px.

**Behaviour:** unmatch closes the conversation for both, removes it from both inboxes, irreversible (F5.4). Block is silent, mutually effective, immediate and permanent unless the blocker reverses it; it must take effect in under a second and on the next request in both directions, including in-flight sockets (F7.1 acceptance). Report opens a category picker — fake profile, harassment, solicitation, offensive content, underage, scam, other — with free text and an optional message reference (F7.2); the reported member is hidden from the reporter immediately, before any moderation decision (F7.8).

---

## Interaction & behaviour summary

| Trigger | Result |
|---|---|
| Apply (A1) | Register → **A2 criteria first** → application steps |
| Continue through steps (A3) | Autosave + resumable; progress bar advances; 18+ hard gate blocks client- and server-side |
| Submit application | Shows 48h window + confirmation email (F1.8) → A4 |
| Approve (admin) | Male → tier selection (A5) → checkout → product; female → straight into product (F2.7) |
| Like (A6/A7/B1) | Decrement allowance from server response; mutual like → match + notify both + open conversation |
| Pass | Unlimited, no allowance effect |
| Allowance exhausted | 429 `allowance_exhausted`; UI shows the remaining count *before* it runs out |
| Toggle interest chip (A10) | Recompute match count server-side; save on explicit **Save preferences** |
| Check interest option (B0) | Local until Continue; part of the reviewed application |
| Unmatch / Block | Immediate, irreversible (unmatch) / reversible only by blocker (block); both directions |
| Lapsed subscription | Dormant: conversations readable, no new intros or likes, profile hidden from discovery |

**Motion:** minimal and functional — no card-fling animation, no confetti on match, no artificial "activity" pulses (Principle 7, no dark patterns). Honour `prefers-reduced-motion`. Transitions: 120–180ms ease for sheet/scrim and chip state; nothing longer.

**States to build that the mockups don't show:** empty deck ("You've seen today's twelve — the next set arrives at 06:00"), zero matches, loading skeletons (hairline blueprint frames, no shimmer), offline banner (PWA shell serves cached matches and recent messages read-only, queues sends), form errors inline under the field in accent, decline outcome screen (reason category + appeal path, never reviewer identity or internal flags, F2.6), dormant/paused state, suspended state.

## State model (per screen)

- **Application:** `{ status: 'draft'|'pending'|'interview_scheduled'|'approved'|'waitlisted'|'declined', step: 1..7, fields, photos[], livenessSelfie, meansDeclaration, interestCategories[], invitedBy? }`
- **Session/member:** `{ memberRef, side: 'male'|'select', state: 'pending'|'active'|'dormant'|'paused'|'suspended', tier, badges[], entitlements }` — entitlements always **from the server**.
- **Deck:** `{ date, cards[], size, likesRemaining, likesAllowance, refreshAt }`
- **Match/conversation:** `{ matchId, participants, createdAt, expiresAt, lastMessage, unread, readReceiptsEnabled }`
- **Discovery prefs:** `{ ageRange, distanceBand, city, travelMode?, incognito?, interestCategories[] }`
- **Sheet UI:** `{ open: boolean, target: matchId }`

Data fetching: deck on session start (server-generated nightly), matches list on tab focus, messages via socket with REST pagination fallback, entitlements on every gated action.

## Interest taxonomy (single source of truth)

```
household : nanny, au_pair
business  : discrete_pa
social    : atmosphere_model, model
dating    : just_dating, friends_with_benefits, girlfriend, fiance
```

Both sides store an array of these keys. Deck eligibility requires a non-empty intersection between the viewer's selected set (A10) and the candidate's declared set (B0), on top of every existing F4.2 filter. Display labels are exactly as written on the screens (note "Discrete PA", "Fiancé", "Friends with benefits"). See the compliance note under B0 before implementing.

## Accessibility

WCAG 2.2 AA per PRD §8. Points that need attention in this palette: the accent `#8fb3d6` on `#0e1113` is fine for large text, chrome and icons but **body copy in accent must not be used**; the 32–40% text opacities are legal only at 11px+ *and* only for non-essential meta — if a string carries meaning, lift it to 55%+. Keyboard: every row and chip is a real control (`<button>`, `<input type="checkbox">` + label), 2px accent `:focus-visible` ring at 2px offset. Screen readers: deck cards announce name, age, occupation, distance band, verification badges and interest categories in that order; chat is a live region; the B3 sheet is a focus-trapped dialog with a labelled close.

## Assets

- **Photography: none supplied.** Every image is a hatched placeholder. Real photos go through the design system's `.duotone` wrapper (desaturate + accent colour wash) and must be square-framed with registration marks — never rounded, never clipped to a circle.
- **Icons: none supplied.** Use Lucide at stroke-width 1.5. Needed: chevron-left, more-horizontal, check, chevron-right, plus, camera, shield-check, calendar, heart or thumb equivalents for like/pass (or keep text buttons as drawn — preferred).
- **Fonts:** Barlow + Barlow Condensed (Google Fonts, weights 400/500/600/700). Self-host for the PWA offline shell.

## Files in this bundle

```
README.md                                   this document
design/Cachet Mockups.dc.html               the 14-screen artboard (open in a browser)
design/support.js                           runtime the artboard needs to render
design/_ds/industry-…/styles.css            design-system tokens + component classes (source of truth)
design/_ds/industry-…/_ds_bundle.js         design-system component bundle
reference/Product Requirements.md           the PRD; F-numbers cited above refer to its §7
```

Open `design/Cachet Mockups.dc.html` directly in a browser; it needs no server. Screen panels are labelled A1–A10 and B0–B3, matching the sections above.
