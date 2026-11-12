
# Handoff: Wealth & Finance Management App (Mobile)

## Overview
A mobile web app for daily personal finance and long-range wealth planning: track credit cards, loans, home loan/mortgage, debit orders, everyday expenses, savings, and retirement funds, and project net worth from today to age 90 under different growth scenarios. Currency: ZAR (South African Rand). Sample user: Sarah Naidoo.

## About the Design Files
The files in this bundle (`Wealth Dashboard.dc.html` and the screenshots) are **design references built as an HTML prototype** — they show intended look, content, and interaction, not production code to copy directly. The task is to **recreate this design in the target codebase's existing environment** (React Native, Flutter, native iOS/Android, or a web framework — whichever the target project already uses), following that codebase's existing component/state patterns. If no environment/codebase exists yet, choose the framework best suited to a mobile finance app (e.g. React Native or a PWA) and implement there.

## Fidelity
**High-fidelity.** Colors, typography, spacing, copy, and card/list structures shown are final-intent — recreate pixel-close using the target codebase's component library and design tokens (translate hex values below into that system's theme, don't hardcode if a token system exists).

## Screen size / device
Designed at iPhone-standard mobile width, content column ~360px inside a 402×874 device frame. Status bar + bottom tab bar are fixed (not scrollable); the content area between them scrolls independently per tab.

