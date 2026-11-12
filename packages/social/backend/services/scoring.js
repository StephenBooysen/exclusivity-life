'use strict';

/**
 * @fileoverview Ranking functions for deck generation.
 *
 * Pure — no I/O, no clock except an injected `now`. This is the most heavily
 * unit-tested file in the codebase because it decides who sees whom.
 *
 * Deliberately absent: any facial, body or attractiveness model. The quality
 * signals are verification depth and profile completeness, both of which a
 * member controls, and both of which can be explained to them.
 */

const config = require('../config');
const { ageFrom, distanceKm, clamp } = require('./utils');
const interests = require('./interests');

/** Hard eligibility. Every clause here is a correctness requirement. */
function eligible(viewer, candidate, ctx) {
  if (!candidate || !viewer) return false;
  if (candidate.member.id === viewer.member.id) return false;
  if (candidate.member.status !== 'active') return false;
  if (candidate.profile.moderationState !== 'live') return false;

  // Mutually compatible interest. `interestedIn` defaults to the other side.
  const viewerWants = viewer.preferences.interestedIn || oppositeOf(viewer.member.side);
  const candidateWants = candidate.preferences.interestedIn || oppositeOf(candidate.member.side);
  if (candidate.member.side !== viewerWants) return false;
  if (viewer.member.side !== candidateWants) return false;

  const candidateAge = ageFrom(candidate.profile.dateOfBirth, ctx.now);
  const viewerAge = ageFrom(viewer.profile.dateOfBirth, ctx.now);
  if (candidateAge == null || viewerAge == null) return false;
  if (candidateAge < viewer.preferences.ageMin || candidateAge > viewer.preferences.ageMax) return false;
  if (viewerAge < candidate.preferences.ageMin || viewerAge > candidate.preferences.ageMax) return false;

  const km = distanceKm(viewer.profile.coords, candidate.profile.coords);
  if (km != null && km > Math.max(viewer.preferences.distanceKm, candidate.preferences.distanceKm)) return false;

  // Interest overlap, in both directions: what each member declared they are
  // open to has to admit what the other selected. An empty set on either side
  // is no constraint at all, so this clause cannot empty a deck on its own.
  if (!interests.overlaps(viewer.preferences.interestCategories, candidate.profile.interestCategories)) return false;
  if (!interests.overlaps(candidate.preferences.interestCategories, viewer.profile.interestCategories)) return false;

  if (ctx.actedUpon?.has(candidate.member.id)) return false;
  if (ctx.blocked?.has(candidate.member.id)) return false;

  // Incognito hides a member from decks unless they have already liked the
  // viewer — a like always reveals the liker.
  const candidateIncognito = candidate.preferences.privacy?.incognito || candidate.member.incognito;
  if (candidateIncognito && !ctx.likedViewer?.has(candidate.member.id)) return false;

  return true;
}

function oppositeOf(side) {
  return side === 'male' ? 'female' : 'male';
}

/** Overlap of declared criteria, 0..1. */
function preferenceFit(viewer, candidate, ctx) {
  let score = 0;
  let weight = 0;

  const candidateAge = ageFrom(candidate.profile.dateOfBirth, ctx.now);
  const span = Math.max(1, viewer.preferences.ageMax - viewer.preferences.ageMin);
  const centre = (viewer.preferences.ageMax + viewer.preferences.ageMin) / 2;
  score += 1 - clamp(Math.abs(candidateAge - centre) / span, 0, 1);
  weight += 1;

  const km = distanceKm(viewer.profile.coords, candidate.profile.coords);
  if (km != null) {
    score += 1 - clamp(km / Math.max(1, viewer.preferences.distanceKm), 0, 1);
    weight += 1;
  }

  if (viewer.profile.intent && candidate.profile.intent) {
    score += viewer.profile.intent === candidate.profile.intent ? 1 : 0.4;
    weight += 1;
  }

  return weight ? score / weight : 0.5;
}

