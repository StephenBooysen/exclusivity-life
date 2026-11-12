'use strict';

/**
 * @fileoverview Container names in one place. Three of these are sharded
 * because the file provider reads whole containers — see .docs §10.3.
 */

const C = {
  MEMBERS: 'members',
  PROFILES: 'profiles',
  PREFERENCES: 'preferences',
  APPLICATIONS: 'applications',
  VERIFICATIONS: 'verifications',
  PHOTOS: 'photos',
  MATCHES: 'matches',
  CONVERSATIONS: 'conversations',
  BLOCKS: 'blocks',
  REPORTS: 'reports',
  MODERATION_ACTIONS: 'moderation_actions',
  SUBSCRIPTIONS: 'subscriptions',
  INVOICES: 'invoices',
  INVITES: 'invites',
  NOTIFICATIONS: 'notifications',
  ALLOWANCES: 'allowances',
  INTERACTIONS: 'interactions',
  BANNED_IDENTITIES: 'banned_identities',
  METRICS: 'metrics',
  ACTIVITY_LOG: 'activity_log'
};

/**
 * Likes are sharded by the first two hex characters of the *recipient* id, so
 * "who liked me" reads exactly one shard instead of every like ever recorded.
 */
function likesShard(toMemberId) {
  const key = String(toMemberId || '').replace(/-/g, '').slice(0, 2).toLowerCase() || '00';
  return `likes_${key}`;
}

/** Every shard name — for sweeps that must cover all of them. */
function allLikeShards() {
  const hex = '0123456789abcdef';
  const shards = [];
  for (const a of hex) for (const b of hex) shards.push(`likes_${a}${b}`);
  return shards;
}

/** One container per match keeps a send's read bounded to that conversation. */
function messagesContainer(matchId) {
  return `messages_${matchId}`;
}

/** One container per day; pruned by the retention sweep. */
function decksContainer(dateIso) {
  return `decks_${dateIso}`;
}

module.exports = { C, likesShard, allLikeShards, messagesContainer, decksContainer };
