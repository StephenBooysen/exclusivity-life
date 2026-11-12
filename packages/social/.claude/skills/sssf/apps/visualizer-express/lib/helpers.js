/**
 * Everything the EJS templates are allowed to call, gathered in one place and
 * hung off `app.locals`.
 *
 * The formatting/geometry modules themselves live under public/js/shared/ so
 * the browser can import the very same files when it re-renders. This module
 * is only the server-side wiring plus the few label maps that are pure
 * presentation.
 */

import * as fmt from "../public/js/shared/format.js";
import * as ev from "../public/js/shared/events.js";
import * as models from "../public/js/shared/models.js";
import * as layout from "../public/js/shared/layout.js";
import * as detail from "../public/js/shared/detail.js";
import { escapeHtml, highlightJson, highlightJsonText } from "../public/js/shared/highlight.js";
import { renderMarkdown } from "../public/js/shared/markdown.js";
import { icon, KIND_ICONS, STAT_ICONS, STATUS_ICONS } from "../public/js/shared/icons.js";

/**
 * Every chip explains itself on hover. The token numbers in particular are read
 * wrong without one — the headline is billed volume, not distinct tokens.
 */
export const STAT_TITLES = {
  cost: "Cost — dollars billed for this run, all agents combined.",
  tokens:
    "Tokens exchanged (billed) — everything sent or generated, counted once per turn. " +
    "Each turn re-sends the whole conversation, so this is far larger than the " +
    "conversation itself: it is spend, not size. The gap between it and read + " +
    "written is cached context re-read on later turns.",
  runtime:
    "Duration — wall-clock from the first phase starting to the last one ending.",
  read:
    "Read — raw tokens the models took in: prompts, file contents and tool results, " +
    "counted the first time they enter the context. Excludes cached re-reads of " +
    "material already counted here.",
  written:
    "Written — tokens the models actually generated. Each one produced exactly " +
    "once, so this is a true count of output.",
};

/** Text for a stat chip, by kind. Mirrors StatChip.vue's `text` computed. */
export function statText(kind, value) {
  if (kind === "cost") return fmt.fmtCost(value);
  if (kind === "runtime") return fmt.fmtDuration(value ?? NaN);
  return fmt.fmtTokens(value);
}

export const locals = {
  // formatting
  ts: fmt.ts,
  fmtDuration: fmt.fmtDuration,
  fmtClock: fmt.fmtClock,
  fmtDate: fmt.fmtDate,
  fmtTokens: fmt.fmtTokens,
  fmtCost: fmt.fmtCost,
  fmtOffset: fmt.fmtOffset,
  fmtNumber: fmt.fmtNumber,
  money: fmt.money,
  payloadOk: fmt.payloadOk,

  // events / models
  eventLabel: ev.eventLabel,
  hexAlpha: ev.hexAlpha,
  modelIcon: models.modelIcon,
  modelName: models.modelName,

  // html producers (each escapes its own input)
  escapeHtml,
  highlightJson,
  highlightJsonText,
  renderMarkdown,

  // icons
  icon,
  STATUS_ICONS,
  STAT_ICONS,
  KIND_ICONS,

  // view models
  buildWaterfall: layout.buildWaterfall,
  buildCardTimeline: layout.buildCardTimeline,
  buildPhaseDetail: detail.buildPhaseDetail,
  sessionDurationMs: layout.sessionDurationMs,
  PHASE_DOT_GLYPH: layout.PHASE_DOT_GLYPH,

  // labels
  STAT_TITLES,
  statText,

  // json for the client island, safely embedded in a <script> tag
  jsonScript(value) {
    return JSON.stringify(value).replaceAll("<", "\\u003c");
  },
};
