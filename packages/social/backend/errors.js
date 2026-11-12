'use strict';

/**
 * @fileoverview Typed domain errors. Services throw these; the API error
 * middleware is the only place that maps them to HTTP. Every 4xx carries a
 * machine-readable `code` so the frontend can react (upsell on
 * entitlement_required, countdown on allowance_exhausted) without matching
 * on message strings.
 */

class DomainError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    if (details) this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

class ValidationError extends DomainError {
  constructor(message, details) {
    super('validation_failed', message, 400, details);
  }
}

class AuthError extends DomainError {
  constructor(message = 'Sign in to continue') {
    super('auth_required', message, 401);
  }
}

class ForbiddenError extends DomainError {
  constructor(message = 'Not permitted', code = 'forbidden') {
    super(code, message, 403);
  }
}

class NotFoundError extends DomainError {
  constructor(message = 'Not found') {
    super('not_found', message, 404);
  }
}

class ConflictError extends DomainError {
  constructor(message, code = 'conflict') {
    super(code, message, 409);
  }
}

/** 402 — the action is real but this tier does not include it. */
class EntitlementError extends DomainError {
  constructor(key, tier) {
    super('entitlement_required', 'Your membership does not include this', 402, { required: key, tier });
  }
}

/** 429 — the tier includes it but today's allowance is spent. */
class AllowanceError extends DomainError {
  constructor(key, resetsAt) {
    super('allowance_exhausted', "That's all for today", 429, { allowance: key, resetsAt });
  }
}

class ModerationError extends DomainError {
  constructor(message = 'This content cannot be published') {
    super('content_blocked', message, 403);
  }
}

module.exports = {
  DomainError,
  ValidationError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  EntitlementError,
  AllowanceError,
  ModerationError
};
