'use strict';

const express = require('express');
const { asyncHandler } = require('./asyncHandler');

function accountsRouter({ accounts }) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await accounts.list(req.query.type));
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const account = await accounts.get(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    res.json(account);
  }));

  router.get('/:id/history', asyncHandler(async (req, res) => {
    res.json(await accounts.history(req.params.id));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json(await accounts.create(req.body));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const updated = await accounts.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Account not found' });
    res.json(updated);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const removed = await accounts.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Account not found' });
    res.status(204).end();
  }));

  return router;
}

module.exports = { accountsRouter };
