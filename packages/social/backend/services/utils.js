'use strict';

/**
 * @fileoverview Small pure helpers shared across services. No I/O, no service
 * dependencies — safe to require anywhere.
 */

const crypto = require('node:crypto');
const config = require('../config');

/** Stable one-way hash, used for ban matching on email and photo content. */
function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** Calendar date in the member's timezone — the boundary daily allowances reset on. */
function todayIso(timezone = config.timezone, when = new Date()) {
  // en-CA formats as YYYY-MM-DD, which sorts lexicographically.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(when);
}

/** Start of the next local day, as an ISO instant — what a 429 reports. */
function nextResetIso(timezone = config.timezone, when = new Date()) {
  const today = todayIso(timezone, when);
  const [y, m, d] = today.split('-').map(Number);
  // Approximate: midnight UTC of the following calendar day. Good enough for
  // a countdown; the authoritative check is always the date key itself.
  return new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0)).toISOString();
}

/** Age never comes from the client and a date of birth is never returned. */
function ageFrom(dateOfBirth, now = new Date()) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

function isAdult(dateOfBirth, now = new Date()) {
  const age = ageFrom(dateOfBirth, now);
  return age !== null && age >= 18;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/** Haversine over coarse centroids — precise coordinates are never stored. */
function distanceKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Distance is exposed as a band, never a number — a precise distance from two
 * known points triangulates a home address.
 */
function distanceBand(km) {
  if (km == null) return null;
  if (km < 5) return '< 5 km';
  if (km < 15) return '5–15 km';
  if (km < 50) return '15–50 km';
  return '50 km+';
}

function isInLaunchCity(city) {
  if (!config.launch.geoGate) return true;
  const normalized = String(city || '').trim().toLowerCase();
  if (!normalized) return false;
  return config.launch.aliases.some((alias) => normalized.includes(alias));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function daysBetween(a, b) {
  return Math.abs(new Date(a) - new Date(b)) / (1000 * 60 * 60 * 24);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Deterministic shuffle so a deck's presentation order is stable per day. */
function seededShuffle(items, seed) {
  const array = [...items];
  let state = 0;
  for (const char of String(seed)) state = (state * 31 + char.charCodeAt(0)) % 2147483647;
  for (let i = array.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) % 2147483647;
    const j = state % (i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

module.exports = {
  sha256,
  normalizeEmail,
  todayIso,
  nextResetIso,
  ageFrom,
  isAdult,
  distanceKm,
  distanceBand,
  isInLaunchCity,
  clamp,
  daysBetween,
  addDays,
  seededShuffle
};
