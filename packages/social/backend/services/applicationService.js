'use strict';

/**
 * @fileoverview Application lifecycle and the review queue.
 *
 * Both sides apply and a human decides. Male applicants additionally pass an
 * **interview** — that is how means standing is established, in place of
 * financial documents. A reviewer may request an interview for any applicant.
 *
 * The launch city is a hard gate: an application from outside it is waitlisted
 * on submission rather than queued, so reviewer time goes to the pool that can
 * actually meet each other.
 */

const config = require('../config');
const { C } = require('./containers');
const { isAdult, isInLaunchCity, sha256 } = require('./utils');
const scanner = require('./contentScanner');
const { ValidationError, NotFoundError, ConflictError, ForbiddenError } = require('../errors');

const STATE = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  IN_REVIEW: 'in_review',
  INTERVIEW_SCHEDULED: 'interview_scheduled',
  INTERVIEW_COMPLETED: 'interview_completed',
  INFO_REQUESTED: 'info_requested',
  APPROVED: 'approved',
  WAITLISTED: 'waitlisted',
  DECLINED: 'declined',
  WITHDRAWN: 'withdrawn'
};

const REASON_CODES = [
  'incomplete_profile', 'photo_quality', 'photo_unverified', 'outside_launch_city',
  'capacity', 'interview_not_passed', 'policy_violation', 'duplicate_account',
  'age_ineligible', 'other'
];

/** States a reviewer can still act on. */
const OPEN_STATES = [STATE.SUBMITTED, STATE.IN_REVIEW, STATE.INTERVIEW_SCHEDULED,
  STATE.INTERVIEW_COMPLETED, STATE.INFO_REQUESTED];

