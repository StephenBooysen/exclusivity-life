'use strict';

const express = require('express');
const { asyncHandler } = require('./asyncHandler');

function debitOrdersRouter({ debitOrders }) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await debitOrders.list());
  }));

  router.get('/upcoming', asyncHandler(async (req, res) => {
    const days = Number(req.query.days) || 7;
    res.json(await debitOrders.upcoming(days));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json(await debitOrders.create(req.body));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const updated = await debitOrders.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Debit order not found' });
    res.json(updated);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const removed = await debitOrders.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Debit order not found' });
    res.status(204).end();
  }));

  return router;
}

module.exports = { debitOrdersRouter };