## Global layout
- Fixed header (not part of scroll): greeting "Good morning" (13px, #8A8578) + user name (20px/800, #1C2321) on the left, 40×40 circular avatar (initials, #1F6F5C bg, white text) on the right. Padding: 4px 24px 16px.
- Scrollable content area: 0 24px 24px padding.
- Fixed bottom tab bar: 76px tall, white background, 1px top border #EDEAE2, 5 tabs (icon 22×22 + 10px/700 label), active color #1F6F5C, inactive #B3AFA4.
- 5 tabs: **Home, Accounts, Cash Flow, Wealth, Settings.**

## Design Tokens
**Colors**
- Background (app canvas behind device): #EAE7E0
- Screen background: #F7F5F0
- Primary green (brand/CTA/active): #1F6F5C, darker green #16463A / #164F42
- Text primary: #1C2321
- Text secondary/muted: #8A8578
- Card/border: #fff bg, 1px solid #EDEAE2 border, 18px radius
- Divider between list rows: 1px solid #F2F0EA
- Warning/debt orange: #C4622D (dark), #D6924F / #E0A16B (light accents)
- Success/savings green accent: #3F8F6F
- Dark card (retirement hero): linear-gradient(135deg, #2B2A26, #1C2321), white text
- Net worth hero card: linear-gradient(135deg, #1F6F5C, #16463A), white text, light green accents #A8E6C9 / #C9E4DB
- Danger/logout text: #B4494A

**Typography**: Manrope (400/500/600/700/800), Google Fonts. Headings 20–22px/800. Card values 15–34px/700–800. Body/labels 11–14px, 500–700 weight. Letter-spacing -0.3 to -0.5px on large numerals; +0.5–0.6px on all-caps section labels (12px/700, color #8A8578).

**Radii**: Cards 18px, hero cards 20–24px, pills/chips 20px (full), small controls 10px, avatar/icons 50%/12px.

**Spacing**: Section vertical rhythm ~16–20px between blocks; card internal padding 16–20px; list row padding 12–14px vertical / 16px horizontal.

## Screens / Views

### 1. Home (`01-home.png`)
**Purpose**: At-a-glance net worth, allocation, top accounts, upcoming debits, spending vs budget.
**Layout** (top to bottom, single column):
1. **Net Worth hero card** — green gradient, 24px padding, 24px radius. Label "Total Net Worth" (13px, #C9E4DB). Value "R1,154,160" (34px/800, white). Change pill "▲ 2.4%" (pill bg rgba(255,255,255,0.18), text #A8E6C9) + "this month" caption. Below: inline SVG sparkline (320×48 viewBox, stroke #A8E6C9, 2.5px, rounded caps) showing 12-month trend.
2. **"Where It Sits" breakdown** — section label + white card with 4 rows (label left, value right, 1px divider between): Cash & savings R182,400; Investments & retirement R412,600; Property equity R610,000; Other debt −R50,840 (value + label in orange #C4622D).
3. **"Your Accounts"** section header with "See all" link (12px, #1F6F5C, navigates to Accounts tab) — horizontally scrollable row of 3 account summary cards (168px wide, 18px radius): Credit Card (balance + progress bar vs limit, orange fill), Home Loan (balance + progress bar, green fill, "R14,200/month" caption), Savings (balance + progress bar, teal fill, "8.1% p.a." caption).
4. **"Upcoming Debit Orders"** — white card, list of 3 rows: colored status dot (8px circle) + name + "in N days · date" caption + amount right-aligned. Colors: green dot = home loan, orange = insurance, gray = utility.
5. **"This Month's Spending"** — white card: big value "R18,240" + "of R22,000 budget" caption, progress bar below (green fill at 83%).

### 2. Accounts (`02-accounts.png`)
**Purpose**: Manage/update every account balance and interest rate — the core "spreadsheet replacement" screen.
**Layout**: Page title "Accounts" (22px/800) + "N linked accounts" caption. Then repeating pattern per account-type section: all-caps section label (CREDIT CARDS / LOANS / HOME LOAN / SAVINGS), then one card per account:
- **Collapsed row** (tap to expand/collapse): 40×40 rounded-square icon with 2-letter monogram + tinted bg, name (14px/700) + subtitle (12px, #8A8578, e.g. card last-4 or bank name), balance right-aligned (15px/700) + small caption below it ("owing"/"remaining"/"balance").
- **Expanded state** adds, inside the card below a divider:
  - A 2-column grid of detail fields specific to the account type (credit limit, interest rate, min payment, due date / original amount, installment, remaining term / payoff date / linked goal, etc.)
  - For the Home Loan specifically: an inline tinted callout box (bg #FBEDE3, text #C4622D, 12px) suggesting payoff impact of an extra monthly payment, e.g. "+ R2,000/mo extra → settle 2038, save ~R210,000 interest".
  - An outlined button "Update balance & rate" (1px solid #1F6F5C border, #1F6F5C text, 10px radius, full width, centered) that reveals:
  - **Edit mode**: two side-by-side number inputs (Balance, Interest rate %) with a "Save" button (solid #1F6F5C bg, white text) below. Saving collapses the edit form and updates the displayed balance/rate immediately.
- Accounts shown: Discovery Card (credit card), Personal Loan/Standard Bank, Home Loan/Absa (with equity % badge), Savings Account (32-day notice).

### 3. Cash Flow (`03-cashflow-orders.png`, `04-cashflow-spending.png`)
**Purpose**: Track recurring debit orders and log/monitor day-to-day discretionary spending.
**Layout**:
1. Page title "Cash Flow".
2. **Income/allocation summary card**: "Income" label + value "R58,000" top row; a single segmented horizontal bar (9px tall, rounded) split into 3 proportional segments — debit orders (green), spent (orange), left (light gray) — with a legend row below showing each segment's label + amount.
3. **Segmented control** ("Debit Orders" / "Spending" tabs) — pill-shaped container (#EDEAE2 bg), active segment white bg + dark text, inactive transparent + muted text.
4. **Debit Orders tab**: white card, list of recurring line items grouped under implicit categories (bank/insurance, subscriptions) — each row: name (14px/600) + frequency/date caption (12px, muted) + amount right-aligned (14px/700). Ends with a dark summary bar (#1C2321 bg, white text) showing "Total monthly commitments" + total.
5. **Spending tab**:
   - Donut chart card: conic-gradient SVG-free CSS donut (110px), center shows total spend + "this month" caption; a legend list beside it (colored square + category + percentage) for top 3 categories.
   - **"Log an expense" inline form** (appears on demand, not shown by default): bordered card (border #1F6F5C) with Description text input, Amount number input, Cancel/Add buttons.
   - Full itemized expense list below (white card, one row per expense: colored square + name + amount).
   - Primary CTA button "+ Log an Expense" (solid #1F6F5C, white text, full width, 14px radius) at the bottom — tapping opens the inline form above the list.
   - **This is the daily-expense-entry flow**: user taps the CTA, types a description + amount, taps Add — the new row appends to the list and the running total updates immediately. No categories/receipt photo in this version — keep it a 2-field quick-entry to match how the user currently uses a simple spreadsheet row per expense.

### 4. Wealth (`05-wealth-retirement.png`, `06-wealth-projection.png`)
**Purpose**: Monitor retirement fund contributions and project net worth forward to age 90 under different growth assumptions.
**Layout**: Page title "Wealth" + segmented control ("Retirement" / "Projection").
- **Retirement tab**:
  1. Dark hero card (linear-gradient #2B2A26→#1C2321, white text, 20px radius): fund name "Allan Gray Retirement Annuity", value "R412,600" (28px/800), 2-column row: Monthly contribution R6,500 / Years to retirement 30.
  2. Tax-year contributions card: label + "R42,000 / R350,000" + progress bar (green, 12% fill) — visualizing annual tax-deductible contribution headroom.
  3. "Projected at retirement (65)" card: 3 rows, one per growth scenario (Conservative 5% / Moderate 7% / Optimistic 9%) each showing the projected lump sum.
- **Projection tab**:
  1. Caption "Net worth projection, age 35 to 90".
  2. **Scenario chips** (Conservative / Moderate / Optimistic) — tap to switch which line is highlighted in the chart below; active chip fills with a scenario color (gray/green/orange), others stay outlined.
  3. **Line chart**: inline SVG, 3 overlaid paths (one per scenario) from current age to 90, with a vertical dashed reference line at the retirement age (65) and x-axis labels "35 / Retire · 65 / 90". Only the selected scenario's line is drawn at full opacity/stroke-width; the other two sit at 25% opacity, thinner — so switching chips re-emphasizes one line without hiding the others (shows relative spread).
  4. **Selected-scenario summary card**: 2-column, "At retirement (65)" value + "At age 90" value, updates when the chip selection changes.
  5. **Milestones card**: 2 rows — "Other debt cleared → Age 46", "Home loan settled → Age 55" (ages at which each liability reaches zero under the current plan).

### 5. Settings (`07-settings.png`)
**Purpose**: Profile, preferences, linked accounts, logout.
**Layout**:
1. Profile card: avatar + name + email + outlined "Edit" pill button.
2. "Preferences" section: Currency (ZAR, display-only here), Retirement age target (65, display-only here), Push notifications toggle, Email summaries toggle (both are working on/off switches, green track when on, gray when off, white knob).
3. "Linked Accounts" section: list of institution names with a green status dot (Discovery Bank, Standard Bank, Absa, Allan Gray).
4. "Log Out" text link, centered, red (#B4494A).

## Interactions & Behavior implemented in the prototype (recreate these)
- **Tab navigation**: 5 bottom tabs, single active tab at a time, icon+label recolor on active state, content area swaps entirely (no shared scroll position needed between tabs).
- **Accordion account rows** (Accounts tab): tapping the row toggles expand/collapse; only one account can be expanded at a time app-wide in this prototype (simple state), though allowing multiple open independently is a reasonable improvement.
- **Inline edit-in-place** for balance & interest rate: tapping "Update balance & rate" reveals two number inputs pre-filled with current values; "Save" commits and hides the form; the summary values (balance, rate) update live everywhere they're shown in that card.
- **Segmented controls** (Debit Orders/Spending, Retirement/Projection): simple 2-way tab switch within a screen, no animation required beyond a background/text color swap.
- **Scenario chips** on the projection chart: 3-way single-select; changing selection changes which chart line is emphasized and which summary numbers are shown below.
- **Add-expense flow**: CTA button reveals a 2-field form (description, amount) above the expense list; Add appends a new row (with a neutral/gray color swatch by default) and closes the form, clearing its fields; Cancel discards and closes without changes. The running total and donut chart should ideally recompute from the live expense list (the prototype's donut/legend percentages are static sample data — wire these to the real list in production).
- **Toggles** (Settings): standard on/off switches, no confirmation needed.

## State Management
Minimum state needed to reproduce behavior:
- `activeTab`: 'home' | 'accounts' | 'cashflow' | 'wealth' | 'settings'
- `expandedAccountId`: which account card (if any) is expanded, per account list
- `editingAccountId`: which account is in balance/rate edit mode
- Per-account `{ balance, interestRate }` — the editable fields, ideally persisted to a backend/local DB rather than local-only prototype state
- `cashflowSubTab`: 'orders' | 'spending'
- `wealthSubTab`: 'retirement' | 'projection'
- `projectionScenario`: 'conservative' | 'moderate' | 'optimistic'
- `expenses[]`: list of `{ id, name, amount, category/color }` — appended to by the add-expense form
- `showAddExpenseForm`, `newExpenseName`, `newExpenseAmount`: transient form state
- `pushNotificationsEnabled`, `emailSummariesEnabled`: settings toggles

For a real implementation, net worth, "Where It Sits" breakdown, account cards, debit orders, spending totals/percentages, and the projection chart should all be **derived/computed from the underlying account + transaction data**, not hardcoded — the prototype uses static sample numbers for all of these.

## Projection math (to implement properly)
The prototype's projection lines are illustrative, hand-drawn sample curves. For production, implement a real compound-growth projection per scenario:
- For each year from current age to 90: grow retirement/investment balances by the scenario's annual return rate, add ongoing contributions, subtract loan amortization schedules (using each loan's real balance/rate/term) until each is paid off, and net against cash/savings growth.
- Conservative/Moderate/Optimistic should map to configurable annual return assumptions (prototype used ~5% / 7% / 9%) — ideally user-adjustable in a future settings/tweak panel.
- Compute and surface real "debt cleared" and "home loan settled" milestone ages from the amortization schedules rather than hardcoding.

## Assets
No external image assets — all icons are inline SVG (line icons, 22×22, 2px stroke) hand-drawn to match a minimal outline icon style. Font: Manrope from Google Fonts (weights 400/500/600/700/800). Avatar shown as initials in a colored circle, no photo asset.

## Files in this bundle
- `Wealth Dashboard.dc.html` — the full interactive HTML prototype (open directly in a browser). Contains all 5 tabs/screens described above with working tab nav, accordions, inline edit, and the add-expense flow.
- `screenshots/01-home.png` — Home tab
- `screenshots/02-accounts.png` — Accounts tab (expand/edit not visible in static shot — see file for behavior)
- `screenshots/03-cashflow-orders.png` — Cash Flow tab, Debit Orders sub-view
- `screenshots/04-cashflow-spending.png` — Cash Flow tab, Spending sub-view
- `screenshots/05-wealth-retirement.png` — Wealth tab, Retirement sub-view
- `screenshots/06-wealth-projection.png` — Wealth tab, Projection sub-view
- `screenshots/07-settings.png` — Settings tab