function createApplicationService({
  store, members, profiles, media, verification, notifications, activity, versionedCache
}) {
  async function forMember(memberId) {
    const found = await store.findAll(C.APPLICATIONS, (a) => a.memberId === memberId);
    return found.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0] || null;
  }

  async function getOrThrow(id) {
    const application = await store.get(C.APPLICATIONS, id);
    if (!application) throw new NotFoundError('Application not found');
    return application;
  }

  /** Creates the draft on first save; every later save patches it. */
  async function saveDraft(memberId, patch) {
    const member = await members.getOrThrow(memberId);
    let application = await forMember(memberId);

    if (application && !([STATE.DRAFT, STATE.INFO_REQUESTED].includes(application.state))) {
      throw new ConflictError('Your application has already been submitted', 'already_submitted');
    }

    // Profile fields are stored on the profile from the first keystroke, so a
    // resumed application and an approved member read from one place.
    if (patch.profile) {
      await profiles.upsert(memberId, patch.profile);
      if (patch.profile.city) {
        await members.update(memberId, {
          city: patch.profile.city,
          inLaunchCity: isInLaunchCity(patch.profile.city)
        });
      }
      if (patch.profile.firstName) {
        await members.update(memberId, { displayName: patch.profile.firstName });
      }
    }

    const applicationPatch = {};
    if (patch.means) applicationPatch.means = { ...(application?.means || {}), ...patch.means };
    if (patch.step !== undefined) applicationPatch.step = patch.step;
    if (patch.inviteCode !== undefined) applicationPatch.inviteCode = patch.inviteCode;

    if (!application) {
      application = await store.create(C.APPLICATIONS, {
        memberId,
        side: member.side,
        state: STATE.DRAFT,
        step: patch.step || 1,
        means: patch.means || {},
        inviteCode: patch.inviteCode || null,
        prescreenFlags: [],
        interview: null,
        decision: null,
        appealOf: null,
        priority: 2,
        startedAt: new Date().toISOString(),
        submittedAt: null
      });
    } else if (Object.keys(applicationPatch).length) {
      application = await store.update(C.APPLICATIONS, application.id, applicationPatch);
    }

    return application;
  }

  /**
   * Automated pre-screen. Findings are advisory — they attach as flags and
   * never decide the application on their own.
   */
  async function preScreen(member, profile, photos) {
    const flags = [];

    if (scanner.isDisposableEmail(member.email)) flags.push('disposable_email');

    const emailHash = sha256(member.email);
    const banned = await store.findOne(C.BANNED_IDENTITIES, (b) => b.emailHash === emailHash);
    if (banned) flags.push('banned_identity');

    const duplicates = await store.findAll(
      C.PHOTOS,
      (p) => p.memberId !== member.id && !p.deletedAt
        && photos.some((own) => own.contentHash === p.contentHash)
    );
    if (duplicates.length) flags.push('duplicate_photo');

    const text = [profile.bio, profile.occupation, profile.employer,
      ...(profile.prompts || []).map((p) => p.a)].filter(Boolean).join(' \n ');
    const scan = scanner.scanProfile(text);
    flags.push(...scan.flags.map((f) => `text_${f}`));

    if (!isInLaunchCity(profile.city)) flags.push('outside_launch_city');
    if (profile.completeness < 60) flags.push('low_completeness');

    return [...new Set(flags)];
  }

  async function submit(memberId) {
    const member = await members.getOrThrow(memberId);
    const application = await forMember(memberId);
    if (!application) throw new ValidationError('Start an application first');
    if (![STATE.DRAFT, STATE.INFO_REQUESTED].includes(application.state)) {
      throw new ConflictError('Your application has already been submitted', 'already_submitted');
    }

    const profile = await profiles.get(memberId);
    if (!profile) throw new ValidationError('Complete your profile first');

    // Draft saves accept partial data across the seven steps; this is the one
    // point where the full set is required.
    const missing = profiles.missingRequired(profile);
    if (missing.length) {
      const labels = {
        firstName: 'your first name', dateOfBirth: 'your date of birth', city: 'your city',
        occupation: 'what you do', intent: 'what you are looking for'
      };
      throw new ValidationError(`Add ${labels[missing[0]] || missing[0]} before sending your application`, { missing });
    }

    if (!isAdult(profile.dateOfBirth)) {
      // Hard age gate, enforced server-side regardless of what the client sent.
      await members.setStatus(memberId, members.STATUS.DECLINED, { reason: 'age_ineligible' });
      throw new ForbiddenError('You must be 18 or older to join', 'age_ineligible');
    }

    const photos = await media.forMember(memberId);
    if (photos.length < config.media.minPhotos) {
      throw new ValidationError(`Add at least ${config.media.minPhotos} photos`);
    }
    const liveness = await verification.livenessFor(memberId);
    if (!liveness) throw new ValidationError('Complete the verification selfie');

    if (member.side === 'male') {
      const means = application.means || {};
      if (!means.incomeBand) throw new ValidationError('Select an income band');
      if (!profile.occupation) throw new ValidationError('Add your occupation');
    }

    const prescreenFlags = await preScreen(member, { ...profile, completeness: profiles.completeness(profile) }, photos);
    const outsideCity = prescreenFlags.includes('outside_launch_city');

    // Hard geo-gate: waitlisted on submission, not queued for review.
    if (outsideCity && config.launch.geoGate) {
      const waitlisted = await store.update(C.APPLICATIONS, application.id, {
        state: STATE.WAITLISTED,
        prescreenFlags,
        submittedAt: new Date().toISOString(),
        priority: 3,
        decision: {
          outcome: STATE.WAITLISTED,
          reasonCode: 'outside_launch_city',
          note: `Exclusivity is open in ${config.launch.city} only for now.`,
          reviewerId: null,
          decidedAt: new Date().toISOString(),
          automated: true
        }
      });
      await members.setStatus(memberId, members.STATUS.WAITLISTED, { reason: 'outside_launch_city' });
      await notifications.notify(memberId, 'application.waitlisted', {
        city: config.launch.city, reasonCode: 'outside_launch_city'
      });
      await activity.log('application.decided', `${member.email} waitlisted (geo-gate)`, {
        memberId, applicationId: application.id, outcome: STATE.WAITLISTED, automated: true
      });
      await versionedCache.bump('moderation');
      return waitlisted;
    }

    const invite = application.inviteCode
      ? await store.findOne(C.INVITES, (i) => i.code === application.inviteCode && !i.revokedAt)
      : null;

    const submitted = await store.update(C.APPLICATIONS, application.id, {
      state: STATE.SUBMITTED,
      submittedAt: new Date().toISOString(),
      prescreenFlags,
      priority: invite ? 1 : 2,
      slaDueAt: new Date(Date.now() + config.review.slaHours * 3600 * 1000).toISOString()
    });

    await members.setStatus(memberId, members.STATUS.IN_REVIEW);
    await notifications.notify(memberId, 'application.received', {
      slaHours: config.review.slaHours,
      interviewExpected: config.review.interviewRequiredFor.includes(member.side)
    });
    await activity.log('application.submitted', `${member.email} submitted`, {
      memberId, applicationId: application.id, flags: prescreenFlags
    });
    await versionedCache.bump('moderation');
    return submitted;
  }

  async function withdraw(memberId) {
    const application = await forMember(memberId);
    if (!application) throw new NotFoundError('No application found');
    if ([STATE.APPROVED, STATE.DECLINED].includes(application.state)) {
      throw new ConflictError('This application has already been decided');
    }
    const photos = await media.forMember(memberId);
    for (const photo of photos) await media.remove(memberId, photo.id).catch(() => {});
    const liveness = await verification.livenessFor(memberId);
    if (liveness) await verification.purgeLiveness(liveness);

    const withdrawn = await store.update(C.APPLICATIONS, application.id, {
      state: STATE.WITHDRAWN, withdrawnAt: new Date().toISOString()
    });
    await activity.log('application.withdrawn', `application ${application.id} withdrawn`, { memberId });
    await versionedCache.bump('moderation');
    return withdrawn;
  }

  // ---- review queue ------------------------------------------------------

  /** Priority first, then oldest — the SLA is measured from submission. */
  async function queue({ state = 'open', side = null, flagged = null } = {}) {
    const all = await store.list(C.APPLICATIONS);
    const filtered = all.filter((a) => {
      if (state === 'open') return OPEN_STATES.includes(a.state);
      if (state === 'all') return a.state !== STATE.DRAFT;
      return a.state === state;
    }).filter((a) => (side ? a.side === side : true))
      .filter((a) => (flagged === null ? true : (a.prescreenFlags?.length > 0) === flagged));

    return filtered.sort((a, b) => (a.priority - b.priority)
      || new Date(a.submittedAt || a.startedAt) - new Date(b.submittedAt || b.startedAt));
  }

  /** Everything a reviewer needs on one screen. */
  async function reviewDetail(applicationId) {
    const application = await getOrThrow(applicationId);
    const member = await members.getOrThrow(application.memberId);
    const profile = await profiles.get(application.memberId);
    const photos = await media.forMember(application.memberId);
    const liveness = await verification.livenessFor(application.memberId);
    const history = await verification.history(application.memberId);

    return {
      application,
      member: members.selfView(member),
      profile: profile ? profiles.selfView(profile, photos) : null,
      photos: photos.map((p) => ({ id: p.id, moderationState: p.moderationState, flags: p.flags, isPrimary: p.isPrimary })),
      liveness: liveness ? { id: liveness.id, capturedAt: liveness.capturedAt } : null,
      verifications: history,
      interviewRequired: config.review.interviewRequiredFor.includes(member.side),
      slaDueAt: application.slaDueAt || null
    };
  }

  async function claim(applicationId, reviewerId) {
    const application = await getOrThrow(applicationId);
    if (application.state !== STATE.SUBMITTED) return application;
    return store.update(C.APPLICATIONS, applicationId, {
      state: STATE.IN_REVIEW, reviewerId, claimedAt: new Date().toISOString()
    });
  }

  async function scheduleInterview(applicationId, { scheduledFor, reviewerId, note }) {
    const application = await getOrThrow(applicationId);
    if (!scheduledFor) throw new ValidationError('An interview time is required');
    if (!OPEN_STATES.includes(application.state)) {
      throw new ConflictError('This application has already been decided');
    }

    const updated = await store.update(C.APPLICATIONS, applicationId, {
      state: STATE.INTERVIEW_SCHEDULED,
      interview: {
        scheduledFor,
        scheduledBy: reviewerId,
        scheduledAt: new Date().toISOString(),
        durationMinutes: config.review.interviewDurationMinutes,
        note: note || null,
        outcome: null,
        completedAt: null
      }
    });

    await members.setStatus(application.memberId, members.STATUS.INTERVIEW);
    await notifications.notify(application.memberId, 'application.interview_scheduled', {
      scheduledFor, durationMinutes: config.review.interviewDurationMinutes
    });
    await activity.log('application.interview_scheduled', `interview set for application ${applicationId}`, {
      memberId: reviewerId, targetId: application.memberId, applicationId, scheduledFor
    });
    await versionedCache.bump('moderation');
    return updated;
  }

  /**
   * Records the interview outcome. This is what establishes means standing —
   * a pass is the evidence behind the `means` badge on approval.
   */
  async function recordInterview(applicationId, { outcome, notes, reviewerId }) {
    const application = await getOrThrow(applicationId);
    if (!['passed', 'not_passed', 'no_show'].includes(outcome)) {
      throw new ValidationError('Invalid interview outcome');
    }
    if (!application.interview) throw new ValidationError('No interview has been scheduled');

    const updated = await store.update(C.APPLICATIONS, applicationId, {
      state: STATE.INTERVIEW_COMPLETED,
      interview: {
        ...application.interview,
        outcome,
        notes: notes || null,
        interviewerId: reviewerId,
        completedAt: new Date().toISOString()
      }
    });

    await activity.log('application.interview_recorded', `interview ${outcome} for application ${applicationId}`, {
      memberId: reviewerId, targetId: application.memberId, applicationId, outcome
    });
    await versionedCache.bump('moderation');
    return updated;
  }

  /**
   * The one place an application is decided. A reason code is mandatory on
   * every outcome so the decision is auditable and the applicant can be told
   * something true.
   */
  async function decide(applicationId, { outcome, reasonCode, note, reviewerId }) {
    const application = await getOrThrow(applicationId);
    const member = await members.getOrThrow(application.memberId);

    if (!OPEN_STATES.includes(application.state)) {
      throw new ConflictError('This application has already been decided');
    }
    if (!['approve', 'waitlist', 'decline', 'request_info'].includes(outcome)) {
      throw new ValidationError('Invalid decision');
    }
    if (!reasonCode || !REASON_CODES.includes(reasonCode)) {
      throw new ValidationError('A reason code is required', { allowed: REASON_CODES });
    }

    const interviewRequired = config.review.interviewRequiredFor.includes(member.side);
    const interviewPassed = application.interview?.outcome === 'passed';

    if (outcome === 'approve' && interviewRequired && !interviewPassed) {
      throw new ConflictError(
        'This applicant must pass an interview before approval',
        'interview_required'
      );
    }

    const decision = {
      outcome,
      reasonCode,
      note: note || null,
      reviewerId,
      decidedAt: new Date().toISOString(),
      automated: false
    };

    const stateByOutcome = {
      approve: STATE.APPROVED,
      waitlist: STATE.WAITLISTED,
      decline: STATE.DECLINED,
      request_info: STATE.INFO_REQUESTED
    };

    const updated = await store.update(C.APPLICATIONS, applicationId, {
      state: stateByOutcome[outcome],
      decision,
      decidedAt: decision.decidedAt
    });

    if (outcome === 'approve') {
      await approveMember(member, application, { interviewPassed, reviewerId });
    } else if (outcome === 'waitlist') {
      await members.setStatus(member.id, members.STATUS.WAITLISTED, { reason: reasonCode });
      await notifications.notify(member.id, 'application.waitlisted', { reasonCode });
    } else if (outcome === 'decline') {
      await members.setStatus(member.id, members.STATUS.DECLINED, { reason: reasonCode });
      await notifications.notify(member.id, 'application.declined', {
        reasonCode, appealAfterDays: config.review.appealAfterDays
      });
    } else {
      await members.setStatus(member.id, members.STATUS.INFO_REQUESTED);
      await notifications.notify(member.id, 'application.info_requested', { note });
    }

    // Durable audit — written synchronously, never queued.
    await activity.log('application.decided', `${member.email} → ${outcome} (${reasonCode})`, {
      memberId: reviewerId, targetId: member.id, applicationId, outcome, reasonCode,
      hoursInQueue: application.submittedAt
        ? Math.round((Date.now() - new Date(application.submittedAt)) / 36e5)
        : null
    });
    await versionedCache.bumpAll(['moderation', 'members']);
    return updated;
  }

  /** Approval side-effects: badges, photo release, status, notification. */
  async function approveMember(member, application, { interviewPassed, reviewerId }) {
    const badges = verification.badgesForApproval({
      side: member.side,
      interviewPassed,
      employerConfirmed: Boolean(application.means?.employer && interviewPassed)
    });
    for (const { badge, evidence } of badges) {
      await verification.grant(member.id, badge, { evidence, reviewerId });
    }

    // Photos go live with the approval — the reviewer has just looked at them.
    const photos = await media.forMember(member.id);
    for (const photo of photos) {
      if (photo.moderationState === 'pending') {
        await media.moderate(photo.id, 'live', { reviewerId, reason: 'approved_with_application' });
      }
    }
    await profiles.publish(member.id);

    // Women enter the product directly; men must subscribe first, so they are
    // approved but dormant until checkout completes.
    const status = member.side === 'female' ? members.STATUS.ACTIVE : members.STATUS.DORMANT;
    await members.setStatus(member.id, status, { reason: 'approved' });

    await notifications.notify(member.id, 'application.approved', {
      side: member.side,
      requiresSubscription: member.side === 'male'
    });
  }

  async function appeal(memberId) {
    const application = await forMember(memberId);
    if (!application || application.state !== STATE.DECLINED) {
      throw new ConflictError('There is no declined application to appeal');
    }
    const decidedAt = new Date(application.decision?.decidedAt || application.startedAt);
    const daysSince = (Date.now() - decidedAt.getTime()) / 864e5;
    if (daysSince < config.review.appealAfterDays) {
      throw new ConflictError(
        `You can appeal ${config.review.appealAfterDays} days after a decision`,
        'appeal_too_soon'
      );
    }
    const existingAppeal = await store.findOne(C.APPLICATIONS, (a) => a.appealOf === application.id);
    if (existingAppeal) throw new ConflictError('You have already appealed once', 'appeal_used');

    const created = await store.create(C.APPLICATIONS, {
      memberId,
      side: application.side,
      state: STATE.DRAFT,
      step: 1,
      means: application.means,
      inviteCode: null,
      prescreenFlags: [],
      interview: null,
      decision: null,
      appealOf: application.id,
      priority: 2,
      startedAt: new Date().toISOString(),
      submittedAt: null
    });
    await members.setStatus(memberId, members.STATUS.PENDING);
    return created;
  }

  /** Applications approaching or past the SLA — drives the reviewer alert. */
  async function slaBreaches() {
    const open = await queue({ state: 'open' });
    const now = Date.now();
    return open
      .filter((a) => a.slaDueAt)
      .map((a) => ({ application: a, hoursRemaining: (new Date(a.slaDueAt) - now) / 36e5 }))
      .filter((entry) => entry.hoursRemaining < 6)
      .sort((a, b) => a.hoursRemaining - b.hoursRemaining);
  }

  return {
    forMember, getOrThrow, saveDraft, submit, withdraw, queue, reviewDetail,
    claim, scheduleInterview, recordInterview, decide, appeal, slaBreaches,
    preScreen, STATE, REASON_CODES
  };
}

module.exports = { createApplicationService, STATE, REASON_CODES };
