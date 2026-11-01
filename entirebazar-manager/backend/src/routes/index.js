'use strict';

const express = require('express');
const { authenticate } = require('../middleware/requireAuth');

const router = express.Router();

// Every /api route requires a valid Firebase ID token AND an active admin record.
router.use(authenticate);

router.use('/me', require('./me'));
router.use('/dashboard', require('./dashboard'));
router.use('/bots', require('./bots'));
router.use('/groups', require('./groups'));
router.use('/channels', require('./channels'));
router.use('/verification', require('./verification'));
router.use('/buttons', require('./buttons'));
router.use('/welcome', require('./welcome'));
router.use('/logs', require('./logs'));
router.use('/admins', require('./admins'));
router.use('/settings', require('./settings'));

module.exports = router;
