'use strict';

/**
 * @fileoverview Candidate pools, daily decks and browse.
 *
 * Filtering runs over a cached in-memory projection, never over
 * `dataService.find` — the file provider's find is a recursive substring scan
 * over every string in every record, which is not an index and cannot back a
 * discovery query.
 */

const config = require('../config');
const { C, likesShard, decksContainer } = require('./containers');
const { todayIso, ageFrom, seededShuffle } = require('./utils');
const scoring = require('./scoring');
const { NotFoundError } = require('../errors');

function createDiscoveryService({
  store, members, profiles, media, moderation, entitlements, versionedCache, searchIndex, logger
}) {
  /**
   * Every active member as a {member, profile, preferences} bundle.
   * Cached under the decks namespace but keyed by the profiles version too, so
   * a profile edit and a preference change both invalidate it.
   */
  async function bundles() {
    const profilesVersion = await versionedCache.version('profiles');
    const membersVersion = await versionedCache.version('members');
    return versionedCache.remember('decks', `bundles:p${profilesVersion}:m${membersVersion}`, async () => {
      const [allMembers, allProfiles, allPreferences] = await Promise.all([
        members.all(),
        profiles.all(),
        store.list(C.PREFERENCES)
      ]);
      const profileByMember = new Map(allProfiles.map((p) => [p.memberId, p]));
      const preferenceByMember = new Map(allPreferences.map((p) => [p.memberId, p]));

      const result = [];
      for (const member of allMembers) {
        const profile = profileByMember.get(member.id);
        if (!profile) continue;
        result.push({
          member,
          profile,
          preferences: {
            ...profiles.DEFAULT_PREFERENCES,
            ...(preferenceByMember.get(member.id) || {})
          }
        });
      }
      return result;
    });
  }

  async function bundleFor(memberId) {
    const all = await bundles();
    const found = all.find((b) => b.member.id === memberId);
    if (!found) throw new NotFoundError('Complete your profile first');
    return found;
  }

  async function interactionsFor(memberId) {
    const record = await store.findOne(C.INTERACTIONS, (i) => i.memberId === memberId);
    return record || { memberId, acted: {}, stats: { given: 0, received: 0, likedBack: 0 } };
  }

  /** Likes addressed to this member — a single shard read. */
  async function likesReceived(memberId) {
    const shard = likesShard(memberId);
    return store.findAll(shard, (l) => l.toMemberId === memberId && l.action === 'like');
  }

  /**
   * Everything the scorer needs that is not on the candidate itself.
   * Built once per viewer and reused across the whole candidate list.
   */
  async function buildContext(viewer, { allBundles, recentlyShown } = {}) {
    const [interactions, blocked, received] = await Promise.all([
      interactionsFor(viewer.member.id),
      moderation.blockedSet(viewer.member.id),
      likesReceived(viewer.member.id)
    ]);

    const pool = allBundles || (await bundles());
    const reciprocity = new Map();
    for (const bundle of pool) {
      const stats = bundle.interactionStats;
      if (stats) reciprocity.set(bundle.member.id, { received: stats.received, likedBack: stats.likedBack });
    }

    return {
      now: new Date(),
      actedUpon: new Set(Object.keys(interactions.acted || {})),
      blocked,
      likedViewer: new Set(received.map((l) => l.fromMemberId)),
      reciprocity,
      recentlyShown: recentlyShown || new Map(),
      populationLikeBackRate: 0.25
    };
  }

  /** Attaches interaction stats to bundles so the scorer can read reciprocity. */
  async function bundlesWithStats() {
    const [pool, allInteractions] = await Promise.all([bundles(), store.list(C.INTERACTIONS)]);
    const byMember = new Map(allInteractions.map((i) => [i.memberId, i.stats || {}]));
    return pool.map((bundle) => ({
      ...bundle,
      interactionStats: {
        received: byMember.get(bundle.member.id)?.received || 0,
        likedBack: byMember.get(bundle.member.id)?.likedBack || 0
      }
    }));
  }

  async function candidatePool(viewer, ctx, allBundles) {
    const pool = allBundles || (await bundlesWithStats());
    return pool.filter((candidate) => scoring.eligible(viewer, candidate, ctx));
  }

  /** Decks a viewer saw over the last few days — feeds the diversity term. */
  async function recentlyShownFor(memberId, days = 3) {
    const shown = new Map();
    for (let i = 1; i <= days; i += 1) {
      const date = todayIso(config.timezone, new Date(Date.now() - i * 864e5));
      const record = await store.findOne(decksContainer(date), (d) => d.memberId === memberId);
      for (const id of record?.cardIds || []) {
        shown.set(id, (shown.get(id) || 0) + 1);
      }
    }
    return shown;
  }

  /**
   * Today's deck. The nightly job is an optimisation, never a correctness
   * dependency — a missing deck is generated on demand and stored.
   */
  async function deck(memberId) {
    const member = await members.getOrThrow(memberId);
    const size = await entitlements.allowance(member, 'deck');
    const date = todayIso(config.timezone);
    const container = decksContainer(date);

    let record = await store.findOne(container, (d) => d.memberId === memberId);
    if (!record) {
      record = await generateFor(memberId, { date, size });
    }

    const consumed = new Set(record.consumed || []);
    const remaining = (record.cardIds || []).filter((id) => !consumed.has(id));
    const cards = await hydrate(memberId, remaining);

    return {
      date,
      size,
      cards,
      remaining: cards.length,
      total: record.cardIds?.length || 0,
      generatedAt: record.generatedAt
    };
  }

  /** Generates and persists one member's deck for a date. */
  async function generateFor(memberId, { date, size, allBundles, appearances, capPerCandidate } = {}) {
    const pool = allBundles || (await bundlesWithStats());
    const viewer = pool.find((b) => b.member.id === memberId) || (await bundleFor(memberId));
    const deckSize = size ?? (await entitlements.allowance(viewer.member, 'deck'));
    const dateIso = date || todayIso(config.timezone);

    const recentlyShown = await recentlyShownFor(memberId);
    const ctx = await buildContext(viewer, { allBundles: pool, recentlyShown });
    const candidates = await candidatePool(viewer, ctx, pool);

    const scored = candidates
      .map((candidate) => ({ candidate, value: scoring.score(viewer, candidate, ctx) }))
      .sort((a, b) => b.value - a.value);

    const cap = capPerCandidate ?? Math.max(1, Math.ceil(pool.length * config.matching.appearanceCapRatio));
    const selected = scoring.selectDeck(scored, deckSize, appearances || new Map(), cap);

    // Presentation order is shuffled but stable for the day, so the highest
    // score is not always card one — that reads as a ranking to the member.
    const cardIds = seededShuffle(selected.map((s) => s.candidate.member.id), `${memberId}:${dateIso}`);

    const container = decksContainer(dateIso);
    const existing = await store.findOne(container, (d) => d.memberId === memberId);
    if (existing) {
      return store.update(container, existing.id, { cardIds, generatedAt: new Date().toISOString() });
    }
    return store.create(container, {
      memberId,
      date: dateIso,
      cardIds,
      consumed: [],
      generatedAt: new Date().toISOString()
    });
  }

  /** Nightly run for every member who can receive a deck. */
  async function generateAll({ date } = {}) {
    const dateIso = date || todayIso(config.timezone);
    const pool = await bundlesWithStats();
    const active = pool.filter((b) => b.member.status === 'active');
    const appearances = new Map();
    const cap = Math.max(1, Math.ceil(active.length * config.matching.appearanceCapRatio));

    let generated = 0;
    for (const bundle of active) {
      const size = await entitlements.allowance(bundle.member, 'deck');
      if (!size) continue;
      await generateFor(bundle.member.id, {
        date: dateIso, size, allBundles: pool, appearances, capPerCandidate: cap
      }).catch((err) => logger?.error?.(`[decks] ${bundle.member.id}: ${err.message}`));
      generated += 1;
    }
    return { date: dateIso, generated, poolSize: active.length, cap };
  }

  /** Marks a card as spent so it does not reappear in today's deck. */
  async function consumeCard(memberId, targetId) {
    const container = decksContainer(todayIso(config.timezone));
    const record = await store.findOne(container, (d) => d.memberId === memberId);
    if (!record) return;
    if ((record.consumed || []).includes(targetId)) return;
    await store.mutate(container, record.id, (current) => ({
      ...current,
      consumed: [...(current.consumed || []), targetId]
    }));
  }

  /** Turns member ids into the public projections the client renders. */
  async function hydrate(viewerId, memberIds) {
    if (!memberIds?.length) return [];
    const pool = await bundles();
    const viewer = pool.find((b) => b.member.id === viewerId);
    const byId = new Map(pool.map((b) => [b.member.id, b]));

    const cards = [];
    for (const id of memberIds) {
      const bundle = byId.get(id);
      if (!bundle) continue;
      if (bundle.member.status !== 'active') continue;
      if (bundle.profile.moderationState !== 'live') continue;
      const photos = await media.liveForMember(id);
      if (!photos.length) continue;
      cards.push(profiles.publicView(bundle.profile, bundle.member, photos, viewer?.profile));
    }
    return cards;
  }

  /** Filtered browse. Entitlement-gated at the route; filters applied here. */
  async function browse(memberId, filters = {}) {
    const pool = await bundlesWithStats();
    const viewer = pool.find((b) => b.member.id === memberId) || (await bundleFor(memberId));
    const ctx = await buildContext(viewer, { allBundles: pool });
    let candidates = await candidatePool(viewer, ctx, pool);

    if (filters.ageMin) candidates = candidates.filter((c) => ageFrom(c.profile.dateOfBirth) >= Number(filters.ageMin));
    if (filters.ageMax) candidates = candidates.filter((c) => ageFrom(c.profile.dateOfBirth) <= Number(filters.ageMax));
    if (filters.city) {
      const needle = String(filters.city).toLowerCase();
      candidates = candidates.filter((c) => (c.profile.city || '').toLowerCase().includes(needle));
    }
    if (filters.intent) candidates = candidates.filter((c) => c.profile.intent === filters.intent);
    if (filters.education) candidates = candidates.filter((c) => c.profile.education === filters.education);
    if (filters.badge) candidates = candidates.filter((c) => (c.member.badges || []).includes(filters.badge));

    if (filters.q && searchIndex) {
      const hits = await searchIndex.query(filters.q).catch(() => null);
      if (hits) {
        const allowed = new Set(hits);
        candidates = candidates.filter((c) => allowed.has(c.member.id));
      }
    }

    const scored = candidates
      .map((candidate) => ({ candidate, value: scoring.score(viewer, candidate, ctx) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, Number(filters.limit) || 30);

    return hydrate(memberId, scored.map((s) => s.candidate.member.id));
  }

  /**
   * How many members a given interest filter would admit.
   *
   * The pool is never fully loaded on the client, so the count on the filter
   * screen has to be a real server query rather than a guess — this runs the
   * whole eligibility clause set with the candidate filter swapped in, so the
   * number shown is exactly the number the deck would draw from.
   */
  async function countMatching(memberId, interestCategories) {
    const pool = await bundlesWithStats();
    const actual = pool.find((b) => b.member.id === memberId) || (await bundleFor(memberId));
    const viewer = {
      ...actual,
      preferences: { ...actual.preferences, interestCategories: interestCategories || [] }
    };
    const ctx = await buildContext(viewer, { allBundles: pool });
    // Cards already acted on today are still part of the pool this filter
    // describes — the count answers "how many members match", not "how many are
    // left to see".
    const counted = pool.filter((candidate) => scoring.eligible(viewer, candidate, {
      ...ctx, actedUpon: new Set()
    }));
    return counted.length;
  }

  /** Who liked you — one shard read, minus anyone already acted upon. */
  async function whoLikedMe(memberId) {
    const [received, interactions, blocked] = await Promise.all([
      likesReceived(memberId),
      interactionsFor(memberId),
      moderation.blockedSet(memberId)
    ]);
    const acted = new Set(Object.keys(interactions.acted || {}));
    const ids = received
      .map((l) => l.fromMemberId)
      .filter((id) => !acted.has(id) && !blocked.has(id));
    const unique = [...new Set(ids)];
    const cards = await hydrate(memberId, unique);
    return cards;
  }

  /** Profile views of me — Elite and above, Select always. */
  async function viewedMe(memberId) {
    const shard = likesShard(memberId);
    const views = await store.findAll(shard, (l) => l.toMemberId === memberId && l.action === 'view');
    const unique = [...new Set(views.map((v) => v.fromMemberId))];
    return hydrate(memberId, unique.slice(0, 30));
  }

  return {
    bundles, bundlesWithStats, bundleFor, buildContext, candidatePool,
    deck, generateFor, generateAll, consumeCard, hydrate, browse, countMatching,
    whoLikedMe, viewedMe, interactionsFor, likesReceived, recentlyShownFor
  };
}

module.exports = { createDiscoveryService };
