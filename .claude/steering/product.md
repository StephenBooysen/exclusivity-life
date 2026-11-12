# Exclusivity Life: Product Overview

## Purpose

Exclusivity Life is one person's suite of tools for the parts of a life that are usually scattered across notebooks, spreadsheets, apps and memory: direction, habits, learning, health, money and relationships. Each tool is a focused app, but they share a stack, a look and a philosophy: **deliberate, private, and under the owner's control.**

The suite is single-user by design. Apart from the social app, which is a multi-member product, none of the apps plan multi-user support. The social app is a separate product that happens to share the same foundations.

## Guiding principles

- **Own the data.** Everything runs locally on Node.js with JSON or SQLite storage. No external service is required to start any app.
- **Replace the spreadsheet, don't decorate it.** Wealth and goals exist to take over working tools, so they must cover the real workflow, not a demo of it.
- **Quiet over busy.** Interfaces are minimal, mobile-friendly and free of growth mechanics. Nothing is designed to bring the user back.
- **Reflection over metrics.** Where the apps measure something (streaks, progress, net worth, completion rates), the measure is there to support honest review, not to gamify.
- **Consistent foundations.** Same stack, same service wiring, same design language. A fix or pattern learned in one app should transfer to the others.

## The apps

### Goals and habits (`packages/goals`, "Architect My Life")

Purpose: help the owner set direction and check in on it daily.

- Hierarchical goals (annual, monthly, weekly) with focus areas such as health, career and relationships, priorities, success criteria and progress.
- Habits with daily, weekday, weekend or custom frequency, streaks and one-click completion.
- Morning intention and evening reflection, using default templates.
- Daily mood rating (1–10) with monthly trends and correlations against habits and goals.
- A wisdom library of quotes with sources and personal notes.
- An optional AI guide, using the owner's own Claude API key, for breaking down goals and analysing progress.

Success looks like: the owner opens it each morning, sets intent, ticks habits, and reviews the week without friction.

### Learning (`packages/learning`, "Me Learning Hub")

Purpose: turn material the owner reads on the web into study they actually retain.

- An Electron desktop app with projects and documents.
- A Chrome extension captures web pages into a project.
- Study plans use spaced repetition (SM-2), active recall and interleaving, across several modes such as flashcards and questions.
- A dashboard tracks progress; a local HTTP API lets external tools connect.

Success looks like: captured material turns into a schedule the owner follows, and recall improves over time.

### Nourishment (`packages/nourishment`, "Me Intermittent Fast")

Purpose: support a consistent intermittent-fasting practice without turning it into a clinical tool.

- Strategies: 16:8, 20:4, OMAD (23:1) and 5:2.
- A home dashboard with a live progress ring, stage labels and a timestamped note log.
- Planning, including scheduling a future fast or back-dating one already under way.
- History with streaks, a 28-day completion rate and a calendar.
- Reminder settings.

Stage labels and eating-window times are informational estimates, not medical advice. The app must not present them as clinical guidance.

Success looks like: the owner knows where they are in today's fast, and history shows the pattern without pressure.

### Exclusivity (`packages/social`, "me-dating-app")

Purpose: a vetted membership dating club for Johannesburg, where curation is the product.

- Both sides apply and a human reviewer decides. Men pass a short interview before joining and pay a membership subscription; women join free once approved.
- Men and women have different application flows, and both are reviewed.
- Members receive a small daily deck of introductions, not an endless feed.
- Messaging is possible only between matched members.
- Verification is shown as "hallmarks" (identity, photographs, standing, profession), reflecting the Johannesburg gold-assay theme.
- A moderator and admin console covers the review queue, moderation, member management and operations metrics.

Hard product lines, from the PRD, that must not be crossed:

- No member-to-member payments, gifting, tipping or tribute.
- No algorithmic attractiveness scoring.
- No public or search-indexable profiles.
- No way, paid or otherwise, to message someone who has not matched with you.

The full requirements are in `packages/social/.docs/Product Requirements.md`.

Success looks like: a small number of serious introductions a day, and a review process that members can trust.

### Wealth (`packages/wealth`, "Me Money Manager")

Purpose: replace a long-running household budget spreadsheet with an app covering the owner's whole money ecosystem.

- South African household finances in ZAR: accounts, debit orders, expenses, categories, income streams and income snapshots.
- Home loan ("bond"), retirement annuity, pension and provident fund, TFSA, and savings pockets.
- Net-worth tracking with a daily scheduled snapshot, balance snapshots and growth scenarios.
- Starter data is seeded on first boot so the app has content to show; the owner edits or deletes it.

Success looks like: the spreadsheet is retired, and the owner can see cash flow, net worth and scenarios in one place.

## Shared constraints

- **Local-first and single-process.** Each app runs with `npm run dev` and no external infrastructure. A documented upgrade path exists for social (MongoDB, Redis, S3), but it is not required.
- **Privacy.** Runtime data in `.application/` is personal and never committed. Secrets come from environment variables. The apps hold no third-party analytics.
- **Mobile-first web frontends.** Plain HTML, CSS and ES modules with no build step, except the Electron app in `learning`.
- **Honest copy.** The apps must not overstate what they know: fasting stages are estimates, net worth is a calculation, and match or review outcomes are human decisions.

## Open questions

- Whether `social` will ship under the working name "Exclusivity" (the PRD flags it as provisional).
- Whether the suite should share a single sign-in or stay as independent local apps.
- Whether `goals` and `wealth` should share a common "life review" view.
