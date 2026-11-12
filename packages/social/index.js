/**
 * @fileoverview Exclusivity — entry point.
 * Boots the Express app assembled in backend/app.js (native JS backend,
 * JSON-file storage via nooblyjs-core, static PWA frontend in ./public —
 * no React, no build step), attaches the realtime socket to the same server,
 * seeds the console account, and starts the background jobs.
 */

'use strict';

const http = require('node:http');
const { createApp } = require('./backend/app');
const config = require('./backend/config');

const { app, services, realtime, jobs, logger } = createApp();
const server = http.createServer(app);

realtime.attach(server);

async function boot() {
  await services.auth.ensureBootstrapAdmin();
  jobs.start();
}

boot()
  .catch((err) => logger.error(`[boot] ${err.message}`))
  .finally(() => {
    server.listen(config.port, () => {
      const line = '='.repeat(62);
      console.log(line);
      console.log(`  ${config.name} — running on http://localhost:${config.port}`);
      console.log(`  Launch city:  ${config.launch.city}`);
      console.log(`  Billing:      ${services.billing.provider}`);
      console.log(`  Email:        ${config.email.provider}`);
      console.log(`  Admin console: http://localhost:${config.port}/#/admin`);
      console.log(`  Platform services: http://localhost:${config.port}/platform-core`);
      console.log(line);
    });
  });

function shutdown(signal) {
  logger.info(`[shutdown] ${signal} received`);
  jobs.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
