'use strict';

const express = require('express');
const { asyncHandler } = require('./asyncHandler');

function transactionsRouter({ transactions }) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    const { accountId, month } = req.query;
    res.json(month ? await transactions.forMonth(accountId, month) : await transactions.list(accountId));
  }));

  router.get('/totals', asyncHandler(async (req, res) => {
    res.json(await transactions.totalsByCategory(req.query.accountId, req.query.month));
  }));

  router.put('/opening-balance', asyncHandler(async (req, res) => {
    const { accountId, month, amount } = req.body;
    res.json(await transactions.setOpeningBalance(accountId, month, amount));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json(await transactions.create(req.body));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const updated = await transactions.update(req.body.accountId, req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Transaction not found' });
    res.json(updated);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const removed = await transactions.remove(req.query.accountId, req.params.id);
    if (!removed) return res.status(404).json({ error: 'Transaction not found' });
    res.status(204).end();
  }));

  return router;
}

module.exports = { transactionsRouter };
