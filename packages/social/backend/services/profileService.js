'use strict';

/**
 * @fileoverview Profiles and per-member preferences.
 *
 * A profile has a live version and, when free text changes, a pending version
 * awaiting moderation. The live version stays visible while the edit is in the
 * queue — an edit must never blank someone's profile for two hours.
 */

const config = require('../config');
const { C } = require('./containers');
const { ageFrom, isAdult, distanceKm, distanceBand, isInLaunchCity } = require('./utils');
const interests = require('./interests');
const { ValidationError, NotFoundError } = require('../errors');

const INTENTS = ['long_term', 'life_partner', 'still_deciding'];
const INCOME_BANDS = ['1m_2m', '2m_5m', '5m_10m', '10m_plus'];
const EDUCATION = ['secondary', 'undergraduate', 'postgraduate', 'doctorate'];
const FREQUENCY = ['never', 'socially', 'regularly'];
const CHILDREN = ['none', 'have_children', 'want_children', 'prefer_not_to_say'];

/** Free-text fields re-enter moderation when edited. */
const MODERATED_FIELDS = ['bio', 'prompts', 'occupation', 'employer'];

const DEFAULT_PREFERENCES = {
  ageMin: 25,
  ageMax: 45,
  distanceKm: 50,
  interestedIn: null,
  // The Elite discovery filter (A10). Empty means no filter — every category.
  interestCategories: [],
  travelCity: null,
  travelUntil: null,
  notifications: {
    newMatch: { inApp: true, email: true },
    newMessage: { inApp: true, email: false },
    dailyIntroductions: { inApp: true, email: true, hour: 9 },
    applicationUpdates: { inApp: true, email: true },
    membership: { inApp: true, email: true },
    digest: { inApp: false, email: true }
  },
  privacy: {
    showOnlineStatus: true,
    showReadReceipts: true,
    incognito: false
  }
};