/**
 * How likely the candidate is to like back, shrunk toward the population mean.
 *
 * Without the shrink, a profile with two like-backs out of two outranks one
 * with forty out of a hundred, and the deck fills with noise from brand new
 * accounts.
 */
function reciprocityLikelihood(candidate, ctx) {
  const stats = ctx.reciprocity?.get(candidate.member.id);
  const prior = config.matching.reciprocityPrior;
  const populationMean = ctx.populationLikeBackRate ?? 0.25;
  if (!stats || !stats.received) return populationMean;
  return (stats.likedBack + populationMean * prior) / (stats.received + prior);
}

function profileCompleteness(candidate) {
  return clamp((candidate.profile.completeness || 0) / 100, 0, 1);
}

/** Badge depth, weighted — means and identity say more than a photo check. */
function verificationDepth(candidate) {
  const weights = { identity: 0.3, photo: 0.2, means: 0.35, professional: 0.15 };
  const badges = candidate.member.badges || [];
  return clamp(badges.reduce((sum, badge) => sum + (weights[badge] || 0), 0), 0, 1);
}

/** Exponential decay — someone last seen three weeks ago is not a good card. */
function activityRecency(candidate, ctx) {
  const lastActive = candidate.member.lastActiveAt;
  if (!lastActive) return 0;
  const days = (ctx.now - new Date(lastActive)) / 864e5;
  if (days < 0) return 1;
  return Math.pow(0.5, days / config.matching.recencyHalfLifeDays);
}

/** Negative for faces the viewer has seen recently. */
function diversityTerm(candidate, ctx) {
  const shown = ctx.recentlyShown?.get(candidate.member.id) || 0;
  return shown === 0 ? 1 : clamp(1 - shown * 0.35, -1, 1);
}

function activeBoost(candidate, ctx) {
  const until = candidate.member.boostUntil;
  if (!until) return 0;
  return new Date(until) > ctx.now ? 1 : 0;
}

/** Weighted sum. Weights live in config so they are tunable without a deploy. */
function score(viewer, candidate, ctx) {
  const w = config.matching.weights;
  return (
    w.preference * preferenceFit(viewer, candidate, ctx)
    + w.reciprocity * reciprocityLikelihood(candidate, ctx)
    + w.completeness * profileCompleteness(candidate)
    + w.verification * verificationDepth(candidate)
    + w.recency * activityRecency(candidate, ctx)
    + w.diversity * diversityTerm(candidate, ctx)
    + w.boost * activeBoost(candidate, ctx)
  );
}

/**
 * Selects a deck under a global appearance cap.
 *
 * The cap is the important part. Without it the top-scoring dozen profiles in
 * the city appear in every deck, absorb every like, and everyone else receives
 * none — the classic dating-app death spiral. `appearances` is carried across
 * the whole generation run so the cap is global, not per-member.
 *
 * @param {Array<{candidate: Object, value: number}>} scored ranked candidates
 * @param {number} size deck size for the viewer's tier
 * @param {Map<string, number>} appearances candidate id -> decks occupied so far
 * @param {number} capPerCandidate maximum decks one candidate may occupy
 */
function selectDeck(scored, size, appearances, capPerCandidate) {
  const chosen = [];
  const overflow = [];

  for (const entry of scored) {
    if (chosen.length >= size) break;
    const id = entry.candidate.member.id;
    const used = appearances.get(id) || 0;
    if (used >= capPerCandidate) {
      overflow.push(entry);
      continue;
    }
    chosen.push(entry);
    appearances.set(id, used + 1);
  }

  // A thin pool must still produce a deck; the cap yields rather than leaving
  // a member with three cards.
  for (const entry of overflow) {
    if (chosen.length >= size) break;
    const id = entry.candidate.member.id;
    chosen.push(entry);
    appearances.set(id, (appearances.get(id) || 0) + 1);
  }

  return chosen;
}

module.exports = {
  eligible, oppositeOf, preferenceFit, reciprocityLikelihood, profileCompleteness,
  verificationDepth, activityRecency, diversityTerm, activeBoost, score, selectDeck
};
