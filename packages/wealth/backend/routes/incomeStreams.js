'use strict';

const express = require('express');
const { asyncHandler } = require('./asyncHandler');

function incomeStreamsRouter({ incomeStreams }) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await incomeStreams.list());
  }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const stream = await incomeStreams.get(req.params.id);
    if (!stream) return res.status(404).json({ error: 'Income stream not found' });
    res.json(stream);
  }));

  router.get('/:id/history', asyncHandler(async (req, res) => {
    res.json(await incomeStreams.history(req.params.id));
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json(await incomeStreams.create(req.body));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const updated = await incomeStreams.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Income stream not found' });
    res.json(updated);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const removed = await incomeStreams.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Income stream not found' });
    res.status(204).end();
  }));

  return router;
}

module.exports = { incomeStreamsRouter };
