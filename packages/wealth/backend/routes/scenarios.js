'use strict';

const express = require('express');
const { asyncHandler } = require('./asyncHandler');

function scenariosRouter({ scenarios }) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await scenarios.list());
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const scenario = await scenarios.get(req.params.id);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
    res.json(scenario);
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json(await scenarios.create(req.body));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const updated = await scenarios.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Scenario not found' });
    res.json(updated);
  }));

  router.delete('/:id', asyncHandler(async (req, res, next) => {
    try {
      const removed = await scenarios.remove(req.params.id);
      if (!removed) return res.status(404).json({ error: 'Scenario not found' });
      res.status(204).end();
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }));

  return router;
}

module.exports = { scenariosRouter };
