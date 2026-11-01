'use strict';

module.exports = {
  ROLES: ['super_admin', 'admin'],
  PLACEMENTS: ['welcome', 'verification'],
  LOG_EVENTS: [
    'join_request',
    'dm_sent',
    'dm_failed',
    'start_command',
    'verify_pressed',
    'verify_failed',
    'approved',
    'approve_failed',
    'config_error',
  ],
  MAX_BUTTONS_PER_ROW: 8,
  MAX_BUTTONS_PER_PLACEMENT: 30,
  TELEGRAM_ALLOWED_UPDATES: ['message', 'callback_query', 'chat_join_request'],
};
