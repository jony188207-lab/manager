'use strict';

const { scrubSecrets } = require('../utils/redact');

class TelegramError extends Error {
  constructor(method, code, description, parameters) {
    super(`Telegram ${method} failed: ${description}`);
    this.name = 'TelegramError';
    this.method = method;
    this.code = code;
    this.description = description;
    this.retryAfter = parameters && parameters.retry_after;
  }
}

/**
 * Calls the official Telegram Bot API (https://core.telegram.org/bots/api).
 * The token only ever lives in this function's URL; it is never logged or put in errors.
 */
async function callApi(token, method, params = {}, timeoutMs = 10000) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (_) {
    throw new TelegramError(method, 0, 'Could not reach Telegram (network error or timeout)');
  }

  let body = null;
  try {
    body = await res.json();
  } catch (_) {
    /* non-JSON response */
  }

  if (!res.ok || !body || body.ok !== true) {
    throw new TelegramError(
      method,
      (body && body.error_code) || res.status,
      scrubSecrets((body && body.description) || 'Unexpected response from Telegram'),
      body && body.parameters
    );
  }
  return body.result;
}

function createClient(token) {
  const call = (method, params) => callApi(token, method, params);
  return {
    getMe: () => call('getMe'),
    setWebhook: (p) => call('setWebhook', p),
    deleteWebhook: (p = {}) => call('deleteWebhook', p),
    getWebhookInfo: () => call('getWebhookInfo'),
    getChat: (p) => call('getChat', p),
    getChatMember: (p) => call('getChatMember', p),
    sendMessage: (p) => call('sendMessage', p),
    editMessageText: (p) => call('editMessageText', p),
    answerCallbackQuery: (p) => call('answerCallbackQuery', p),
    approveChatJoinRequest: (p) => call('approveChatJoinRequest', p),
    declineChatJoinRequest: (p) => call('declineChatJoinRequest', p),
  };
}

module.exports = { createClient, TelegramError, callApi };