function createProfileService({ store, media, versionedCache, activity, searchIndex }) {
  async function get(memberId) {
    return store.findOne(C.PROFILES, (p) => p.memberId === memberId);
  }

  async function getOrThrow(memberId) {
    const profile = await get(memberId);
    if (!profile) throw new NotFoundError('Profile not found');
    return profile;
  }

  /** Cached whole-container projection — the deck reads this, not the disk. */
  async function all() {
    return versionedCache.remember('profiles', 'all', () => store.list(C.PROFILES));
  }

  /** Fields an application must carry before it can be submitted. */
  const REQUIRED = ['firstName', 'dateOfBirth', 'city', 'occupation', 'intent'];

  /**
   * Validates whatever is present. A profile is filled in across five steps,
   * so a draft save can never demand fields from a later step — completeness
   * is enforced once, at submission, by `missingRequired`.
   */
  function validate(fields) {
    const errors = [];
    if (fields.dateOfBirth && !isAdult(fields.dateOfBirth)) {
      // Hard gate. Enforced here as well as at the route so a direct API call
      // cannot bypass the client check.
      errors.push('You must be 18 or older to join');
    }
    if (fields.bio && fields.bio.length > config.limits.bioMaxLength) {
      errors.push(`Bio must be ${config.limits.bioMaxLength} characters or fewer`);
    }
    if (fields.intent && !INTENTS.includes(fields.intent)) errors.push('Invalid intent');
    if (fields.education && !EDUCATION.includes(fields.education)) errors.push('Invalid education');
    if (fields.smoking && !FREQUENCY.includes(fields.smoking)) errors.push('Invalid smoking value');
    if (fields.drinking && !FREQUENCY.includes(fields.drinking)) errors.push('Invalid drinking value');
    if (fields.children && !CHILDREN.includes(fields.children)) errors.push('Invalid children value');
    if (fields.incomeBand && !INCOME_BANDS.includes(fields.incomeBand)) errors.push('Invalid income band');
    if (fields.height && (fields.height < 120 || fields.height > 230)) errors.push('Invalid height');
    if (Array.isArray(fields.prompts)) {
      for (const prompt of fields.prompts) {
        if (prompt.a && prompt.a.length > config.limits.promptMaxLength) {
          errors.push('Prompt answers are too long');
        }
      }
    }
    if (errors.length) throw new ValidationError(errors[0], { errors });
  }

  /** Required fields still missing — checked at submission, not on every save. */
  function missingRequired(profile) {
    return REQUIRED.filter((field) => !profile?.[field]);
  }

  /** Whitelist — unknown fields are dropped rather than passed through. */
  function pick(fields) {
    const allowed = ['firstName', 'dateOfBirth', 'city', 'occupation', 'employer', 'education',
      'height', 'intent', 'smoking', 'drinking', 'children', 'bio', 'prompts', 'incomeBand',
      'coords', 'interestCategories'];
    const picked = {};
    for (const key of allowed) {
      if (fields[key] !== undefined) picked[key] = fields[key];
    }
    // Anything outside the taxonomy is dropped rather than stored and ignored,
    // so the deck filter never has to defend against an unknown key.
    if (picked.interestCategories !== undefined) {
      picked.interestCategories = interests.normalise(picked.interestCategories);
    }
    return picked;
  }

  async function upsert(memberId, fields) {
    const clean = pick(fields);
    const existing = await get(memberId);
    validate({ ...(existing || {}), ...clean });

    if (clean.city) clean.inLaunchCity = isInLaunchCity(clean.city);

    if (!existing) {
      const created = await store.create(C.PROFILES, {
        memberId,
        ...clean,
        moderationState: 'pending',
        pending: null,
        completeness: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      const scored = await store.update(C.PROFILES, created.id, { completeness: completeness(created) });
      await versionedCache.bump('profiles');
      return scored;
    }

    // Free-text edits queue for moderation, but only once the profile is live
    // and there is something to protect. During the application everything is
    // in front of a reviewer anyway, so routing it to a pending patch would
    // just leave the profile itself empty.
    const isLive = existing.moderationState === 'live';
    const moderated = {};
    const immediate = {};
    for (const [key, value] of Object.entries(clean)) {
      if (isLive && MODERATED_FIELDS.includes(key)) moderated[key] = value;
      else immediate[key] = value;
    }

    const patch = { ...immediate, updatedAt: new Date().toISOString() };
    if (Object.keys(moderated).length) {
      patch.pending = { ...(existing.pending || {}), ...moderated, submittedAt: new Date().toISOString() };
      await versionedCache.bump('moderation');
    }

    const updated = await store.update(C.PROFILES, existing.id, patch);
    const scored = await store.update(C.PROFILES, existing.id, { completeness: completeness(updated) });
    await versionedCache.bump('profiles');
    await searchIndex?.index(scored).catch(() => {});
    return scored;
  }

  /** Applies or discards a pending free-text edit. */
  async function resolvePending(profileId, approve, { reviewerId, reason } = {}) {
    const profile = await store.get(C.PROFILES, profileId);
    if (!profile) throw new NotFoundError('Profile not found');
    const pending = profile.pending;
    if (!pending) return profile;

    const patch = approve
      ? { ...pending, pending: null, moderationState: 'live', submittedAt: undefined }
      : { pending: null };
    delete patch.submittedAt;

    const updated = await store.update(C.PROFILES, profileId, patch);
    await activity.log('moderation.profile', `profile ${profileId} edit ${approve ? 'approved' : 'rejected'}`, {
      memberId: reviewerId, targetId: profile.memberId, profileId, reason
    });
    await versionedCache.bumpAll(['profiles', 'moderation']);
    await searchIndex?.index(updated).catch(() => {});
    return updated;
  }

  async function publish(memberId) {
    const profile = await getOrThrow(memberId);
    const updated = await store.update(C.PROFILES, profile.id, { moderationState: 'live' });
    await versionedCache.bump('profiles');
    await searchIndex?.index(updated).catch(() => {});
    return updated;
  }

  function completeness(profile) {
    if (!profile) return 0;
    const weighted = [
      ['firstName', 5], ['dateOfBirth', 5], ['city', 5], ['occupation', 10],
      ['employer', 5], ['education', 10], ['height', 5], ['intent', 10],
      ['smoking', 5], ['drinking', 5], ['children', 5], ['bio', 20]
    ];
    let score = 0;
    for (const [field, weight] of weighted) {
      if (profile[field]) score += weight;
    }
    const answered = (profile.prompts || []).filter((p) => p.a && p.a.trim()).length;
    score += Math.min(10, answered * 4);
    return Math.min(100, score);
  }

  /**
   * The only shape another member ever sees. Date of birth, precise
   * coordinates, email and internal flags are absent by construction rather
   * than deleted afterwards.
   */
  function publicView(profile, member, photos, viewerProfile) {
    if (!profile) return null;
    const km = viewerProfile ? distanceKm(viewerProfile.coords, profile.coords) : null;
    return {
      memberId: profile.memberId,
      firstName: profile.firstName,
      age: ageFrom(profile.dateOfBirth),
      city: profile.city,
      distance: distanceBand(km),
      occupation: profile.occupation,
      employer: profile.employer || null,
      education: profile.education || null,
      height: profile.height || null,
      intent: profile.intent,
      smoking: profile.smoking || null,
      drinking: profile.drinking || null,
      children: profile.children || null,
      bio: profile.bio || '',
      prompts: (profile.prompts || []).filter((p) => p.a && p.a.trim()),
      interestCategories: interests.normalise(profile.interestCategories),
      badges: member?.badges || [],
      // The date a mark was granted is part of the evidence, not decoration —
      // a badge with no date behind it is exactly what this product refuses.
      badgesGrantedAt: member?.badgeGrantedAt || {},
      photos: (photos || []).map((p) => ({ id: p.id, isPrimary: p.isPrimary })),
      lastActiveAt: member?.lastActiveAt || null
    };
  }

  /** The owner's own view — includes pending edits and completeness. */
  function selfView(profile, photos) {
    if (!profile) return null;
    return {
      ...profile,
      age: ageFrom(profile.dateOfBirth),
      completeness: completeness(profile),
      photos: (photos || []).map((p) => ({
        id: p.id,
        isPrimary: p.isPrimary,
        moderationState: p.moderationState,
        uploadedAt: p.uploadedAt
      }))
    };
  }

  // ---- preferences -------------------------------------------------------

  async function getPreferences(memberId) {
    const found = await store.findOne(C.PREFERENCES, (p) => p.memberId === memberId);
    if (found) {
      return {
        ...DEFAULT_PREFERENCES,
        ...found,
        interestCategories: interests.normalise(found.interestCategories),
        notifications: { ...DEFAULT_PREFERENCES.notifications, ...(found.notifications || {}) },
        privacy: { ...DEFAULT_PREFERENCES.privacy, ...(found.privacy || {}) }
      };
    }
    return store.create(C.PREFERENCES, { memberId, ...DEFAULT_PREFERENCES });
  }

  async function updatePreferences(memberId, patch) {
    const current = await getPreferences(memberId);
    const next = {
      ...current,
      ...patch,
      interestCategories: interests.normalise(
        patch.interestCategories !== undefined ? patch.interestCategories : current.interestCategories
      ),
      notifications: { ...current.notifications, ...(patch.notifications || {}) },
      privacy: { ...current.privacy, ...(patch.privacy || {}) }
    };
    if (next.ageMin < 18) next.ageMin = 18;
    if (next.ageMax > 99) next.ageMax = 99;
    if (next.ageMin > next.ageMax) throw new ValidationError('Minimum age cannot exceed maximum age');
    if (next.distanceKm < 1 || next.distanceKm > 500) throw new ValidationError('Invalid distance');

    const updated = await store.update(C.PREFERENCES, current.id, next);
    await versionedCache.bump('decks');
    return updated;
  }

  return {
    get, getOrThrow, all, upsert, resolvePending, publish, completeness,
    missingRequired, publicView, selfView, getPreferences, updatePreferences,
    INTENTS, INCOME_BANDS, EDUCATION, FREQUENCY, CHILDREN, DEFAULT_PREFERENCES
  };
}

module.exports = { createProfileService, INTENTS, INCOME_BANDS, EDUCATION, FREQUENCY, CHILDREN };
