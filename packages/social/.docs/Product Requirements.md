# Product Requirements Document
## Exclusivity — a vetted membership dating platform

**Repository**: `me-dating-app`
**Document Version**: 1.0
**Last Updated**: 2026-08-20
**Author**: Stephen Booysen
**Status**: Draft — for review

> "Exclusivity" is a working product name. The repository, package, and suite naming (`me-*`) are unaffected by the final choice.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Positioning and Guardrails](#2-positioning-and-guardrails)
3. [Users and Personas](#3-users-and-personas)
4. [Product Principles](#4-product-principles)
5. [Membership Model](#5-membership-model)
6. [Scope](#6-scope)
7. [Functional Requirements](#7-functional-requirements)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [Data, Privacy and Retention](#9-data-privacy-and-retention)
10. [Success Metrics](#10-success-metrics)
11. [Analytics Event Taxonomy](#11-analytics-event-taxonomy)
12. [Release Plan](#12-release-plan)
13. [Open Questions](#13-open-questions)

---

## 1. Executive Summary

Exclusivity is an invitation-grade dating platform for two curated audiences: professionally and financially established men, and women admitted on verified authenticity and profile quality. Both sides apply; a human reviewer decides. Men pay a membership subscription; women join free once approved.

The product's entire value proposition is **the bar at the door**. Every other feature — the daily curated introductions, the match-gated messaging, the verification badges — exists to make that bar visible and credible to members who could get a date anywhere. Volume is explicitly not the goal; a member who receives five introductions a day and takes two of them seriously is the target behaviour.

Exclusivity ships as a mobile-first progressive web app on the existing `nooblyjs-core` stack: a native JavaScript Express backend, no build step, JSON-file persistence, and the platform's caching, queueing, scheduling, filing, searching and auth services. This keeps v1 a single-process application that runs with `npm run dev` and no external infrastructure, while leaving a documented one-line path to MongoDB, Redis and S3 when volume demands it (see the Architecture document, §21).

### Value proposition by side

| Side | What they get | What they give |
|---|---|---|
| Men | Access to a verified, curated pool; a small number of high-quality introductions a day; discretion controls | A subscription and a verifiable record of professional/financial standing |
| Women | A pool where every man is identity- and means-verified; no unsolicited messages; strong block/report tooling | Photo and identity verification, and a complete profile |
| Platform | Subscription revenue from the paying side; a defensible brand built on curation | Ongoing human review cost and trust & safety investment |

---

## 2. Positioning and Guardrails

Exclusivity is a **vetted membership dating product**. Affluence and appearance are *admission signals* — they decide who is let in. They are never things being exchanged between members.

This PRD therefore deliberately excludes every mechanic that would turn the platform into a compensated-dating ("sugar") marketplace: no allowances, no per-date payments, no gifts, tributes or tipping rails between members, no member wallet, no "offers" attached to a message. **This is a hard product line, not a stylistic preference.** Three things turn on it:

- **App store distribution** — Apple App Store Guideline 1.1.4 and Google Play's Inappropriate Content policy both exclude apps facilitating compensated dating. A PWA sidesteps this today but forecloses a native app tomorrow.
- **Payment processing** — card networks classify compensated-dating merchants as high-risk; mainstream PSPs (Stripe, Paystack) prohibit them outright in their restricted-business lists. Losing the acquirer kills the only revenue line in §5.
- **Intermediary liability** — US FOSTA/SESTA removes safe-harbour protection for platforms that facilitate commercial sexual activity, and South African law (Sexual Offences Act 23 of 1957, s.20) is stricter still.

Concretely, this means three enforceable product rules, carried into requirements F7.4 and F5.3:

1. No money moves between members through Exclusivity. The only payment flow is member → platform.
2. Transactional solicitation in profiles or messages is a policy violation with an enforcement path, and is flagged automatically.
3. Marketing copy positions on *curation and verification*, never on *provision*.

Two related decisions, made deliberately:

**No algorithmic attractiveness scoring.** The female-side bar is enforced through photo verification, published photo standards, and profile completeness assessed by human reviewers — never a model that scores faces. Automated attractiveness ranking encodes demographic bias directly into the funnel, is indefensible in any published methodology, and creates discrimination exposure in several target markets. Human curation against written standards is auditable; a score is not.

**Symmetric verification, asymmetric criteria.** Both sides verify identity and photos. Only the male side verifies means, and only the female side is assessed on photo quality. Members are told exactly which criteria apply to them at application time (F1.2) — no hidden bar.

---

## 3. Users and Personas

### 3.1 Marcus — the paying member
42, founder of a mid-size logistics firm, Johannesburg and Cape Town, travels monthly. Deleted three mainstream apps: too much volume, too little signal, and a persistent suspicion that half the profiles were fake or agencies. Wants very few introductions, wants them real, and does not want his face circulating on an app his employees use. **Needs**: verification he can trust, discretion controls, low daily volume, travel mode. **Pays** if the pool is genuinely different.

### 3.2 Lerato — the approved member
29, in-house counsel, Sandton. Beautiful, and consequently drowning in unsolicited contact on every other platform. Will trade a slower onboarding for a pool where every man has been identity- and means-checked and cannot message her until she opts in. **Needs**: zero unsolicited messages, hard blocking, visible verification badges on his side, an easy exit from any conversation. **Will not pay**, and would not join if she had to.

### 3.3 Nadia — the reviewer / curator
Trust & safety operator. Works a queue: applications in, decision out, inside 48 hours. Needs every signal on one screen, keyboard-fast decisions, a written rubric to point at, and an audit trail on every call she makes. **Needs**: throughput without sloppiness.

### 3.4 Stephen — the operator / admin
Owner. Needs funnel visibility (applications → approvals → activations → matches → subscriptions), the ability to override any decision, invite-code control, and a defensible record of moderation actions.

---

## 4. Product Principles

1. **The bar is the product.** Anything that widens the funnel at the cost of the bar is rejected by default.
2. **Scarcity over volume.** Five considered introductions beat five hundred cards. Daily limits are a feature, not a paywall artefact.
3. **She controls contact.** No man reaches a woman's inbox without her explicit opt-in. There is no paid override of this, at any tier.
4. **Verification is visible.** A badge means a human or a document check backed it. Badges are never granted for payment.
5. **Discretion by default.** Precise location is never exposed, photos are never publicly addressable, and the top tier can browse without appearing.
6. **Every decision is auditable.** Approvals, declines, suspensions and overrides are logged with actor, timestamp and reason.
7. **No dark patterns.** Cancellation is as easy as subscribing; no artificial match notifications; no fake activity.

---

## 5. Membership Model

**Asymmetric**: men subscribe, women join free after vetting. This is the standard model in the category and it is the only one that fills the supply side at launch.

### 5.1 Tiers

| | **Select** (women) | **Signature** | **Elite** | **Noir** |
|---|---|---|---|---|
| Price (indicative) | Free | R899 / mo | R2 499 / mo | R7 999 / mo |
| Availability | On approval | On approval | On approval | Invitation only |
| Daily introductions | 12 | 5 | 12 | 25 |
| Likes per day | Unlimited | 10 | 40 | Unlimited |
| See who liked you | ✅ | ❌ | ✅ | ✅ |
| Advanced filters | ✅ | ❌ | ✅ | ✅ |
| Travel mode (browse another city) | ✅ | ❌ | ✅ | ✅ |
| Read receipts | ✅ | ❌ | ✅ | ✅ |
| Incognito browsing | ✅ | ❌ | ❌ | ✅ |
| Profile boosts | — | 0 | 2 / mo | 8 / mo |
| Priority review queue | ❌ | ❌ | ✅ | ✅ |
| Concierge introductions | ❌ | ❌ | ❌ | ✅ |
| Support response | 48h | 48h | 24h | 4h, named contact |

Prices are indicative and denominated in ZAR (primary market: South Africa, locale `en-ZA`), billed monthly with 3- and 12-month terms at a discount. Annual terms are the retention lever; do not discount month-to-month.

### 5.2 Rules

- Tier **never** buys access to a woman's inbox, a verification badge, or a decision reversal on an application. Tiers buy volume, filtering, and discretion — nothing that compromises Principle 3 or 4.
- Women's accounts are permanently free. There is no upsell surface on the Select experience.
- A lapsed subscription downgrades a man to a **dormant** state: existing conversations remain readable, no new introductions, no new likes, profile hidden from discovery. Data is retained per §9.
- Noir is invitation-only, issued by an admin (F9.5). It cannot be self-selected at checkout.

---

## 6. Scope

### 6.1 In scope for v1

Application and onboarding · human review queue with decisions and SLA · identity, photo and means verification · profiles with badges · daily curated introductions · like/pass with mutual matching · match-gated real-time messaging · block, report and moderation · membership tiers with entitlement enforcement · subscription lifecycle with a stubbed payment adapter · admin console · in-app and email notifications · settings, privacy controls, export and delete.

### 6.2 Deferred to v2+

Native iOS/Android apps · video profiles and video calling · photo and voice messages in chat · events and member gatherings · automated photo moderation (ML) · third-party background checks · concierge matchmaking workflow tooling · multi-language · referral quotas for members · web push notifications · A/B testing framework.

### 6.3 Explicitly out of scope, permanently

Member-to-member payments of any kind · gifting, tipping or tribute mechanics · algorithmic attractiveness scoring · public profile pages or search-engine-indexable profiles · selling or brokering member data · paid inbox override.

---

## 7. Functional Requirements

Priorities: **P0** = required for launch, **P1** = required within one release of launch, **P2** = desirable.

### F1 — Application and Onboarding

| ID | Priority | Requirement |
|---|---|---|
| F1.1 | P0 | A visitor can start an application from the landing page with email and password, or Google OAuth. Account is created in `pending` state. |
| F1.2 | P0 | Before any data is collected, the applicant is shown the criteria that will be applied to them, by side, in plain language — including that a human will review the application and that means verification applies to male applicants. |
| F1.3 | P0 | The application collects: name, date of birth (18+ hard gate), gender, city, occupation, education, height, relationship intent, smoking/drinking, children, a 300-character bio, and three prompt answers. |
| F1.4 | P0 | The applicant uploads 3–6 photos. At least one must show the face unobscured. Upload accepts JPEG/PNG/HEIC up to 12 MB, strips EXIF (including GPS) on ingest, and generates derived sizes. |
| F1.5 | P0 | The applicant completes a liveness selfie (a prompted-pose capture) used only to match against uploaded photos. |
| F1.6 | P0 | Male applicants complete a means declaration: income band, occupation and employer. **No financial documents are collected** — standing is established at interview (F2.3a). The applicant is told this explicitly at F1.2, because "no bank statements" is itself a reason people apply. |
| F1.7 | P0 | Applicants can save and resume; the application persists across sessions and shows completion progress. |
| F1.8 | P0 | On submission the applicant sees the expected decision window (48h) and receives a confirmation email. |
| F1.9 | P1 | An invite code may be entered at application time, routing the application to the priority queue and tagging the referrer. |
| F1.10 | P1 | Applicants can withdraw an application, which deletes the submission and all uploaded documents. |

**Acceptance (F1.4):** an upload containing GPS EXIF data results in a stored original with no EXIF block; the original is unreachable from any unauthenticated URL.
**Acceptance (F1.3):** a date of birth under 18 blocks submission client- and server-side with an explicit message; the account is closed and flagged.

### F2 — Vetting and Verification

| ID | Priority | Requirement |
|---|---|---|
| F2.1 | P0 | Submitted applications enter a review queue ordered by priority then submission time. |
| F2.2 | P0 | An automated pre-screen runs before human review: duplicate email/phone/photo-hash, disposable-email domains, banned-user photo matches, and prohibited-language scan of free text. Findings are attached to the application as flags, never as an auto-decline. |
| F2.3 | P0 | A reviewer sees one screen: photos side by side with the liveness selfie, all declared fields, pre-screen flags, the means declaration (male), and the written rubric. |
| F2.3a | P0 | **Means standing is established by interview, not documents.** Male applicants must pass a ~20-minute introductory call before they can be approved; a reviewer may request one for any applicant. The reviewer schedules it, the applicant is emailed, and the outcome is recorded as **passed / not passed / no show** with notes. A passed interview is the evidence behind the `means` badge. |
| F2.3b | P0 | The approve action is **refused** (HTTP 409, `interview_required`) for any applicant whose side requires an interview until one is recorded as passed. This is enforced server-side, not by hiding the button. |
| F2.4 | P0 | A reviewer records one of four decisions with a mandatory reason code and optional note: **approve**, **waitlist**, **decline**, **request more information**. |
| F2.5 | P0 | Every decision writes an immutable audit record: application id, reviewer id, decision, reason code, timestamp. |
| F2.6 | P0 | The applicant is notified by email on decision. Declines state a reason category and the appeal path; they never disclose reviewer identity or internal flags. |
| F2.7 | P0 | On approval the account moves to `active`, badges are granted, and the member is routed to payment (male) or straight into the product (female). |
| F2.8 | P0 | Badges: **Identity verified**, **Photo verified**, **Means verified** (male, from a passed interview), **Professional verified**. Each records its evidence type, granting reviewer and date. Badges are revocable. |
| F2.9 | P0 | No financial documents are collected at any point, so there is no document-retention obligation to manage. The only biometric artefact held is the liveness selfie, purged at 90 days (§9). |
| F2.10 | P1 | A declined applicant may appeal once, after 30 days, which creates a new application linked to the original. |
| F2.11 | P1 | Waitlisted applicants are re-surfaced to the queue when the relevant cohort has capacity, and can be batch-approved. |
| F2.12 | P2 | Reviewer throughput and decision-mix statistics per reviewer, for calibration. |

**Acceptance (F2.3b):** an approve call on a male application with no passed interview returns 409 `interview_required`, even when sent directly to the API.
**Acceptance (F2.4):** the decision endpoint rejects a submission with no reason code (HTTP 400), and the UI cannot submit one.
**Acceptance (F2.8):** a man approved after a passed interview holds `means`; a woman approved without one never does.

### F3 — Profiles

| ID | Priority | Requirement |
|---|---|---|
| F3.1 | P0 | An approved member has a profile: photos, name (first name only shown), age (derived, never DOB), city, occupation, education, height, intent, bio, prompts, and badges. |
| F3.2 | P0 | Members can edit profile fields at any time. Edits to photos and bio re-enter moderation; the previous version stays live until the new one clears. |
| F3.3 | P0 | Location is shown as city and a distance band (`<5 km`, `5–15 km`, `15–50 km`, `50 km+`). Precise coordinates are never returned by any API. |
| F3.4 | P0 | Profiles are visible only to authenticated, approved members. There is no public profile URL and no search-engine-indexable profile content. |
| F3.5 | P1 | Profile completeness meter with prompts for missing high-signal fields. |
| F3.6 | P1 | A member can see who viewed their profile (Elite and above; Select always). |
| F3.7 | P2 | Prompt library rotates seasonally; members can re-roll prompts. |

### F4 — Discovery and Matching

| ID | Priority | Requirement |
|---|---|---|
| F4.1 | P0 | Each member receives a **Daily Introductions** deck, generated nightly, sized by tier (§5.1), refreshed at 06:00 local. |
| F4.2 | P0 | Deck candidates satisfy: mutually compatible gender preference, both `active` and approved, age within both members' stated ranges, within distance preference, not previously acted upon, not blocked in either direction, not suspended. |
| F4.3 | P0 | Candidates are ranked by a transparent, documented score (Architecture §12): preference fit, reciprocity likelihood, profile completeness, verification depth, recency of activity, and a diversity term to prevent the same faces recurring. No attractiveness model (§2). |
| F4.4 | P0 | A member can **like** or **pass** a card. Likes are consumed against the daily allowance; passes are unlimited. |
| F4.5 | P0 | A mutual like creates a **match** and opens a conversation. Both sides are notified. |
| F4.6 | P0 | Daily allowances reset at 00:00 local. Remaining counts are visible before the member runs out, not after. |
| F4.7 | P1 | Browse with filters (age, distance, city, intent, education, badges) — Elite and above; Select always. Browsing consumes likes from the same allowance. |
| F4.8 | P1 | "Who liked you" list — Elite and above; Select always. Liking back from this list creates an immediate match. |
| F4.9 | P1 | Travel mode: temporarily set discovery to another city for up to 30 days, disclosed on the profile as "visiting". |
| F4.10 | P1 | Incognito (Noir, Select): browse without appearing in others' decks or view lists; likes still reveal the liker. |
| F4.11 | P2 | Boosts: elevate a profile in others' decks for 30 minutes, from a monthly credit balance. |

**Acceptance (F4.2):** a member who has blocked another never receives them in a deck, in browse results, or in a "who liked you" list, in either direction.
**Acceptance (F4.6):** the API rejects a like beyond the daily allowance with HTTP 429 and a machine-readable `allowance_exhausted` code, and the client shows remaining count from the same source of truth.

### F5 — Messaging

| ID | Priority | Requirement |
|---|---|---|
| F5.1 | P0 | Messaging is available only between matched members. There is no mechanism — paid or otherwise — to message an unmatched member. |
| F5.2 | P0 | Real-time text messaging with delivery state, ordered history, and pagination. |
| F5.3 | P0 | First messages are scanned for external-contact solicitation (phone, email, off-platform handles) and transactional language; matches are flagged for review, not blocked outright, and the pattern set is tunable without a deploy. |
| F5.4 | P0 | Either party can **unmatch** at any time. Unmatching closes the conversation for both, removes it from both inboxes, and cannot be undone. |
| F5.5 | P0 | Rate limits: burst and daily caps per member, applied server-side; a suspended member cannot send. |
| F5.6 | P0 | Read receipts are shown per §5.1 and are reciprocal — a member who cannot show them cannot see them. |
| F5.7 | P1 | A match expires if no message is sent within 7 days, with a reminder at 5 days. Expiry removes it from both inboxes. |
| F5.8 | P1 | Typing indicators and online/last-active presence, both individually disableable in settings. |
| F5.9 | P2 | Photo messages, behind moderation. Voice notes. |

**Acceptance (F5.1):** every message-send path (REST and socket) independently verifies an active, non-blocked match for the sender before persisting; a forged match id returns 403.

### F6 — Membership and Billing

| ID | Priority | Requirement |
|---|---|---|
| F6.1 | P0 | On approval, a male member selects a tier and completes checkout before entering the product. |
| F6.2 | P0 | Billing runs through a provider-abstracted `billingService`. v1 ships a **stub provider** (records subscriptions, simulates renewal) with the interface defined for Paystack (ZA) and Stripe (international). No card data ever touches Exclusivity servers. |
| F6.3 | P0 | Subscription states: `trialing`, `active`, `past_due`, `cancelled`, `expired`. State transitions are logged and drive entitlements. |
| F6.4 | P0 | Entitlements are evaluated server-side from subscription state on every gated action. The client never decides what a tier permits. |
| F6.5 | P0 | Members can cancel in two clicks from Settings, effective at period end, with no retention interstitial beyond a single optional reason question. |
| F6.6 | P0 | Failed renewal enters `past_due` with a 7-day grace period and three notification attempts before downgrade to dormant. |
| F6.7 | P1 | Upgrade/downgrade with proration; downgrade takes effect at period end. |
| F6.8 | P1 | Invoices are listed in Settings and downloadable as PDF. |
| F6.9 | P2 | Promotional codes and founding-member pricing. |

**Acceptance (F6.4):** with the client patched to claim Noir, a Signature member's request for a 25-card deck returns 5 cards.

### F7 — Trust and Safety

| ID | Priority | Requirement |
|---|---|---|
| F7.1 | P0 | Any member can **block** another from a profile, a card, or a conversation. Blocking is silent, mutual in effect, immediate, and permanent unless reversed by the blocker. |
| F7.2 | P0 | Any member can **report** with a category {fake profile, harassment, solicitation, offensive content, underage, scam, other}, free text, and an optional message reference. Reports enter the moderation queue. |
| F7.3 | P0 | Moderators can: dismiss, warn, remove content, suspend (with duration), or ban. Every action records actor, target, reason and evidence. Bans record a photo hash and email hash to block re-registration. |
| F7.4 | P0 | Solicitation and transactional-language detection runs on profiles and first messages, routing to moderation (per §2). Confirmed cases are a ban-first offence. |
| F7.5 | P0 | All uploaded photos pass moderation before going live. v1 is a human queue; v2 adds automated pre-classification. |
| F7.6 | P0 | A Safety Centre is reachable from every screen: reporting guidance, date safety advice, and how verification works. |
| F7.7 | P1 | Scam heuristics: new account + external contact request + money mention + rapid messaging → automatic flag and reviewer alert. |
| F7.8 | P1 | Reported members are hidden from the reporter's discovery immediately, before any moderation decision. |
| F7.9 | P1 | Emergency contact / "share my plans": a member can share date details with a chosen contact by email. |
| F7.10 | P2 | Photo-hash matching against previously banned accounts at application time. |

**Acceptance (F7.1):** blocking completes in under one second from the member's perspective and takes effect on the next request in both directions, including in-flight socket connections.

### F8 — Notifications

| ID | Priority | Requirement |
|---|---|---|
| F8.1 | P0 | In-app notification centre: new match, new message, application decision, verification granted, subscription events, moderation outcomes. |
| F8.2 | P0 | Transactional email for: application received, decision, new match, subscription receipt, renewal failure, password reset. |
| F8.3 | P0 | Per-category notification preferences in Settings, honoured server-side. |
| F8.4 | P0 | Daily introductions availability notification, once per day, at a member-chosen hour. |
| F8.5 | P1 | Digest email for members inactive 7+ days, respecting preferences and capped at one per week. |
| F8.6 | P2 | Web push via the service worker. |

### F9 — Admin Console

| ID | Priority | Requirement |
|---|---|---|
| F9.1 | P0 | Role-gated console at `/admin` for `moderator` and `admin` roles, separate from the member experience. |
| F9.2 | P0 | Application review queue (F2) with keyboard-driven decisions and queue filters. |
| F9.3 | P0 | Moderation queue: reports, flagged messages, pending photos — with SLA ageing visible. |
| F9.4 | P0 | Member search and detail: full record, verification history, subscription, moderation history, audit trail; with suspend/ban/reinstate and badge grant/revoke. |
| F9.5 | P0 | Invite code generation with tier, quota and expiry (Noir issuance path). |
| F9.6 | P0 | Operations dashboard: funnel counts, queue depth, time-to-decision, report rate, gender ratio by city, active subscriptions. |
| F9.7 | P1 | Subscription overrides: comp a membership, extend a period, refund flag. |
| F9.8 | P1 | Feature flags and tunable thresholds (deck sizes, rate limits, solicitation patterns) editable without deploy. |
| F9.9 | P1 | Exportable audit log over a date range. |

### F10 — Account, Settings and Privacy

| ID | Priority | Requirement |
|---|---|---|
| F10.1 | P0 | Settings: account, discovery preferences, notification preferences, privacy, membership, safety, help. |
| F10.2 | P0 | Pause account: hidden from discovery, conversations retained, no deletion. |
| F10.3 | P0 | Delete account: irreversible, confirmed by password, executed within 30 days, with the retention carve-outs in §9. |
| F10.4 | P0 | Data export: machine-readable archive of profile, photos, matches, messages and decisions, delivered within 30 days. |
| F10.5 | P0 | Password change, active session list, and sign-out-everywhere. |
| F10.6 | P1 | Two-factor authentication by TOTP. |
| F10.7 | P1 | Hide from specific people: upload contacts to exclude, matched by hashed email/phone. |

---

## 8. Non-Functional Requirements

| Area | Requirement |
|---|---|
| **Performance** | p95 API response < 300 ms at 100 concurrent members on the file-store prototype; deck render < 1.5 s on 4G; message delivery < 500 ms end to end. |
| **Scale (v1 target)** | 5 000 registered members, 1 500 active, 50 concurrent, 20 000 messages/day. Beyond this, migrate per Architecture §21. |
| **Availability** | 99.5% for the prototype; no planned maintenance window during 18:00–23:00 local (peak dating hours). |
| **Browser support** | Latest two versions of Safari iOS, Chrome Android, Chrome, Edge, Safari desktop. Mobile-first; desktop is a supported second-class layout. |
| **Accessibility** | WCAG 2.2 AA: keyboard navigable, 4.5:1 contrast, labelled controls, `prefers-reduced-motion` honoured, screen-reader-sane match and chat flows. |
| **Security** | OWASP Top 10 addressed; server-side authorisation on every resource; no photo or document reachable without an authorisation check; secrets from environment only. |
| **Privacy** | Data minimisation by default; EXIF stripped; precise location never stored; documents deleted post-decision (F2.9). |
| **Auditability** | Every moderation, verification and billing action is attributable to an actor with a timestamp and reason. |
| **Localisation** | `en-ZA` copy, ZAR currency, 24-hour time, DD/MM/YYYY. Structured for later locales; not multi-language in v1. |
| **Offline** | PWA shell loads offline; read-only cached view of matches and recent messages; sends queue until reconnect. |
| **Operability** | Structured logs, platform service dashboards at `/platform-core`, health endpoint, one-command local start. |

---

## 9. Data, Privacy and Retention

Primary market South Africa (**POPIA**) with EU-resident members likely (**GDPR**). The stricter of the two applies throughout.

| Data | Retention | Notes |
|---|---|---|
| Profile and photos | Life of account + 30 days | Deleted on account deletion after the grace window |
| Means-verification documents | Not collected | Standing is established at interview (F2.3a); only the outcome, interviewer and notes are retained |
| Liveness selfie | 90 days from decision | Then deleted; verification outcome retained |
| Messages | Life of match; 90 days after unmatch | Retained longer only where subject to an open report |
| Moderation records and bans | 5 years | Legitimate-interest basis: repeat-offender prevention |
| Audit log | 5 years | Immutable |
| Billing records | 7 years | Statutory (SARS) |
| Analytics events | 24 months, pseudonymised | No raw PII in the event stream |

Lawful basis: contract for core service delivery; consent for marketing and optional processing; legitimate interest for safety, fraud prevention and audit. A member exercising deletion (F10.3) does not erase moderation, ban or billing records — this is disclosed in the privacy policy.

---

## 10. Success Metrics

**North star**: *weekly mutual matches that reach a 10-message conversation*. It is the only metric that captures both sides of the market getting value, and it is resistant to vanity inflation.

### Funnel

| Stage | Target |
|---|---|
| Landing → application started | 12% |
| Application started → submitted | 55% |
| Submitted → approved | 30% men / 45% women |
| Approved (male) → subscribed | 60% |
| Subscribed → first match within 7 days | 70% |
| First match → 10-message conversation | 40% |

### Health and guardrails

| Metric | Target | Alarm |
|---|---|---|
| Time to application decision (p95) | < 48 h | > 72 h |
| Gender ratio, active, per city | 1.0–1.6 M:F | > 2.0 |
| Reports per 1 000 active members / week | < 5 | > 15 |
| Female-side 30-day retention | > 55% | < 40% |
| Male-side subscription churn, monthly | < 8% | > 15% |
| Solicitation flags confirmed / week | Trend to zero | Any upward trend |
| Photo moderation backlog | < 4 h | > 24 h |

The gender ratio is the leading indicator of platform death: when it exceeds 2.0 in a city, throttle male approvals in that city rather than chase growth.

---

## 11. Analytics Event Taxonomy

Events are pseudonymised (`member_ref`, never email), emitted through the platform event emitter, and drained to the activity store.

```
application_started, application_step_completed{step}, application_submitted
application_decided{decision, reason_code, hours_in_queue}
verification_granted{badge, evidence_type}
member_activated{side, tier}
deck_generated{size, candidate_pool}, deck_viewed, card_liked, card_passed
match_created{elapsed_since_like}, match_expired, unmatched{by_side, message_count}
message_sent{match_age_days, message_index}, conversation_reached_10
subscription_started{tier, term}, subscription_renewed, subscription_cancelled{reason}
report_filed{category}, moderation_action{action, category}
block_created, safety_centre_opened
```

---

## 12. Release Plan

| Milestone | Contents | Exit criteria |
|---|---|---|
| **M0 — Foundation** | Platform wiring, config, auth, sessions, roles, app shell, design system | A member can register, log in, and see an empty shell |
| **M1 — Application & vetting** | F1, F2, F9.1–F9.2 | An application can be submitted and decided end to end, with audit |
| **M2 — Profiles & discovery** | F3, F4.1–F4.6, deck job | A matched pair can be produced from two approved accounts |
| **M3 — Messaging & safety** | F5.1–F5.6, F7.1–F7.6, F9.3 | A conversation can run, be reported, and be actioned |
| **M4 — Membership** | F6, entitlement enforcement | A man cannot enter the product without an active subscription |
| **M5 — Admin & analytics** | F9.4–F9.6, F8, event stream | The operator can run the business from `/admin` |
| **M6 — Polish** | PWA, accessibility pass, performance pass, P1 backlog | NFRs in §8 met and measured |

Each milestone is independently demoable. M1–M3 are the critical path; M4 can lag M3 by one release without blocking a closed beta.

---

## 13. Decisions Taken

| # | Question | Decision | Where it lives |
|---|---|---|---|
| 1 | Launch city | **Single city — Johannesburg**, hard geo-gate. An application from outside is waitlisted on submission rather than queued, so reviewer time goes to the pool that can actually meet. | `config.launch` |
| 2 | Female-side sourcing | **Open sign-up, approved by hand in the console.** No referral mechanic in v1; the first cohort is admitted individually by a reviewer. | F2, admin console |
| 3 | Reviewer capacity | **Staffed to hold the 48h SLA**, deliberately small on both sides at launch. Pre-screen flags stay advisory. | `config.review.slaHours`, `reviewSla` job |
| 4 | Means-verification depth | **Interview only — no financial documents.** A ~20-minute call establishes standing and gates approval. | F2.3a, F2.3b |
| 5 | PSP | **Stripe**, via Checkout in subscription mode with a webhook handler. A stub provider is the default so the app runs with no keys. | `billingService` |
| 6 | Pricing validation | Proceed on the §5.1 figures as positioned; run a willingness-to-pay test before M4 locks entitlements. | open |
| 7 | Appeal volume | Ship F2.10 as specified — one appeal, after 30 days. | `applicationService.appeal` |

### Still open

1. **Willingness to pay.** The §5.1 prices are positioned, not tested. Test before M4 locks entitlements.
2. **Interview throughput.** The interview is now on the critical path for every male approval. At what daily volume does it become the bottleneck rather than the review queue, and who runs the calls?
3. **Stripe entity and ZAR.** Confirm the Stripe entity supports ZAR settlement for this business, and validate the account against the §2 positioning *before* M4 — a declined merchant account after launch removes the only revenue line.
4. **Waitlist release policy.** Batch approval exists (`/admin/members/waitlist/approve`). What triggers a release, and who decides?

---

*Companion document: [Application Architecture](./Application%20Architecture.md).*
