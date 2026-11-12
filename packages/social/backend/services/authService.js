'use strict';

/**
 * @fileoverview Registration and sign-in.
 *
 * Credentials live in the platform authservice (bcrypt hashing, strength
 * validation, unique email). This wrapper owns the pairing with a member
 * record and the uniform responses that keep the endpoints from confirming
 * whether an account exists.
 */

const config = require('../config');
const { normalizeEmail, isInLaunchCity } = require('./utils');
const { ValidationError, AuthError, ConflictError, ForbiddenError } = require('../errors');

function createAuthService({ auth, members, activity, logger }) {
  /**
   * Creates the credential and the member record together. If the member write
   * fails the credential is rolled back, so a half-created account cannot
   * block the email forever.
   */
  async function register({ email, password, fullName, side, city }) {
    const normalized = normalizeEmail(email);
    if (!normalized || !normalized.includes('@')) throw new ValidationError('Enter a valid email address');
    if (!password) throw new ValidationError('Choose a password');
    if (!['male', 'female'].includes(side)) throw new ValidationError('Select which side you are applying to');
    if (!fullName || !fullName.trim()) throw new ValidationError('Enter your name');

    const existing = await members.getByEmail(normalized);
    if (existing) throw new ConflictError('An account with that email already exists', 'email_taken');

    try {
      await auth.createUser({ email: normalized, fullName: fullName.trim(), password, role: 'user' });
    } catch (err) {
      if (/already exists/i.test(err.message)) {
        throw new ConflictError('An account with that email already exists', 'email_taken');
      }
      // Surfaces the provider's strength requirements verbatim — they are the
      // rules actually being enforced.
      throw new ValidationError(err.message);
    }

    let member;
    try {
      member = await members.create({
        email: normalized,
        side,
        displayName: fullName.trim().split(/\s+/)[0],
        city: city || null
      });
    } catch (err) {
      await auth.deleteUser(normalized).catch(() => {});
      throw err;
    }

    return member;
  }

  /**
   * Uniform failure regardless of whether the email exists — sign-in must not
   * be an account-enumeration oracle.
   */
  async function login(email, password) {
    const normalized = normalizeEmail(email);
    let member = null;
    try {
      await auth.authenticateUser(normalized, password);
      member = await members.getByEmail(normalized);
    } catch {
      member = null;
    }
    if (!member) throw new AuthError('Those details do not match an account');

    if (member.status === members.STATUS.BANNED) {
      throw new ForbiddenError('This account has been closed', 'account_closed');
    }
    if (member.status === members.STATUS.DELETED) {
      throw new AuthError('Those details do not match an account');
    }
    if (!members.canSignIn(member)) {
      if (member.status === members.STATUS.SUSPENDED) {
        const until = member.suspendedUntil;
        if (!until || new Date(until) > new Date()) {
          throw new ForbiddenError('This account is suspended', 'account_suspended');
        }
        await members.setStatus(member.id, members.STATUS.ACTIVE, { reason: 'suspension_elapsed' });
        member = await members.getOrThrow(member.id);
      } else {
        throw new AuthError('Those details do not match an account');
      }
    }

    await members.touch(member.id);
    await activity.log('member.signed_in', `${member.email} signed in`, { memberId: member.id });
    return member;
  }

  async function changePassword(member, { currentPassword, newPassword }) {
    if (!newPassword) throw new ValidationError('Choose a new password');
    try {
      await auth.authenticateUser(member.email, currentPassword);
    } catch {
      throw new AuthError('Your current password is not correct');
    }
    try {
      await auth.updateUser(member.email, { password: newPassword });
    } catch (err) {
      throw new ValidationError(err.message);
    }
    await activity.log('member.password_changed', `${member.email} changed password`, { memberId: member.id });
    return true;
  }

  /**
   * Seeds the console account on first boot so the review queue is reachable.
   * Logs loudly when the default password is still in place.
   */
  async function ensureBootstrapAdmin() {
    const { email, password, fullName } = config.bootstrapAdmin;
    const normalized = normalizeEmail(email);
    const existing = await members.getByEmail(normalized);
    if (existing) return existing;

    try {
      await auth.createUser({ email: normalized, fullName, password, role: 'admin' });
    } catch (err) {
      if (!/already exists/i.test(err.message)) {
        logger.error(`[auth] could not seed admin: ${err.message}`);
        return null;
      }
    }

    const member = await members.create({
      email: normalized,
      side: null,
      displayName: 'Admin',
      city: config.launch.city,
      role: 'admin'
    });
    await members.update(member.id, { status: members.STATUS.ACTIVE, role: 'admin' });

    if (!process.env.ADMIN_PASSWORD) {
      logger.warn('='.repeat(70));
      logger.warn(`[auth] Seeded admin ${normalized} with the default password.`);
      logger.warn('[auth] Set ADMIN_EMAIL / ADMIN_PASSWORD before deploying anywhere.');
      logger.warn('='.repeat(70));
    }
    return member;
  }

  function cityInLaunchArea(city) {
    return isInLaunchCity(city);
  }

  return { register, login, changePassword, ensureBootstrapAdmin, cityInLaunchArea };
}

module.exports = { createAuthService };
