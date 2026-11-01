'use strict';

const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { getGeneral } = require('../services/settingsService');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const general = await getGeneral();
    res.json({
      uid: req.admin.uid,
      email: req.admin.email,
      role: req.admin.role,
      settings: { panelName: general.panelName, timezone: general.timezone },
    });
  })
);

module.exports = router;
