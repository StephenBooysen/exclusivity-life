'use strict';

/**
 * @fileoverview Single source of configuration. Every tunable the product
 * documents in .docs lives here — deck sizes, scoring weights, retention
 * windows, review SLA — so they can be changed without hunting through
 * service code.
 */

const path = require('node:path');

const ROOT_DIR = path.join(__dirname, '..');
const APPLICATION_DIR = path.join(ROOT_DIR, '.application');

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  name: 'Exclusivity',
  port: process.env.PORT || 9401,
  isProduction,

  rootDir: ROOT_DIR,
  publicDir: path.join(ROOT_DIR, 'public'),
  logDir: path.join(APPLICATION_DIR, 'logs'),
  dataDir: path.join(APPLICATION_DIR, 'data'),
  mediaDir: path.join(APPLICATION_DIR, 'media'),
  cacheDir: path.join(APPLICATION_DIR, 'caching'),
  searchDir: path.join(APPLICATION_DIR, 'search'),
  authDir: path.join(APPLICATION_DIR, 'auth'),
  activitiesFolder: path.join(__dirname, 'jobs'),

  locale: 'en-ZA',
  currency: 'ZAR',
  timezone: 'Africa/Johannesburg',

  session: {
    secret: process.env.SESSION_SECRET || (isProduction ? null : 'exclusivity-dev-secret-not-for-production'),
    maxAgeDays: 30
  },

  /**
   * Single-city launch. Applications from outside the launch city are
   * waitlisted rather than declined — the pool is geo-gated to protect the
   * gender ratio, not because the applicant failed.
   */
  launch: {
    city: 'Johannesburg',
    // Accepted as "in the launch city" — matched case-insensitively against
    // the applicant's declared city.
    aliases: ['johannesburg', 'joburg', 'jhb', 'sandton', 'rosebank', 'midrand',
      'fourways', 'bryanston', 'melrose', 'parkhurst', 'houghton', 'illovo',
      'randburg', 'pretoria', 'centurion'],
    geoGate: true
  },

  review: {
    slaHours: 48,
    // Means standing is established by interview, not documents. Male
    // applicants must pass an interview before approval; a reviewer may
    // request one for any applicant.
    interviewRequiredFor: ['male'],
    interviewDurationMinutes: 20,
    appealAfterDays: 30
  },

  media: {
    maxUploadBytes: 12 * 1024 * 1024,
    minPhotos: 3,
    maxPhotos: 6,
    sizes: { thumb: 160, card: 480, detail: 1080 },
    acceptedMime: ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']
  },

  matching: {
    weights: {
      preference: 0.30,
      reciprocity: 0.25,
      completeness: 0.15,
      verification: 0.15,
      recency: 0.10,
      diversity: 0.05,
      boost: 0.10
    },
    // No single profile may occupy more than this share of a night's decks.
    // Without it the top-scoring dozen absorb every like in the city.
    appearanceCapRatio: 0.15,
    // Bayesian shrink toward the population mean; stops a profile with two
    // like-backs out of two from ranking above one with 40 out of 100.
    reciprocityPrior: 20,
    recencyHalfLifeDays: 14,
    deckHour: 6
  },

  matchExpiryDays: 7,
  matchReminderDays: 5,

  retention: {
    livenessDays: 90,
    unmatchedMessagesDays: 90,
    notificationDays: 90,
    deckDays: 7
  },

  limits: {
    messageMaxLength: 2000,
    bioMaxLength: 300,
    promptMaxLength: 250,
    reportsPerDay: 10
  },

  billing: {
    provider: process.env.STRIPE_SECRET_KEY ? 'stripe' : 'stub',
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    successUrl: process.env.BILLING_SUCCESS_URL || 'http://localhost:9401/#/discover',
    cancelUrl: process.env.BILLING_CANCEL_URL || 'http://localhost:9401/#/membership',
    gracePeriodDays: 7
  },

  email: {
    provider: process.env.SMTP_HOST ? 'smtp' : 'stub',
    from: process.env.SMTP_FROM || 'Exclusivity <no-reply@exclusivity.life>',
    smtp: {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  },

  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:9401/api/auth/google/callback'
    }
  },

  /**
   * Seeded on first boot so the review queue is reachable. Change the password
   * immediately in any deployed environment.
   */
  bootstrapAdmin: {
    email: process.env.ADMIN_EMAIL || 'admin@exclusivity.life',
    password: process.env.ADMIN_PASSWORD || 'Exclusivity!Admin2026',
    fullName: 'Exclusivity Administrator'
  }
};
