'use strict';

const path = require('node:path');

const ROOT_DIR = path.join(__dirname, '..');
const APPLICATION_DIR = path.join(ROOT_DIR, '.application');

module.exports = {
  port: process.env.PORT || 11001,
  rootDir: ROOT_DIR,
  publicDir: path.join(ROOT_DIR, 'public'),
  logDir: path.join(APPLICATION_DIR, 'logs'),
  dataDir: path.join(APPLICATION_DIR, 'data'),
  activitiesFolder: path.join(__dirname, 'jobs'),
  currency: 'ZAR',
  locale: 'en-ZA',
  defaults: {
    horizonAge: 90,
    retirementAge: 65,
    inflationRate: 0.055,
    drawdownRate: 0.04,
    propertyAppreciationRate: 0.06,
    cashGrowthRate: 0.02,
    utilisationWarningThreshold: 0.7
  }
};
