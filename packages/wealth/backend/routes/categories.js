'use strict';

const express = require('express');
const { asyncHandler } = require('./asyncHandler');

function categoriesRouter({ categories }) {
  const router = express.Router();

  router.get('/', asyncHandler(async (req, res) => {
    res.json(await categories.list());
  }));

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json(await categories.create(req.body));
  }));

  router.put('/:id', asyncHandler(async (req, res) => {
    const updated = await categories.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Category not found' });
    res.json(updated);
  }));

  router.delete('/:id', asyncHandler(async (req, res) => {
    const removed = await categories.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Category not found' });
    res.status(204).end();
  }));

  return router;
}

module.exports = { categoriesRouter };
