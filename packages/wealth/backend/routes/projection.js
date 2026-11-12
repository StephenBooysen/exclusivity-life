'use strict';

const express = require('express');
const { asyncHandler } = require('./asyncHandler');

function projectionRouter({ projection }) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await projection.forScenario(req.query.scenario));
  }));

  router.get('/compare', asyncHandler(async (req, res) => {
    const ids = (req.query.scenarios || '').split(',').filter(Boolean);
    res.json(await projection.compare(ids.length ? ids : [undefined]));
  }));

  return router;
}

module.exports = { projectionRouter };
