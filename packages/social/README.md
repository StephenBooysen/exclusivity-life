# Exclusivity — `me-dating-app`

A vetted membership dating club for Johannesburg. Both sides apply, a person reviews every
application, men pass a short interview before they join, and women join free once approved.

Part of the same suite as [me-money-manager](../me-money-manager) and
[me-intermittent-fast](../me-intermittent-fast) — same stack, same conventions: native
JavaScript, Express, JSON-file storage through `me-platform-core`, a plain HTML/CSS/ES-module
frontend, no build step, no framework.

Product and technical detail live in [`.docs`](./.docs):
[Product Requirements](./.docs/Product%20Requirements.md) ·
[Application Architecture](./.docs/Application%20Architecture.md).

## Running it

```
npm install
npm run dev
```

Then open http://localhost:9401 (or `PORT=xxxx npm run dev`). `npm run kill` frees the port if a
previous run is still holding it.

`me-platform-core` is a local sibling dependency (`../me-platform-core/`), so that repo must be
checked out next to this one for `npm install` to resolve.

On first boot an admin account is seeded so the review queue is reachable:

```
admin@exclusivity.life / Exclusivity!Admin2026
```

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` before deploying anywhere. The app refuses to start in
production without `SESSION_SECRET`.

## Screens

**Members**

- **Gate** — apply or sign in. Opens on the assay mark, because the one claim the product makes is that someone checked.
- **Apply** — five steps, saved as you go: what we check · about you · your life · photographs · verify it's you.
- **Status** — where an applicant waits: in review, interview booked, waitlisted, declined, paused.
- **Introductions** — the daily deck. Each introduction is laid out as a catalogue entry, not a card to flick past.
- **Conversations** — the inbox, then the thread. Real-time, match-gated.
- **Profile** — your photographs, your words, and your hallmarks.
- **Membership** — tiers for men; a plain statement that it is free for women, with no upsell surface.
- **Settings** — preferences, privacy, notifications, blocks, safety guide, export, pause, delete.

**Console** (`moderator` / `admin` roles)

- **Review** — the queue with the SLA clock, the application on one screen, interview scheduling and outcome, and the decision.
- **Moderation** — reports, photographs awaiting release, pending text edits, and enforcement.
- **Members** — search, full detail, audit trail, badges, comps, suspension and bans.
- **Operations** — funnel, gender ratio with its alarm, safety metrics, invitations, background jobs.

## Structure

- `index.js` — process entry; boots the app, attaches the socket, seeds the admin, starts jobs
- `backend/` — Express app, middleware, routes, domain services, realtime, background jobs
- `public/` — the mobile web frontend: plain HTML/CSS/JS (ES modules), no build step
- `.docs/` — the PRD and the architecture document
- `.application/` — runtime state, git-ignored: JSON data, media, logs, sessions, search index

## Design

The direction comes from the subject. Johannesburg is a city built on gold, and vetting a member
is literally **assaying** — testing a thing to certify what it is. So verification is drawn as a
**hallmark**: small struck punches, the way purity is certified on precious metal. Identity is a
shield, photographs a lozenge, standing a cartouche, profession an octagon.

Gold appears only in those marks and never as a fill, a glow or a gradient — that restraint is
what keeps it from reading as costume luxury. Everything else is highveld dusk: aubergine-black,
bone, lavender grey, with hairlines doing the structural work. Bodoni Moda carries the display
type for its engraved-certificate authority; Archivo does the work.

## What is deliberately not here

No member-to-member payments, gifting, tipping or tribute rails. No algorithmic attractiveness
scoring. No public or search-indexable profiles. No way — paid or otherwise — to message someone
who has not matched with you. The reasoning is in [§2 of the PRD](./.docs/Product%20Requirements.md#2-positioning-and-guardrails);
it is a hard product line, not a stylistic one.

## Configuration

Everything tunable lives in `backend/config.js` — deck sizes, scoring weights, retention windows,
the review SLA, the launch city. Secrets come from the environment only:

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 9401) |
| `NODE_ENV` | Secure cookies, dashboard auth, email provider |
| `SESSION_SECRET` | Session signing — **required in production** |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seeded console account |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Billing; without them a stub provider runs |
| `STRIPE_PRICE_<TIER>_<TERM>` | Stripe price ids, e.g. `STRIPE_PRICE_ELITE_MONTHLY` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Email; without them mail is written to the log |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth sign-in |

With no configuration at all the app runs end to end: file storage, in-memory cache and queue,
local media, stubbed billing, and email written to `.application/logs`.
