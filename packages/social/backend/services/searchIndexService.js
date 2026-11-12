'use strict';

/**
 * @fileoverview Keeps the platform searching index in sync with live profiles.
 *
 * Discovery keyword search goes through here, never through
 * `dataService.find` — that is a recursive substring scan over every string in
 * every record, not an index.
 *
 * Index failures are swallowed by design: search is an enhancement to browse,
 * and a broken index must not take profile editing down with it.
 */

const INDEX = 'profiles';

function createSearchIndexService({ searching, profiles, media, members, logger }) {
  /** Only the fields worth matching on — never bio free text alone. */
  function documentFor(profile, member) {
    return {
      id: profile.memberId,
      memberId: profile.memberId,
      firstName: profile.firstName || '',
      city: profile.city || '',
      occupation: profile.occupation || '',
      employer: profile.employer || '',
      education: profile.education || '',
      intent: profile.intent || '',
      bio: profile.bio || '',
      badges: (member?.badges || []).join(' ')
    };
  }

  async function index(profile) {
    if (!profile || profile.moderationState !== 'live') return false;
    try {
      const member = await members.get(profile.memberId);
      if (!member || member.status !== 'active') return false;
      await searching.add(profile.memberId, documentFor(profile, member), INDEX);
      return true;
    } catch (err) {
      logger?.debug?.(`[search] index failed for ${profile.memberId}: ${err.message}`);
      return false;
    }
  }

  async function remove(memberId) {
    try {
      await searching.remove(memberId, INDEX);
      return true;
    } catch (err) {
      logger?.debug?.(`[search] remove failed for ${memberId}: ${err.message}`);
      return false;
    }
  }

  /** @return {Promise<string[]|null>} matching member ids, or null if unavailable */
  async function query(text) {
    if (!text || !String(text).trim()) return null;
    try {
      const results = await searching.search(String(text).trim(), INDEX);
      const rows = Array.isArray(results) ? results : results?.results || [];
      return rows
        .map((row) => row.memberId || row.id || row.key || row?.document?.memberId)
        .filter(Boolean);
    } catch (err) {
      logger?.debug?.(`[search] query failed: ${err.message}`);
      return null;
    }
  }

  /** Full rebuild — used at boot and after bulk moderation. */
  async function reindexAll() {
    let indexed = 0;
    try {
      const all = await profiles.all();
      for (const profile of all) {
        if (await index(profile)) indexed += 1;
      }
      await searching.saveToDisk?.().catch(() => {});
    } catch (err) {
      logger?.warn?.(`[search] reindex failed: ${err.message}`);
    }
    return indexed;
  }

  return { index, remove, query, reindexAll, INDEX };
}

module.exports = { createSearchIndexService };
