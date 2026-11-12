# Application Architecture
## Exclusivity — `me-dating-app`

**Document Version**: 1.0
**Last Updated**: 2026-08-20
**Status**: Draft — for review
**Companion**: [Product Requirements](./Product%20Requirements.md)

---

## Table of Contents

1. [Purpose and Scope](#1-purpose-and-scope)
2. [Architectural Overview](#2-architectural-overview)
3. [Runtime Topology](#3-runtime-topology)
4. [Directory Layout](#4-directory-layout)
5. [Platform-Core Integration](#5-platform-core-integration)
6. [Layering and Dependency Rules](#6-layering-and-dependency-rules)
7. [Request Lifecycle](#7-request-lifecycle)
8. [Domain Service Catalogue](#8-domain-service-catalogue)
9. [Data Model](#9-data-model)
10. [Storage Strategy and File-Store Constraints](#10-storage-strategy-and-file-store-constraints)
11. [Caching Strategy](#11-caching-strategy)
12. [Matching Engine and Deck Generation](#12-matching-engine-and-deck-generation)
13. [Realtime Layer](#13-realtime-layer)
14. [Media Pipeline](#14-media-pipeline)
15. [Authentication, Authorisation and Entitlements](#15-authentication-authorisation-and-entitlements)
16. [Background Jobs](#16-background-jobs)
17. [Audit and Activity Trail](#17-audit-and-activity-trail)
18. [Notifications](#18-notifications)
19. [Frontend Architecture](#19-frontend-architecture)
20. [Security Architecture](#20-security-architecture)
21. [Observability](#21-observability)
22. [Error Handling Conventions](#22-error-handling-conventions)
23. [Testing Strategy](#23-testing-strategy)
24. [Configuration and Environment](#24-configuration-and-environment)
25. [Scaling and Migration Path](#25-scaling-and-migration-path)
26. [Risks and Mitigations](#26-risks-and-mitigations)
27. [Appendix A — API Surface](#appendix-a--api-surface)

---

## 1. Purpose and Scope

This document describes how Exclusivity is built: the process topology, the layering, the data model, and the mechanisms behind each product capability in the PRD. It is written against the **prototype-scale target** agreed for v1 — a single Node process, JSON-file persistence through `me-platform-core`, in-memory cache and queue, local filesystem media. §25 documents the migration path to MongoDB, Redis and object storage, which is a provider swap in one file rather than a rewrite.

It follows the conventions already established in this suite (`me-intermittent-fast`, `me-money-manager`): native JavaScript, CommonJS on the server, ES modules in the browser, no build step, no framework on the frontend.

---

## 2. Architectural Overview

Exclusivity is a **modular monolith**. One Express process serves the API, the static PWA, the realtime socket, the admin console and the scheduled jobs. Domain logic lives in factory-constructed services with injected dependencies; infrastructure lives entirely in `me-platform-core` behind provider abstractions.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Browser (PWA — mobile first, no build step)                            │
│                                                                          │
│  index.html ──▶ app.js ──▶ router.js ──▶ views/{discover, matches,      │
│                                            chat, profile, apply,        │
│                                            settings, admin}             │
│                    │                                                     │
│              js/api.js (fetch)          js/realtime.js (socket.io)      │
└────────────────────┼───────────────────────────────┼────────────────────┘
                     │ HTTPS / JSON                  │ WSS
┌────────────────────▼───────────────────────────────▼────────────────────┐
│  Express (index.js → backend/app.js)          Node single process       │
│                                                                          │
│  helmet · cors · compression · session · rate-limit · csrf              │
│                     │                                                    │
│  ┌──────────────────▼─────────────────────────────────────────────┐    │
│  │ Routes  /api/*  — thin: parse, authorise, delegate, respond    │    │
│  └──────────────────┬─────────────────────────────────────────────┘    │
│  ┌──────────────────▼─────────────────────────────────────────────┐    │
│  │ Domain services — all business rules live here                 │    │
│  │  member · application · verification · profile · discovery     │    │
│  │  matching · messaging · moderation · membership · media        │    │
│  │  notification · admin · entitlements                           │    │
│  └──────────────────┬─────────────────────────────────────────────┘    │
│  ┌──────────────────▼─────────────────────────────────────────────┐    │
│  │ store.js (serialised CRUD) · cacheVersion.js · platform.js     │    │
│  └──────────────────┬─────────────────────────────────────────────┘    │
└─────────────────────┼───────────────────────────────────────────────────┘
┌─────────────────────▼───────────────────────────────────────────────────┐
│  me-platform-core — ServiceRegistry (singleton, DI, event bus)          │
│                                                                          │
│  logging(file) · caching(memory) · dataService(file) · queueing(memory) │
│  scheduling(memory) · filing(local) · searching(memory) · notifying     │
│  authservice(file) · measuring(memory)                                  │
│  + service dashboards mounted at /platform-core                         │
└─────────────────────┬───────────────────────────────────────────────────┘
┌─────────────────────▼───────────────────────────────────────────────────┐
│  .application/   data/*.json · media/ · logs/ · caching/ · settings/    │
└─────────────────────────────────────────────────────────────────────────┘
```

### Architectural decisions

| # | Decision | Rationale |
|---|---|---|
| AD-1 | Modular monolith, not services | One developer, prototype scale. Module boundaries are enforced by dependency rules (§6), so the seams for later extraction exist without the operational cost now. |
| AD-2 | All infrastructure through `me-platform-core` | Provider abstraction is the migration path (§25). No direct `fs`, `redis` or `mongodb` calls in application code. |
| AD-3 | Domain services are factories with injected dependencies | Matches the suite convention; makes every service unit-testable with fakes and no module mocking. |
| AD-4 | Routes are thin | No business rule may live in a route handler. Rules are tested at the service layer, where they are not coupled to HTTP. |
| AD-5 | Server-side authorisation on every request | The client is untrusted. Entitlements, match membership and block state are re-derived server-side each time (PRD F5.1, F6.4). |
| AD-6 | Messages sharded one container per match | The file provider reads whole containers; a single `messages` container becomes an O(all-messages) read per send. See §10.3. |
| AD-7 | **All** container access serialised, reads included | The file provider does read-modify-write with awaits in between, and writes with a truncating `fs.writeFile`. Concurrent writes lose updates; a read landing mid-write sees a truncated file. Both are closed by one per-container queue. See §10.2. |
| AD-9 | Jobs run in-process, not through platform `scheduling` | That service executes isolated scripts in a worker with only a data directory passed in. Every job here is a domain operation needing the live service graph, which a worker would have to rebuild. See §16. |
| AD-8 | Media never served by `express.static` | Every photo byte passes an authorisation check (PRD F3.4, §14). |

---

## 3. Runtime Topology

Single Node process, default port **9401** (`me-money-manager` 9201, `me-intermittent-fast` 9301).

| Concern | Mechanism | Provider (v1) |
|---|---|---|
| HTTP + static | Express 4 | — |
| Realtime | socket.io attached to the same HTTP server | in-memory adapter |
| Persistence | `dataService` | `file` — JSON per container under `.application/data` |
| Cache | `caching` | `memory` |
| Queue | `queueing` | `memory` |
| Scheduler | `scheduling` | `memory`, scripts from `backend/jobs` |
| Media | `filing` | `local` — `.application/media` |
| Search index | `searching` | `memory`, persisted to disk |
| Identity | `authservice` | `file` + `passport-local` + Google OAuth |
| Logs | `logging` | `file` — `.application/logs` |
| Metrics | `measuring` | `memory` |
| Email | `emailService` (app-level) | `stub` in dev, SMTP via nodemailer in prod |
| Billing | `billingService` (app-level) | `stub` in v1; Paystack/Stripe adapter defined |

`index.js` stays as it is today: build the app, listen. All wiring lives in `backend/app.js`.

---

## 4. Directory Layout

```
me-dating-app/
├── index.js                       # process entry — createApp() + listen
├── package.json
├── .application/                  # runtime state, git-ignored
│   ├── data/                      # JSON containers (dataService file provider)
│   ├── media/
│   │   ├── originals/{memberId}/  # never web-reachable
│   │   ├── derived/{size}/        # 160 / 480 / 1080 px
│   │   └── documents/             # means evidence, deleted post-decision (F2.9)
│   ├── logs/
│   ├── caching/
│   └── search/                    # searching index persistence
├── .docs/
│   ├── Product Requirements.md
│   ├── Application Architecture.md
│   └── design/                    # visual design handoff
├── backend/
│   ├── app.js                     # composition root
│   ├── config.js                  # single source of configuration
│   ├── middleware/
│   │   ├── auth.js                # requireAuth, requireApproved, requireRole
│   │   ├── entitlements.js        # requireEntitlement(key)
│   │   ├── csrf.js
│   │   ├── rateLimits.js
│   │   └── upload.js              # multer, memory storage, type/size gates
│   ├── routes/
│   │   ├── index.js               # buildApiRouter(services)
│   │   ├── asyncHandler.js
│   │   ├── auth.js  applications.js  profile.js  photos.js
│   │   ├── discovery.js  matches.js  messages.js
│   │   ├── membership.js  reports.js  notifications.js  settings.js
│   │   └── admin/                 # review.js  moderation.js  members.js  ops.js
│   ├── services/
│   │   ├── platform.js            # ServiceRegistry bootstrap (singleton)
│   │   ├── store.js               # serialised CRUD over dataService
│   │   ├── cacheVersion.js        # namespaced generation-counter cache
│   │   ├── activityService.js     # write-behind audit trail
│   │   ├── memberService.js       │ applicationService.js
│   │   ├── verificationService.js │ profileService.js
│   │   ├── mediaService.js        │ discoveryService.js
│   │   ├── matchingService.js     │ messagingService.js
│   │   ├── moderationService.js   │ membershipService.js
│   │   ├── entitlementService.js  │ notificationService.js
│   │   ├── emailService.js        │ billingService.js
│   │   ├── searchIndexService.js  │ adminService.js
│   │   └── scoring.js             # pure ranking functions, no I/O
│   ├── realtime/
│   │   ├── index.js               # socket.io server, session handshake
│   │   └── handlers.js            # message, typing, presence
│   └── jobs/                      # scheduling scripts (activitiesFolder)
│       ├── dailyDecks.js  matchExpiry.js  subscriptionSweep.js
│       ├── reviewSla.js   retentionSweep.js  metricsSnapshot.js
├── public/
│   ├── index.html  app.js  styles.css  manifest.webmanifest  sw.js
│   ├── icons/
│   └── js/
│       ├── api.js  router.js  realtime.js  format.js  toast.js
│       ├── components/           # modal, card, badge, photoGrid, chatBubble
│       └── views/                # apply, discover, matches, chat,
│                                 # profile, settings, admin
└── tests/
    ├── unit/                      # domain services with fakes
    ├── api/                       # supertest against a built app
    └── fixtures/
```

---

## 5. Platform-Core Integration

`me-platform-core` exports an **already-constructed** `ServiceRegistry` instance — there is no `.serviceRegistry` property to reach for and no class to instantiate. `backend/services/platform.js` initialises it exactly once per process and hands back only the services the app uses.

```js
'use strict';

const path = require('node:path');
const config = require('../config');

let platform = null;

/**
 * Initializes the me-platform-core service registry once per process. The
 * registry resolves cross-service dependencies (scheduling → working,
 * dataservice → filing, authservice → dataservice) automatically, so callers
 * only ask for the top-level services they use.
 * @param {import('express').Express} app
 */
function initPlatform(app) {
  if (platform) return platform;

  const serviceRegistry = require('me-platform-core');
  const EventEmitter = require('node:events');
  const eventEmitter = new EventEmitter();

  serviceRegistry.initialize(app, eventEmitter, {
    baseUrl: '/platform-core',
    name: 'Exclusivity',
    logDir: config.logDir,
    dataDir: config.dataDir,
    cacheDir: config.cacheDir,
    activitiesFolder: config.activitiesFolder,
    security: {
      // The member API carries its own session auth; the platform's own
      // dashboards are gated separately in production (§20.6).
      apiKeyAuth: { requireApiKey: false, apiKeys: [] },
      servicesAuth: { requireLogin: config.isProduction }
    }
  });

  const logger      = serviceRegistry.logger('file');
  const cache       = serviceRegistry.cache();                 // memory
  const dataService = serviceRegistry.dataService('file');
  const queue       = serviceRegistry.queue();                 // memory
  const scheduler   = serviceRegistry.scheduling();
  // The local provider reads `baseDir` — not `basePath` — and resolves every
  // path within it, which is what keeps media off the static route.
  const filing      = serviceRegistry.filing('local', { baseDir: config.mediaDir });
  const searching   = serviceRegistry.searching();
  const notifying   = serviceRegistry.notifying();
  const measuring   = serviceRegistry.measuring();
  const auth        = serviceRegistry.authservice('file', { dataDir: config.dataDir });

  platform = {
    registry: serviceRegistry, eventEmitter,
    logger, cache, dataService, queue, scheduler,
    filing, searching, notifying, measuring, auth
  };
  return platform;
}

/** Returns the already-initialized platform bundle; throws if called too early. */
function getPlatform() {
  if (!platform) throw new Error('Platform not initialized — call initPlatform(app) first');
  return platform;
}

module.exports = { initPlatform, getPlatform };
```

### 5.1 Platform API surface actually used

Verified against `me-platform-core@1.0.10`. Note the method names — several differ from the framework README.

| Service | Methods used | Notes |
|---|---|---|
| `caching` | `put(k,v)`, `get(k)`, `delete(k)`, `getAnalytics()` | **`put`, not `set`.** No TTL, no pattern-delete — hence the generation-counter design in §11. |
| `dataService` (file) | `add(c,obj) → key`, `getByUuid(c,key)`, `update(c,key,obj)`, `remove(c,key)`, `find(c,term)`, `listAll(c)`, `count(c)`, `createContainer(c)` | `add` returns only the generated key; `find('')` returns the whole container. See §10. |
| `queueing` | `enqueue(q,item)`, `dequeue(q)`, `size(q)`, `purge(q)` | In-memory; not durable across restart. |
| `scheduling` | `start(name, script, data, intervalSeconds, cb)`, `startCron(...)`, `stop(name)`, `listSchedules()` | Scripts resolved from `activitiesFolder`. |
| `filing` (local) | `create(path, content)`, `read(path, encoding)`, `update`, `delete`, `list(dir)` | `upload()` aliases `create()`. |
| `searching` | `add(key, obj, container)`, `replace`, `remove(key, container)`, `search(query, containerOrOptions)`, `saveToDisk()` | Tokenised inverted index; the discovery index (§12.1). |
| `authservice` (file) | `createUser`, `authenticateUser(email, pw)`, `updateUser(email, data)`, `validateSession(token)`, `logout(token)`, `deleteUser` | bcrypt hashing inside the provider. |
| `notifying` | topic publish/subscribe | In-process fan-out for the notification centre (§18). |
| `measuring` | metric capture | Feeds the ops dashboard (§21). |
| `logging` | `debug/info/warn/error` | File provider, `.application/logs`. |

### 5.2 New third-party dependencies

| Package | Why | Where |
|---|---|---|
| `multer` | multipart upload parsing | `middleware/upload.js` |
| `sharp` | derived image sizes, EXIF strip, re-encode | `mediaService` |
| `nodemailer` | transactional email | `emailService` (prod provider) |
| `passport-local`, `passport-google-oauth20` | credential and OAuth strategies | auth wiring |
| `uuid` | client-side idempotency keys for message send | shared |

`bcryptjs`, `express-rate-limit`, `helmet`, `express-session`, `socket.io` are already present.

---

## 6. Layering and Dependency Rules

```
routes/  ──▶  services/  ──▶  store.js / cacheVersion.js  ──▶  platform.js  ──▶  me-platform-core
   │              │
   └──▶ middleware/ (auth, entitlements, csrf, rate limits)
```

Enforced rules — violations are review-blocking:

1. **Routes never touch `store` or `dataService` directly.** They call a domain service.
2. **Domain services never import Express** and never see `req`/`res`. They take plain arguments and return plain data or throw typed errors.
3. **Only `platform.js` requires `me-platform-core`.** Every other module receives services by injection.
4. **Only `store.js` calls `dataService`.** Container names and the id-patching quirk are contained there.
5. **`scoring.js` is pure** — no I/O, no clock reads except an injected `now`. It is the most heavily unit-tested file in the codebase.
6. **Cross-service calls flow one way.** `matchingService` may call `entitlementService`; `entitlementService` may not call `matchingService`. Cycles are resolved by moving shared logic down, not by lazy requires.

Composition happens in `backend/app.js`, the single place where the object graph is assembled — the same pattern as `me-intermittent-fast`:

```js
function createApp() {
  const app = express();
  const platform = initPlatform(app);
  const { logger, cache, dataService, queue, scheduler, filing, searching, auth } = platform;

  const store          = createStore(dataService, logger);
  const versionedCache = createVersionedCache(cache);
  const activity       = createActivityService({ store, queue, logger });

  const members      = createMemberService({ store, versionedCache, activity });
  const entitlements = createEntitlementService({ members });
  const media        = createMediaService({ filing, store, activity });
  const verification = createVerificationService({ store, media, activity });
  const applications = createApplicationService({ store, members, verification, media, activity });
  const profiles     = createProfileService({ store, members, media, searching, versionedCache });
  const discovery    = createDiscoveryService({ store, members, profiles, entitlements, versionedCache });
  const matching     = createMatchingService({ store, members, discovery, activity });
  const messaging    = createMessagingService({ store, matching, moderation, entitlements, activity });
  const moderation   = createModerationService({ store, members, media, activity });
  const membership   = createMembershipService({ store, members, billing, activity });
  const notifications= createNotificationService({ store, notifying, email, members });
  /* … */
}
```

---

## 7. Request Lifecycle

```
POST /api/messages/:matchId
   │
   ├─ helmet                     security headers
   ├─ compression                gzip
   ├─ express.json({limit})      body parse
   ├─ session                    cookie → session record
   ├─ csrf                       double-submit token check (state-changing verbs)
   ├─ rateLimits.messaging       per-member burst + daily
   ├─ requireAuth                req.member populated or 401
   ├─ requireApproved            member.status === 'active' or 403
   ├─ requireEntitlement('message')  subscription state or 402
   │
   ├─ route handler              validate body, delegate — no rules here
   │     └─ messagingService.send({ memberId, matchId, text, idempotencyKey })
   │           ├─ matching.assertParticipant(memberId, matchId)   → 403 on failure
   │           ├─ moderation.scanFirstMessage(text, match)        → flag, never block
   │           ├─ store.create(`messages_${matchId}`, message)    → serialised write
   │           ├─ store.update('conversations', matchId, {...})   → lastMessageAt, unread
   │           ├─ versionedCache.bump('conversations')
   │           ├─ activity.log('message.sent', …)                 → queued, not awaited to disk
   │           └─ realtime.emitToMatch(matchId, 'message', msg)
   │
   ├─ res.status(201).json(message)
   └─ error middleware           typed error → status + code + safe message
```

The same authorisation chain runs on the socket path (§13). Neither path trusts the other's checks.

---

## 8. Domain Service Catalogue

| Service | Responsibility | Key operations |
|---|---|---|
| `memberService` | Member records, status transitions, roles | `get`, `getByEmail`, `create`, `updateStatus`, `pause`, `softDelete` |
| `applicationService` | Application lifecycle and the review queue | `start`, `saveStep`, `submit`, `queue`, `decide`, `withdraw`, `appeal` |
| `verificationService` | Badges and evidence | `runPreScreen`, `grantBadge`, `revokeBadge`, `matchLiveness`, `purgeDocuments` |
| `profileService` | Published profile projection, edit moderation | `get`, `publicView`, `update`, `submitForModeration` |
| `mediaService` | Upload, EXIF strip, derivatives, access control | `ingest`, `derive`, `authorizeRead`, `remove`, `hash` |
| `discoveryService` | Candidate pools, filters, browse | `candidatePool`, `browse`, `whoLikedMe`, `applyFilters` |
| `matchingService` | Likes, passes, matches, deck consumption | `like`, `pass`, `deck`, `assertParticipant`, `unmatch`, `expire` |
| `messagingService` | Conversations and messages | `send`, `history`, `markRead`, `conversations` |
| `moderationService` | Reports, queue, enforcement | `report`, `queue`, `act`, `scanFirstMessage`, `scanProfile` |
| `membershipService` | Tiers, subscription lifecycle | `subscribe`, `cancel`, `changeTier`, `sweepRenewals`, `state` |
| `entitlementService` | Tier → capability resolution | `for(member)`, `assert(member, key)`, `allowance(member, key)` |
| `notificationService` | In-app + email fan-out, preferences | `notify`, `list`, `markRead`, `preferences` |
| `searchIndexService` | Keeps the `searching` index in sync | `index`, `reindex`, `remove`, `query` |
| `adminService` | Ops read models | `funnel`, `queueDepth`, `ratios`, `auditExport` |
| `billingService` | PSP abstraction | `createSubscription`, `cancel`, `webhook`, `invoices` |
| `emailService` | Transactional email | `send(template, to, data)` |

`entitlementService` is the single source of truth for §5.1 of the PRD. The tier matrix is data, not code:

```js
const TIERS = {
  select:    { deck: 12, likesPerDay: Infinity, whoLikedYou: true,  filters: true,
               travel: true,  readReceipts: true,  incognito: true,  boosts: 0 },
  signature: { deck: 5,  likesPerDay: 10,       whoLikedYou: false, filters: false,
               travel: false, readReceipts: false, incognito: false, boosts: 0 },
  elite:     { deck: 12, likesPerDay: 40,       whoLikedYou: true,  filters: true,
               travel: true,  readReceipts: true,  incognito: false, boosts: 2 },
  noir:      { deck: 25, likesPerDay: Infinity, whoLikedYou: true,  filters: true,
               travel: true,  readReceipts: true,  incognito: true,  boosts: 8 }
};
```

---

## 9. Data Model

Each **container** is one JSON file under `.application/data`, keyed by generated UUID. Records carry their own `id` (the store patches it after `add`, per the existing `store.js` convention).

### 9.1 Containers

| Container | Contents | Growth | Notes |
|---|---|---|---|
| `members` | Account, status, role, tier ref | O(members) | Hot; cached |
| `profiles` | Published profile projection | O(members) | Read-heavy; drives the deck |
| `preferences` | Discovery + notification preferences | O(members) | |
| `applications` | Application submissions + decisions | O(applications) | Queue read model |
| `verifications` | Badge grants, evidence metadata | O(members × badges) | Never holds document binaries |
| `photos` | Photo metadata, moderation state, hashes | O(photos) | Binaries live in `filing` |
| `likes` | Directional like/pass records | O(actions) — largest | Sharded, §10.3 |
| `matches` | Mutual matches | O(matches) | |
| `conversations` | Match-level metadata: last message, unread | O(matches) | Inbox read model |
| `messages_{matchId}` | Messages for one match | Bounded per container | One container per match, AD-6 |
| `blocks` | Directional blocks | O(blocks) | Loaded into a per-member set |
| `reports` | Member reports | O(reports) | |
| `moderation_actions` | Enforcement record | O(actions) | Immutable |
| `subscriptions` | Subscription state + history | O(members) | |
| `invoices` | Billing records | O(invoices) | 7-year retention |
| `invites` | Invite codes, quota, redemptions | small | |
| `decks_{yyyy-mm-dd}` | Generated daily decks | O(active members) / day | Pruned after 7 days |
| `notifications` | In-app notification centre | O(events) | Pruned at 90 days |
| `activity_log` | Audit trail | O(events) | Write-behind, §17 |
| `banned_identities` | Email + photo hashes of banned accounts | small | Re-registration block |

### 9.2 Core record shapes

```js
// members
{
  id, email, emailHash, status,           // pending|in_review|waitlisted|active|paused|
                                          // dormant|suspended|banned|deleted
  role,                                   // member|moderator|admin
  side,                                   // male|female
  createdAt, approvedAt, lastActiveAt,
  tier,                                   // select|signature|elite|noir|null
  badges: ['identity','photo','means','professional'],
  city, geoBand, timezone,
  flags: { prescreen: [], riskScore },
  suspendedUntil, banReason
}

// profiles
{
  id, memberId, firstName, dateOfBirth,   // age derived on read; DOB never returned
  occupation, employer, education, height,
  intent, smoking, drinking, children,
  bio, prompts: [{ q, a }],
  photoIds: [], primaryPhotoId,
  city, distanceBandFrom: { lat, lon },   // coarse centroid only — never precise
  moderationState,                        // pending|live|rejected
  liveVersion, pendingVersion,
  completeness, updatedAt
}

// likes  (container: likes_{shardKey})
{ id, fromMemberId, toMemberId, action, source, createdAt }
                                          // action: like|pass ; source: deck|browse|likedYou

// matches
{ id, memberIds: [a, b], createdAt, source,
  state,                                  // active|expired|unmatched
  firstMessageAt, unmatchedBy, unmatchedAt, expiresAt }

// messages_{matchId}
{ id, matchId, senderId, text, createdAt,
  idempotencyKey, readAt, flags: [], deliveryState }

// photos
{ id, memberId, storageKey, derived: { '160':k, '480':k, '1080':k },
  contentHash, moderationState, uploadedAt, isPrimary, width, height }

// applications
{ id, memberId, side, submittedAt, priority,
  answers: {...}, photoIds: [], livenessId,
  means: { incomeBand, employer, evidenceType, documentRef },
  prescreenFlags: [],
  decision: { outcome, reasonCode, note, reviewerId, decidedAt },
  appealOf }

// subscriptions
{ id, memberId, tier, term, state, provider, providerRef,
  startedAt, currentPeriodEnd, cancelledAt, cancelReason, graceUntil }
```

### 9.3 Derived, never stored

- **Age** — derived from `dateOfBirth` on read; the API never returns a date of birth.
- **Distance band** — derived from two coarse centroids; precise coordinates are never persisted (PRD F3.3).
- **Entitlements** — derived from subscription state at request time, never denormalised onto the member.
- **Unread counts** — maintained on `conversations` as a read model, rebuildable from messages.

---

## 10. Storage Strategy and File-Store Constraints

The file `dataService` provider is a JSON-document store with real, specific limits. Designing around them honestly is the difference between a prototype that survives a demo and one that corrupts data on the second concurrent user.

### 10.1 What the provider actually does

- `add(container, obj)` → generates a UUID key, **returns only the key**. The store wrapper patches `id` onto the record and re-`update`s it, as in the existing app.
- `find(container, term)` with an empty term returns **every object in the container**. With a term it does a **recursive, case-insensitive substring scan over every string value** in every record — O(container × fields). It is not an index.
- `update` and `remove` read the entire container file, mutate the object map, and write the entire file back.

**Consequence:** `dataService.find` is unusable for discovery queries. Filtering happens in `discoveryService` over a cached, in-memory projection; keyword search goes through the `searching` service index (§12.1). `find` is used only with an empty term, as a list.

### 10.2 Serialisation (AD-7)

Two distinct hazards, both real, both observed during the build:

1. **Lost updates.** Read-modify-write with `await` points between read and write means two concurrent writes to one container interleave and one is silently lost.
2. **Torn reads.** `_writeContainerData` is a plain `fs.writeFile` — truncate, then write. A read landing mid-write gets a truncated file and fails to parse.

The second one is the nastier of the two: an early build serialised only writes, and a concurrent read of `members.json` during a write returned a parse failure that the store was translating into `null`. That surfaced as *"Member not found"* on a member who plainly existed, and — because the auth middleware treats a missing member as a dead session — it destroyed the reviewer's session mid-decision.

So `store.js` serialises **every** operation, reads included, on a per-container promise chain, and no longer masks read failures as absence. A missing container already reads as `{}` from the provider, so absence is representable without an error; anything that throws is a genuine failure and must propagate.

The cost is that a read waits behind an in-flight write to the same container — microseconds at this scale, and the correct trade for a store with no atomic writes.

```js
'use strict';

/**
 * CRUD over the platform-core file dataService, with per-container write
 * serialisation. The provider does read-modify-write on a whole-file JSON
 * document; two overlapping writes to the same container would interleave at
 * their await points and silently drop one. Every mutating call therefore
 * queues on a per-container promise chain.
 */
function createStore(dataService, logger) {
  const chains = new Map();

  function serialise(container, task) {
    const previous = chains.get(container) || Promise.resolve();
    const next = previous.then(task, task);
    // Keep the chain alive but never let a rejection poison the next writer.
    chains.set(container, next.catch(() => {}));
    return next;
  }

  return {
    list:   (c)        => dataService.find(c, ''),
    get:    (c, id)    => (id ? dataService.getByUuid(c, id) : Promise.resolve(null)),
    count:  (c)        => dataService.count(c),

    create: (c, data)  => serialise(c, async () => {
      const id = await dataService.add(c, data);
      const record = { ...data, id };
      await dataService.update(c, id, record);
      return record;
    }),

    update: (c, id, patch) => serialise(c, async () => {
      const existing = await dataService.getByUuid(c, id);
      if (!existing) return null;
      const updated = { ...existing, ...patch, id };
      await dataService.update(c, id, updated);
      return updated;
    }),

    remove: (c, id) => serialise(c, () => dataService.remove(c, id))
  };
}

module.exports = { createStore };
```

This is the single most important difference from the read-mostly apps in this suite: a dating app has genuinely concurrent writers on shared containers.

### 10.3 Container sizing and sharding

Whole-file reads mean a container's size is its read cost. Three containers grow without bound and are sharded:

| Container | Strategy |
|---|---|
| `messages` | One container per match: `messages_{matchId}`. A send reads only that conversation. Cross-match queries are impossible by design — `conversations` is the inbox read model. |
| `likes` | Sharded by the first two hex characters of `toMemberId`: `likes_{xx}` — 256 containers, each bounded. "Who liked me" reads one shard and filters. |
| `decks` | One container per day: `decks_{yyyy-mm-dd}`, pruned after 7 days by `retentionSweep`. |

`members`, `profiles` and `conversations` stay single containers and are held in the versioned cache; at the 5 000-member v1 ceiling (PRD §8) a full profile container is roughly 5–8 MB — acceptable to read once and cache, unacceptable to read per request. Crossing that ceiling is the migration trigger (§25).

### 10.4 Consistency

There are no transactions. Two operations span containers and must be idempotent and re-runnable:

- **Match creation** — write the match, then both `conversations` sides. If the second write fails, `matchExpiry` reconciles matches without conversations on its next pass.
- **Photo ingest** — write the binary through `filing` first, then the `photos` metadata record. An orphaned binary is harmless and swept by `retentionSweep`; a metadata record with no binary is not, so ordering is fixed.

Message sends carry a client-generated `idempotencyKey`; a retry with the same key returns the existing message rather than duplicating it.

---

## 11. Caching Strategy

The platform cache is `put`/`get`/`delete` only — **no TTL and no pattern-delete**. The suite's answer is a generation counter: every write bumps a version, and cached computations key themselves off it, so a bump orphans a whole generation without walking keys.

Exclusivity extends the `me-intermittent-fast` version of this with **namespaces**, because one global counter would flush the profile cache on every message send:

```js
'use strict';

const NAMESPACES = ['members', 'profiles', 'decks', 'conversations', 'moderation'];

/**
 * Generation-counter cache, namespaced. Each namespace owns a version number;
 * a write bumps only its own namespace, so message traffic never invalidates
 * the profile projection. The underlying cache has no pattern-delete — a bump
 * silently orphans the previous generation's keys instead of walking them.
 */
function createVersionedCache(cache) {
  const versionKey = (ns) => `exclusivity:v:${ns}`;

  async function version(ns) {
    return (await cache.get(versionKey(ns))) || 0;
  }

  async function bump(ns) {
    const next = (await version(ns)) + 1;
    await cache.put(versionKey(ns), next);
    return next;
  }

  async function remember(ns, keyPrefix, compute) {
    const key = `${ns}:${keyPrefix}:v${await version(ns)}`;
    const cached = await cache.get(key);
    if (cached !== undefined) return cached;
    const value = await compute();
    await cache.put(key, value);
    return value;
  }

  return { bump, version, remember, NAMESPACES };
}
```

### What is cached

| Key | Namespace | Invalidated by |
|---|---|---|
| Full profile projection (id → profile) | `profiles` | Any profile publish or photo moderation |
| Member lookup by id and by email | `members` | Status, tier or role change |
| Today's deck per member | `decks` | Deck job, or a like/pass consuming a card |
| Inbox for a member | `conversations` | Message send, read, unmatch |
| Moderation queue depth | `moderation` | Report filed or actioned |

Blocks are **not** cached through this mechanism — they are held in a per-member `Set` rebuilt on login and updated synchronously on block, because a stale block is a safety failure (PRD F7.1 acceptance).

---

## 12. Matching Engine and Deck Generation

### 12.1 Candidate selection

Hard filters, applied before scoring (PRD F4.2) — every one is a correctness requirement, not a preference:

```
eligible(viewer, candidate) =
     candidate.status === 'active'
  && candidate.moderationState === 'live'
  && mutualGenderPreference(viewer, candidate)
  && ageWithinBothRanges(viewer, candidate)
  && distanceWithinPreference(viewer, candidate)
  && !actedUpon(viewer, candidate)            // no repeat cards
  && !blockedEitherWay(viewer, candidate)
  && !(candidate.incognito && !likedViewer)   // Noir/Select invisibility
  && !sameMember(viewer, candidate)
```

Keyword and filter queries in **browse** (F4.7) run through the `searching` service, which holds a tokenised index of live profiles in the `profiles` container, kept in sync by `searchIndexService` on every publish and moderation transition. `dataService.find` is never used for this (§10.1).

### 12.2 Scoring

`scoring.js` is pure and fully unit-tested. Weights live in config so they are tunable without a deploy (PRD F9.8).

```js
score(viewer, candidate, ctx) =
    W.preference   * preferenceFit(viewer, candidate)      // declared criteria overlap
  + W.reciprocity  * reciprocityLikelihood(candidate, ctx) // candidate's like-back rate,
                                                            // damped for low sample size
  + W.completeness * profileCompleteness(candidate)
  + W.verification * verificationDepth(candidate)          // badge count, weighted
  + W.recency      * activityRecency(candidate, ctx.now)   // decays over 14 days
  + W.diversity    * diversityTerm(candidate, ctx.recentlyShown)  // negative for repeats
  + W.boost        * activeBoost(candidate, ctx.now)
```

Explicitly absent: any facial, body or attractiveness model (PRD §2). `verificationDepth` and `completeness` are the quality signals, and both are things a member controls.

**Reciprocity damping** matters more than it looks: without it, the highest-like-back-rate profiles are shown to everyone and burn out within a week. The term uses a Bayesian shrink toward the population mean with a 20-interaction prior.

### 12.3 Deck generation

`jobs/dailyDecks.js` runs nightly at 03:00 and writes `decks_{yyyy-mm-dd}`:

```
for each active member (batched, 50 at a time):
    pool     = eligible candidates from cached profile projection
    scored   = pool.map(score).sort(desc)
    selected = topN(scored, tierDeckSize) with a diversity pass that caps
               any one candidate's appearances across all decks that night
    write decks_{date}: { memberId, cardIds, generatedAt, consumed: [] }
```

The **global appearance cap** is the important bit: without it, the top-scoring dozen profiles appear in every deck in the city, receive hundreds of likes each, and everyone else receives none — the classic dating-app failure mode. Each candidate is capped at appearing in a bounded fraction of the night's decks, enforced by a counter carried through generation.

Decks are generated as *card id lists*, not snapshots. Cards are hydrated from the cached profile projection at read time, so a profile edited or suspended overnight is reflected or dropped rather than served stale.

If the job has not run (first boot, or a missed night), `discoveryService.deck()` generates that member's deck on demand and caches it. The job is an optimisation, never a correctness dependency.

---

## 13. Realtime Layer

`socket.io` attaches to the same HTTP server. It is **not** a second authorisation domain.

```
handshake
   └─ parse the session cookie with the same session store as Express
      └─ no session, or member not active → disconnect immediately
         └─ socket.data.memberId = session.memberId
            └─ join room `member:{memberId}`
```

Rooms:

| Room | Purpose |
|---|---|
| `member:{id}` | Personal events: new match, notification, moderation outcome, forced sign-out |
| `match:{id}` | Message, typing, read receipts — joined only after `matching.assertParticipant` |

Every inbound socket event re-runs the same service-layer authorisation as the REST path. `messagingService.send` is the single implementation both call; the socket handler is a transport, not an alternative rule set. A member suspended mid-session is disconnected from `member:{id}` and their sockets are dropped.

Message delivery is at-least-once with client-side deduplication on `idempotencyKey`. REST is the source of truth: the client posts the message and treats the socket echo as delivery confirmation, so a dropped socket degrades to polling rather than to lost messages.

---

## 14. Media Pipeline

The most security-sensitive path in the application — and the one place where a lazy `express.static` would undo the entire privacy posture (PRD F3.4).

```
upload ──▶ multer (memory, 12 MB cap, MIME + magic-byte check)
        ──▶ sharp: strip EXIF, auto-orient, re-encode to JPEG
        ──▶ derivatives: 160 (thumb) · 480 (card) · 1080 (detail)
        ──▶ perceptual hash → banned-identity and duplicate check
        ──▶ filing.create('originals/{memberId}/{photoId}.jpg', buffer)
            filing.create('derived/{size}/{photoId}.jpg', buffer)
        ──▶ store.create('photos', { …metadata, moderationState: 'pending' })
        ──▶ moderation queue
```

**Re-encoding through sharp is a security control, not just a resize.** It strips EXIF including GPS (PRD F1.4 acceptance), and it neutralises polyglot files that pass a MIME check but carry executable payloads.

### Serving

```
GET /api/photos/:photoId/:size
   ├─ requireAuth, requireApproved
   ├─ mediaService.authorizeRead(viewer, photo)
   │     ├─ owner?                        → allow any size
   │     ├─ moderator/admin?              → allow, and audit the access
   │     ├─ photo live and not blocked and viewer may see this profile? → allow
   │     └─ otherwise                     → 404, never 403 (no existence disclosure)
   ├─ filing.read(derivedKey)
   └─ stream with Cache-Control: private, max-age=300
```

Originals are never served — only derivatives. `.application/media` sits outside `public/` and no static handler is mounted over it. Means-verification documents live under `documents/`, are readable only by `moderator`/`admin` with every access audited, and are deleted by `retentionSweep` on the decision + 0 boundary (PRD F2.9).

---

## 15. Authentication, Authorisation and Entitlements

### 15.1 Authentication

`authservice('file')` owns credentials and bcrypt hashing. Sessions are Express sessions in a file-backed store, cookie `httpOnly`, `sameSite=lax`, `secure` in production, 30-day rolling expiry. Google OAuth via `passport-google-oauth20` links to the same member record by verified email.

### 15.2 Authorisation — three independent gates

```js
requireAuth              // a session exists and resolves to a member
requireApproved          // member.status === 'active' — blocks pending, paused,
                         // dormant, suspended, banned
requireRole('moderator') // role check for /api/admin/*
requireEntitlement(key)  // tier capability, resolved server-side per request
```

They compose and are never substituted for each other. Resource-level checks (is this member a participant in this match, may this member see this photo) live in the domain services — middleware cannot know them.

### 15.3 Entitlement enforcement

Every gated action resolves entitlements from **current subscription state**, not from a value cached on the member and not from anything the client sent (PRD F6.4 acceptance):

```js
async function assert(member, key) {
  const subscription = await membership.state(member.id);
  const tier = member.side === 'female' ? 'select' : subscription.activeTier;
  const allowed = TIERS[tier]?.[key];
  if (!allowed) throw new EntitlementError(key, tier);
  return allowed;
}
```

Daily allowances (likes, deck size) are counted server-side against the day's records in the member's timezone, and returned to the client on every relevant response so the UI shows a remaining count from the same source of truth (PRD F4.6).

---

## 16. Background Jobs

Jobs run **in-process** from `backend/jobs/index.js`, not through the platform `scheduling` service (AD-9).

The platform scheduler executes an isolated activity script in a worker, passing only a data directory. That suits a self-contained task like the streak snapshot in `me-intermittent-fast`. Every job here is a domain operation over the live service graph — deck generation needs entitlements and the profile projection, the retention sweep needs media and verification, the subscription sweep needs notifications. Running them in a worker would mean rebuilding the composition root inside it, so they run against the real graph instead.

| Job | Cadence | Responsibility |
|---|---|---|
| `dailyDecks` | 03:00 daily | Generate tomorrow's decks (§12.3) |
| `matchExpiry` | Hourly | Expire matches with no first message past 7 days; send 5-day reminders; reconcile matches missing conversations |
| `subscriptionSweep` | Hourly | Advance `past_due` → grace → dormant; trigger renewal notifications; downgrade entitlements |
| `reviewSla` | Every 15 min | Alert on applications approaching the 48h SLA; recompute queue priority |
| `retentionSweep` | 04:00 daily | Delete means documents past decision; purge liveness selfies at 90 days; prune decks, notifications and unmatched conversations per PRD §9; sweep orphaned media |
| `metricsSnapshot` | Hourly | Write funnel, ratio and queue-depth metrics for the ops dashboard |

Jobs are **idempotent and restart-safe** — none assume they ran, and each recomputes from persisted state, so a missed window is caught up rather than skipped. A staggered boot pass runs `matchExpiry`, `subscriptionSweep` and `dailyDecks` a few seconds after start, and rebuilds the search index. `GET /api/admin/ops/jobs` reports last-run state; `POST /api/admin/ops/jobs/:name/run` triggers one by hand.

---

## 17. Audit and Activity Trail

The write-behind pattern from `me-intermittent-fast`, retained because the reasoning holds harder here: sending a message must not wait on an audit write.

```js
activity.log('application.decided', `${reviewerId} → ${outcome}`, { applicationId, reasonCode });
```

`log()` only enqueues. A drain loop persists to `activity_log` on its own cadence. Two changes for Exclusivity:

1. **Moderation, verification and billing events are written synchronously**, not queued. The in-memory queue is not durable across a crash, and PRD §4.6 requires those records to be complete. Losing "member liked a card" is acceptable; losing "reviewer banned a member" is not.
2. **Audit records are append-only.** `store.update` is never called on `activity_log` or `moderation_actions`; corrections are new records referencing the original.

---

## 18. Notifications

```
domain event ──▶ notificationService.notify(memberId, type, payload)
                  ├─ preferences check (per-category, server-side)
                  ├─ store.create('notifications', …)      → in-app centre
                  ├─ realtime → member:{id}                 → live badge
                  └─ emailService.send(template, …)         → if category is email-enabled
```

`notifying` from the platform provides in-process topic fan-out so services publish without knowing subscribers. Email goes through an app-level `emailService` with a `stub` provider in development (writes to `.application/logs`) and nodemailer SMTP in production — the platform's notifying service is a message bus, not a mail transport.

Digest and reminder emails are rate-limited per member per category (PRD F8.5) inside `notificationService`, not at the transport, so the cap survives a provider change.

---

## 19. Frontend Architecture

Plain HTML, CSS and ES modules. No build step, no framework, no bundler — consistent with the rest of the suite and with `public/` as it stands today.

```
public/
├── index.html          app shell: header, <main id="view-root">, tab bar, modal root, toast
├── app.js              boot: service worker, session check, router init
├── js/
│   ├── router.js       hash router — same pattern as me-intermittent-fast
│   ├── api.js          fetch wrapper: CSRF header, 401 → sign-in, typed errors
│   ├── realtime.js     socket.io client, reconnect, event → view dispatch
│   ├── components/     modal, card, badge, photoGrid, chatBubble, allowanceMeter
│   └── views/          apply, discover, matches, chat, profile, settings, admin
└── sw.js               shell caching, offline read-only, outbound message queue
```

Routes: `#/discover`, `#/matches`, `#/chat/:matchId`, `#/profile`, `#/settings`, `#/apply`, `#/admin`.

Conventions carried over: each view exports a single `render(root)`; the router shows a skeleton, awaits render, and renders an error state on throw; `refreshCurrentRoute()` after a modal save; no view touches `fetch` directly.

Additions for this app:

- **The gate is server-decided.** `/auth/me` returns a `next` step derived from real status, and the router honours it. The client enforces it for coherence, never for security — every screen it guards is independently gated server-side.
- **A stale session never strands a member.** The cached session lags the server the moment a reviewer approves someone whose tab is open. Before the router refuses a navigation it re-reads `/auth/me` once and re-resolves, so a member approved thirty seconds ago is not stuck on "your application is being read" until they think to refresh. The realtime `notification:new` handler does the same proactively for application, membership and moderation events.
- **`realtime.js` speaks engine.io directly.** socket.io's browser bundle is not vendored — there is no build step, and the CSP allows scripts from `self` only — so the client implements the small, stable engine.io framing itself (`0` open → `40` connect → `42[event, payload]`, `2`/`3` heartbeat).
- **`realtime.js` dispatch** — socket events invalidate view state and trigger a targeted re-render rather than a full route re-render, so an incoming message does not rebuild the chat scroll position.
- **Optimistic message send** — the bubble renders immediately with a pending state, reconciled by `idempotencyKey` on the server response.
- **Photo loading** — cards request the 480 derivative, detail the 1080; both go through the authorised endpoint (§14), so no `<img>` points at a static path.
- **Admin views** are the same shell with a role-gated route; the server refuses `/api/admin/*` regardless of what the client renders.

---

## 20. Security Architecture

| Control | Implementation |
|---|---|
| Transport | HTTPS enforced in production; HSTS via helmet |
| Headers | `helmet` with a Content-Security-Policy allowing only self plus the Google Fonts origins used by `index.html` |
| Session | httpOnly, sameSite=lax, secure in production, rotated on privilege change, invalidated on password change and on ban |
| CSRF | Double-submit token on all state-changing verbs; the socket handshake reuses the session, not a bearer token |
| Passwords | bcrypt inside `authservice`; minimum length and breach-list check at registration |
| Rate limiting | Per-route classes via `express-rate-limit`: auth (5/min), upload (20/hr), messaging (burst + daily), likes (tier allowance), reports (10/day) |
| Input validation | Every route validates shape, type and length before delegating; unknown fields are dropped, not passed through |
| Output encoding | Frontend renders through `escapeHtml`; no `innerHTML` with member-supplied content anywhere |
| Authorisation | Server-side on every resource; ownership and participation checked in services, never inferred from the request |
| Media | No static exposure; authorised streaming; re-encode on ingest; 404 rather than 403 on unauthorised (no existence disclosure) |
| PII at rest | Means documents deleted post-decision; email stored alongside a hash for ban matching; no precise location ever persisted |
| Secrets | Environment only, via `dotenv`; nothing in the repository; `.application/` git-ignored |
| Platform dashboards | `/platform-core` requires login in production (`servicesAuth.requireLogin`) and is bound to admin roles |
| Enumeration | Sign-in, password reset and application status return uniform responses regardless of account existence |
| Dependencies | `npm audit` in CI; `me-platform-core` pinned as a local sibling path |

**Threat model — the three that matter most for this product:**

1. **Catfishing and fake profiles.** Mitigated by liveness matching (F1.5), human review (F2.3), photo hashing against banned identities, and duplicate-photo detection at ingest.
2. **Scam and solicitation.** Mitigated by first-message scanning (F5.3), scam heuristics (F7.7), the ban-first policy on confirmed solicitation, and the absence of any member-to-member payment rail (PRD §2) — the last of which removes the payoff rather than detecting the attempt.
3. **Harvesting.** A membership pool of verified affluent members is a scraping target. Mitigated by authenticated-only profile access, no public URLs, per-member rate limits on browse and profile reads, deck size caps as a natural throttle, and anomaly alerts on read volume per session.

---

## 21. Observability

- **Logs** — `logging('file')` to `.application/logs`, structured, with a request id per HTTP request carried into service calls and socket events.
- **Metrics** — `measuring` captures counters and timings: request latency by route class, deck generation duration, queue depths, moderation SLA, socket connection count.
- **Platform dashboards** — `/platform-core` exposes per-service dashboards (cache hit rate, queue depth, data service operations, scheduled task state) with no work on our side.
- **Ops dashboard** — `/admin/ops` renders the PRD §10 funnel and guardrail metrics from `metricsSnapshot` output.
- **Health** — `GET /api/health` returns process uptime, platform service status and last job run times.
- **Alarms** (v1: log-level, wired to email) — review SLA breach, moderation backlog > 4h, gender ratio > 2.0 in a city, report rate spike, failed renewal rate spike.

---

## 22. Error Handling Conventions

Domain services throw **typed errors**; the API error middleware is the only place that maps them to HTTP.

```js
class DomainError extends Error { constructor(code, message, status = 400) { … } }

NotFoundError        → 404   ValidationError    → 400
AuthError            → 401   ForbiddenError     → 403
EntitlementError     → 402 { code: 'entitlement_required', tier, required }
AllowanceError       → 429 { code: 'allowance_exhausted', resets_at }
ModerationError      → 403 { code: 'content_blocked' }
```

The error middleware, extending the pattern already in `routes/index.js`:

```js
router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  services.logger.error(`[api] ${req.method} ${req.originalUrl} — ${err.message}`, {
    requestId: req.id, memberId: req.member?.id, code: err.code
  });
  res.status(status).json({
    error: status === 500 ? 'Something went wrong' : err.message,
    code: err.code,
    ...(err.details || {})
  });
});
```

Internal errors never leak a message or stack to the client. Every 4xx carries a machine-readable `code` so the frontend can react (upsell on `entitlement_required`, countdown on `allowance_exhausted`) without string matching.

---

## 23. Testing Strategy

| Layer | Tool | Coverage target |
|---|---|---|
| Pure logic — `scoring.js`, entitlements, allowance maths, distance banding, age derivation | Jest | 100% branch |
| Domain services with in-memory fakes for store/cache/queue | Jest | 90% |
| API routes, end to end against a built app | Jest + supertest | All routes, both authorised and unauthorised paths |
| Realtime handlers | socket.io-client against a test server | Send, receive, authorisation refusal, disconnect on suspend |
| Security regression | supertest | One test per row in the §20 table where testable |

Non-negotiable test cases, drawn from the PRD acceptance criteria:

- A blocked member never appears in a deck, browse result or "who liked you" list, in either direction.
- A message send to a match the sender does not belong to returns 403 on both REST and socket.
- A client claiming a higher tier receives the entitlements of its actual subscription.
- An EXIF-laden upload produces a stored file with no EXIF block.
- A means document is unreadable and absent from disk after `retentionSweep` runs post-decision.
- Two concurrent writes to the same container both persist (the §10.2 mutex).
- An under-18 date of birth is refused server-side even when the client sends it directly.

---

## 24. Configuration and Environment

`backend/config.js` remains the single source, extending the existing shape:

```js
const ROOT_DIR = path.join(__dirname, '..');
const APPLICATION_DIR = path.join(ROOT_DIR, '.application');

module.exports = {
  port: process.env.PORT || 9401,
  isProduction: process.env.NODE_ENV === 'production',
  rootDir: ROOT_DIR,
  publicDir: path.join(ROOT_DIR, 'public'),
  logDir:   path.join(APPLICATION_DIR, 'logs'),
  dataDir:  path.join(APPLICATION_DIR, 'data'),
  mediaDir: path.join(APPLICATION_DIR, 'media'),
  cacheDir: path.join(APPLICATION_DIR, 'caching'),
  searchDir: path.join(APPLICATION_DIR, 'search'),
  activitiesFolder: path.join(__dirname, 'jobs'),
  locale: 'en-ZA',
  currency: 'ZAR',
  session: { secret: process.env.SESSION_SECRET, maxAgeDays: 30 },
  media: { maxUploadBytes: 12 * 1024 * 1024, sizes: [160, 480, 1080] },
  matching: {
    weights: { preference: 0.30, reciprocity: 0.25, completeness: 0.15,
               verification: 0.15, recency: 0.10, diversity: 0.05, boost: 0.10 },
    appearanceCapRatio: 0.15,     // max share of a night's decks one profile may occupy
    reciprocityPrior: 20
  },
  matchExpiryDays: 7,
  reviewSlaHours: 48,
  retention: { livenessDays: 90, unmatchedMessagesDays: 90,
               notificationDays: 90, deckDays: 7 }
};
```

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 9401) |
| `NODE_ENV` | Drives secure cookies, dashboard auth, email provider |
| `SESSION_SECRET` | Session signing — **required in production** |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth |
| `SMTP_*` | Email transport |
| `PAYSTACK_SECRET_KEY` / `STRIPE_SECRET_KEY` | Billing, when the stub is replaced |

Boot fails fast in production if `SESSION_SECRET` is unset — a generated fallback would silently invalidate every session on restart.

---

## 25. Scaling and Migration Path

The provider abstraction is the whole point. Migration is a change in `platform.js` plus a data move — no domain service changes.

| Trigger | Change | Blast radius |
|---|---|---|
| > 5 000 members, or profile container reads dominating latency | `dataService('mongodb', { connectionString, database })` | `platform.js` one line + a container→collection migration script. `store.js` may keep its interface; the mutex becomes unnecessary but harmless. |
| Multiple processes or instances | `cache('redis')`, `queue('redis')` | `platform.js`. The generation-counter cache works unchanged across instances — that is why it was chosen over pattern-delete. |
| Media volume or CDN need | `filing('s3', { bucket, region })` | `platform.js`. `mediaService` calls `filing` only; the authorised-streaming endpoint stays, or moves to signed URLs. |
| Socket across instances | socket.io Redis adapter | `realtime/index.js` |
| Sessions across instances | Redis session store | session middleware |
| Search volume | `searching` with a persistent backend, or Elasticsearch | `searchIndexService` only |

**What does not migrate cleanly, and must be planned:** the `messages_{matchId}` sharding (§10.3) is a file-store adaptation. On MongoDB it becomes one `messages` collection with a compound index on `{ matchId, createdAt }`. That is a genuine migration script, not a config change — it is the one place where the prototype shape leaves a mark, and it is a deliberate trade for bounded reads today.

---

## 26. Risks and Mitigations

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R-1 | File-store concurrency corrupts data under real load | Critical | Per-container write mutex (§10.2), tested; migration trigger defined (§25) |
| R-2 | In-memory queue loses audit events on crash | High | Moderation, verification and billing events written synchronously (§17) |
| R-3 | Gender ratio skews and the female side leaves | Existential | Ratio guardrail with a hard alarm at 2.0; throttle male approvals per city rather than chase growth (PRD §10) |
| R-4 | Human review queue becomes the bottleneck | High | SLA job with alerting; pre-screen flags (F2.2) can be promoted from advisory to decisive; priority queue for paying tiers |
| R-5 | Photo moderation cost scales linearly with growth | Medium | v1 human queue with backlog alarm; v2 automated pre-classification, human only on uncertainty |
| R-6 | Scraping of a high-value verified pool | High | Authenticated-only access, no public URLs, per-session read anomaly alerts (§20) |
| R-7 | Solicitation drift turns the platform into something else | Critical | The §2 guardrails are enforced in product (no payment rail), in policy, and in detection (F5.3, F7.4) |
| R-8 | Deck concentration burns out top profiles | Medium | Global appearance cap and reciprocity damping in generation (§12.3) |
| R-9 | Single process is a single point of failure | Medium | Accepted at prototype scale; process manager with restart; jobs are restart-safe (§16) |
| R-10 | PSP declines the account on category grounds | High | §2 positioning is the mitigation; validate with the PSP before M4 rather than after |

---

## Appendix A — API Surface

All routes are prefixed `/api`. Every route requires an authenticated session unless marked ○.

| Method | Path | Purpose |
|---|---|---|
| ○ POST | `/auth/register` | Start an application account |
| ○ POST | `/auth/login` | Credential sign-in |
| ○ GET | `/auth/google` · `/auth/google/callback` | OAuth |
| POST | `/auth/logout` | End session |
| GET | `/auth/sessions` · DELETE `/auth/sessions` | List / revoke all sessions |
| GET/PUT | `/applications/mine` | Read or save the in-progress application |
| POST | `/applications/mine/submit` | Submit for review |
| DELETE | `/applications/mine` | Withdraw |
| POST | `/applications/mine/appeal` | Appeal a decline |
| GET/PUT | `/profile` | Own profile |
| GET | `/profile/:memberId` | Another member's profile (authorised projection) |
| POST | `/photos` · DELETE `/photos/:id` · PUT `/photos/:id/primary` | Photo management |
| GET | `/photos/:photoId/:size` | Authorised image stream (§14) |
| GET | `/discovery/deck` | Today's introductions, with remaining allowance |
| GET | `/discovery/browse` | Filtered browse (entitlement-gated) |
| GET | `/discovery/liked-me` | Who liked you (entitlement-gated) |
| POST | `/discovery/like` · `/discovery/pass` | Act on a card |
| GET | `/matches` | Inbox |
| DELETE | `/matches/:id` | Unmatch |
| GET | `/messages/:matchId` | History, paginated |
| POST | `/messages/:matchId` | Send |
| POST | `/messages/:matchId/read` | Mark read |
| GET | `/membership` · POST `/membership/subscribe` · POST `/membership/cancel` · POST `/membership/change-tier` | Subscription lifecycle |
| GET | `/membership/invoices` | Billing history |
| POST | `/reports` | Report a member |
| POST | `/blocks` · DELETE `/blocks/:memberId` | Block management |
| GET | `/notifications` · POST `/notifications/read` | Notification centre |
| GET/PUT | `/settings` · `/settings/preferences` · `/settings/notifications` | Settings |
| POST | `/settings/pause` · `/settings/delete` · `/settings/export` | Account lifecycle |
| ○ GET | `/health` | Liveness and platform status |
| GET | `/admin/review/queue` · POST `/admin/review/:id/decide` | Application review |
| GET | `/admin/moderation/queue` · POST `/admin/moderation/:id/act` | Moderation |
| GET | `/admin/members` · `/admin/members/:id` · POST `/admin/members/:id/:action` | Member administration |
| GET | `/admin/ops/metrics` · `/admin/ops/audit` | Operations |
| POST | `/admin/invites` | Invite code issuance |

---

*Companion document: [Product Requirements](./Product%20Requirements.md).*
