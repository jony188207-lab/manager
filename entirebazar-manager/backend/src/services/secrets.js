'use strict';

const env = require('../config/env');
const { createCrypto } = require('../utils/crypto');

// One instance bound to TOKEN_ENCRYPTION_KEY. Used for bot tokens and webhook secrets.
module.exports = createCrypto(env.TOKEN_ENCRYPTION_KEY);
