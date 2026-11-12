'use strict';

/**
 * @fileoverview Transactional email.
 *
 * The platform's notifying service is an in-process message bus, not a mail
 * transport, so email gets its own provider abstraction: a stub that writes to
 * the log in development, nodemailer SMTP in production.
 */

const config = require('../config');

const TEMPLATES = {
  'application.received': (d) => ({
    subject: 'We have your application',
    body: `Thank you for applying to Exclusivity.

A member of our team reviews every application personally. You'll hear from us within ${d.slaHours} hours.${
  d.interviewExpected ? '\n\nAs part of the process we\'ll invite you to a short introductory call.' : ''
}

— The Exclusivity team`
  }),

  'application.approved': (d) => ({
    subject: 'Welcome to Exclusivity',
    body: `Your application has been approved.${
  d.requiresSubscription
    ? '\n\nOne step remains: choose your membership to open your introductions.'
    : '\n\nYour first introductions are waiting.'
}

— The Exclusivity team`
  }),

  'application.declined': (d) => ({
    subject: 'About your Exclusivity application',
    body: `We're not able to offer you a place at this time.

Reason: ${humanReason(d.reasonCode)}

You're welcome to apply again after ${d.appealAfterDays} days.

— The Exclusivity team`
  }),

  'application.waitlisted': (d) => ({
    subject: "You're on the Exclusivity waitlist",
    body: `Thank you for applying.${
  d.reasonCode === 'outside_launch_city'
    ? `\n\nExclusivity is currently open in ${d.city || config.launch.city} only. We'll be in touch the moment we open in your city.`
    : "\n\nWe're managing numbers carefully to keep the community balanced. We'll be in touch as soon as a place opens."
}

— The Exclusivity team`
  }),

  'application.info_requested': (d) => ({
    subject: 'One more thing for your Exclusivity application',
    body: `We need a little more before we can complete your review.

${d.note || 'Please sign in and review your application.'}

— The Exclusivity team`
  }),

  'application.interview_scheduled': (d) => ({
    subject: 'Your Exclusivity introduction call',
    body: `We'd like to speak with you.

When: ${formatWhen(d.scheduledFor)}
How long: about ${d.durationMinutes} minutes

This is an informal conversation — we do this with every member to keep the community what it is.

— The Exclusivity team`
  }),

  'match.created': () => ({
    subject: 'You have a new match',
    body: 'Someone you liked liked you back. Open Exclusivity to start the conversation.'
  }),

  'match.expiring': () => ({
    subject: 'Your match is about to expire',
    body: 'A match is waiting for a first message. Conversations that never start close after seven days.'
  }),

  'message.new': (d) => ({
    subject: 'New message on Exclusivity',
    body: `You have a new message.\n\n"${d.preview || ''}"`
  }),

  'membership.started': (d) => ({
    subject: `Your ${d.tier} membership is active`,
    body: `Welcome. Your ${d.tier} membership is active and your introductions are open.`
  }),

  'membership.receipt': (d) => ({
    subject: 'Your Exclusivity receipt',
    body: `Membership: ${d.tier}\nAmount: ${config.currency} ${d.amount}\nPeriod ends: ${formatWhen(d.periodEnd)}`
  }),

  'membership.renewal_failed': (d) => ({
    subject: 'We could not renew your membership',
    body: `We weren't able to take payment. Your membership stays open until ${formatWhen(d.graceUntil)} — update your card to keep it.`
  }),

  'membership.cancelled': (d) => ({
    subject: 'Your membership is cancelled',
    body: `Your membership will remain active until ${formatWhen(d.periodEnd)}. Your conversations stay with you.`
  }),

  'moderation.warned': (d) => ({
    subject: 'A note about your Exclusivity account',
    body: `We've had to issue a warning about your conduct.\n\n${d.reason}\n\nFurther issues will lead to suspension.`
  }),

  'moderation.suspended': (d) => ({
    subject: 'Your Exclusivity account is suspended',
    body: `Your account is suspended until ${formatWhen(d.until)}.\n\nReason: ${d.reason}`
  }),

  'moderation.banned': (d) => ({
    subject: 'Your Exclusivity account has been closed',
    body: `Your account has been closed for a breach of our community standards.\n\nReason: ${d.reason}`
  }),

  'moderation.content_removed': (d) => ({
    subject: 'Content removed from your profile',
    body: `Some of your content has been removed.\n\nReason: ${d.reason}`
  }),

  'daily.introductions': (d) => ({
    subject: "Today's introductions are ready",
    body: `${d.count} new ${d.count === 1 ? 'introduction is' : 'introductions are'} waiting for you.`
  })
};

function humanReason(code) {
  const map = {
    incomplete_profile: 'the application was incomplete',
    photo_quality: 'the photos did not meet our standards',
    photo_unverified: 'we could not verify the photos',
    outside_launch_city: 'we are not yet open in your city',
    capacity: 'we are at capacity',
    interview_not_passed: 'the introduction call',
    policy_violation: 'a breach of our community standards',
    duplicate_account: 'an existing account',
    age_ineligible: 'age eligibility',
    other: 'our review'
  };
  return map[code] || 'our review';
}

function formatWhen(value) {
  if (!value) return 'shortly';
  try {
    return new Date(value).toLocaleString(config.locale, { timeZone: config.timezone });
  } catch {
    return String(value);
  }
}

function createEmailService({ logger }) {
  let transport = null;

  function getTransport() {
    if (config.email.provider !== 'smtp') return null;
    if (!transport) {
      const nodemailer = require('nodemailer');
      transport = nodemailer.createTransport({
        host: config.email.smtp.host,
        port: config.email.smtp.port,
        secure: config.email.smtp.port === 465,
        auth: config.email.smtp.user
          ? { user: config.email.smtp.user, pass: config.email.smtp.pass }
          : undefined
      });
    }
    return transport;
  }

  async function send(template, to, data = {}) {
    const build = TEMPLATES[template];
    if (!build) {
      logger.warn(`[email] no template for ${template}`);
      return null;
    }
    const { subject, body } = build(data);

    if (config.email.provider === 'stub') {
      // Development: the log is the outbox.
      logger.info(`[email:stub] to=${to} subject="${subject}"\n${body}`);
      return { stubbed: true, to, subject };
    }

    const mailer = getTransport();
    await mailer.sendMail({ from: config.email.from, to, subject, text: body });
    logger.info(`[email] sent ${template} to ${to}`);
    return { to, subject };
  }

  return { send, TEMPLATES };
}

module.exports = { createEmailService, TEMPLATES };
