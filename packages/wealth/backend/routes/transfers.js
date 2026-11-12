'use strict';

const express = require('express');
const { asyncHandler } = require('./asyncHandler');

function transfersRouter({ transfers }) {
  const router = express.Router();

  router.post('/', asyncHandler(async (req, res) => {
    res.status(201).json(await transfers.create(req.body));
  }));

  return router;
}

module.exports = { transfersRouter };
