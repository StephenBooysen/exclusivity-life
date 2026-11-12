/**
 * @fileoverview Me Money Manager — entry point.
 * Boots the Express app assembled in backend/app.js (native JS backend,
 * JSON-file storage via nooblyjs-core, static frontend in
 * ./public — no React, no build step).
 */

'use strict';

const { createApp } = require('./backend/app');
const config = require('./backend/config');

const app = createApp();

app.listen(config.port, () => {
  console.log(`Me Money Manager running on port ${config.port}`);
});
