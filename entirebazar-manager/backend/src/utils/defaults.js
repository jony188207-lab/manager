'use strict';

const DEFAULT_VERIFICATION_SETTINGS = Object.freeze({
  enabled: false,
  requiredChannelIds: [],
  verifyButtonText: '✅ Verify',
  instructionText:
    'Hi {first_name}! To join {group_title}, please join the channels below, then tap Verify.',
  successText: '✅ Verified! Your request to join {group_title} has been approved.',
  missingText:
    "❌ You haven't joined all required channels yet. Still missing:\n{missing_channels}\n\nJoin them, then tap Verify again.",
  noRequestText:
    "I couldn't find a pending join request for you. Send a join request to the group first, then come back and tap Verify.",
  cooldownSeconds: 5,
});

const DEFAULT_WELCOME = Object.freeze({
  groupWelcome: Object.freeze({
    enabled: false,
    text: 'Welcome to {group_title}, {username}!',
  }),
  privateWelcome: Object.freeze({
    enabled: true,
    text: "👋 Hi {first_name}! I'm {bot_username}. I verify join requests for our groups. Send a join request to a group and I'll guide you from there.",
  }),
});

const DEFAULT_GENERAL = Object.freeze({
  panelName: 'EntireBazar Manager',
  logRetentionDays: 30,
  timezone: 'UTC',
});

module.exports = { DEFAULT_VERIFICATION_SETTINGS, DEFAULT_WELCOME, DEFAULT_GENERAL };
