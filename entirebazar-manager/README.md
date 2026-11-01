# EntireBazar Manager

Multi-bot Telegram **join-request verification** system with a web admin panel.

A user asks to join a group → the bot privately tells them which channels to join → they press **Verify** → the backend checks membership in every required channel with the official Telegram Bot API → if all are joined, the join request is **approved automatically**; otherwise it stays pending and the user is told what is missing.

There is deliberately **no feature for publishing posts or broadcasting** to groups or channels. The only message the bot ever posts in a group is the optional automatic welcome after an approval (see "Welcome messages").

## Architecture

```
Admin browser ── Firebase Auth (ID token) ──► Express API (/api/*)  ──► Firestore (Admin SDK)
 (Firebase Hosting)                                │
                                                   ├─► Telegram Bot API (outbound, per-bot token)
Telegram ── webhook (secret header) ──► /webhooks/telegram/:botId ──► verification service
```

- **Frontend** (`frontend/`): HTML, CSS, vanilla JS (ES modules). Talks only to the backend API. No bot tokens, no direct Firestore writes.
- **Backend** (`backend/`): Node.js 20 + Express. Verifies Firebase ID tokens, checks the caller's active record in `admins`, validates all input with zod, rate-limits, and talks to Telegram.
- **Database**: Firestore. Bot tokens are AES-256-GCM encrypted (key from `TOKEN_ENCRYPTION_KEY`) in the backend-only `botSecrets` collection.
- **Webhooks**: one URL per bot. `setWebhook` is called with a per-bot `secret_token` (derived with HMAC from the encryption key, never stored); every update is rejected unless Telegram's header matches.

### Folder structure

```
entirebazar-manager/
├── README.md
├── firebase.json            Hosting + Firestore config (security headers, CSP)
├── .firebaserc.example
├── firestore.rules          Read-only for active admins; secrets denied
├── firestore.indexes.json   Composite indexes for the logs filters
├── frontend/
│   ├── index.html (login) dashboard.html bots.html groups.html channels.html
│   ├── verification.html buttons.html welcome.html logs.html admins.html settings.html
│   ├── css/app.css
│   └── js/ config.js firebase.js api.js ui.js components.js shell.js pages/*.js
└── backend/
    ├── package.json  .env.example  Dockerfile
    ├── scripts/seed-admin.js
    ├── src/ server.js app.js
    │   ├── config/       env.js firebase.js
    │   ├── middleware/   requireAuth.js validate.js rateLimiter.js errorHandler.js
    │   ├── routes/       bots groups channels verification buttons welcome logs admins settings me dashboard
    │   ├── services/     telegram botService chatService verificationService logService secrets ...
    │   ├── webhooks/     telegram.js
    │   └── utils/        crypto keyboard validators logger redact ...
    └── tests/            unit tests + end-to-end verification flow with a fake Firestore
```

## Firestore data model

| Collection | Doc id | Key fields |
|---|---|---|
| `admins` | Firebase uid | `email`, `role` (`super_admin`/`admin`), `active`, `createdBy`, timestamps |
| `bots` | auto | `name`, `username`, `telegramBotId`, `enabled`, `webhookStatus`, `webhookError`, timestamps (no secrets) |
| `botSecrets` | = bot id | `tokenEnc` (AES-256-GCM). Backend only |
| `groups` | auto | `botId`, `chatId`, `title`, `inviteLink`, `enabled`, `botAccess` |
| `channels` | auto | `botId`, `chatId`, `title`, `username`, `inviteLink`, `enabled`, `botAccess` |
| `verificationSettings` | = group id | `botId`, `groupId`, `enabled`, `requiredChannelIds[]` (channel ids of the same bot), texts, `verifyButtonText`, `cooldownSeconds` |
| `buttons` | auto | `botId`, `placement` (`welcome`/`verification`), `label`, `url`, `row`, `position`, `enabled` |
| `welcomeMessages` | = bot id | `groupWelcome{enabled,text}`, `privateWelcome{enabled,text}` |
| `verificationLogs` | auto | `botId`, `botName`, `groupId`, `userId`, `event`, `status`, `detail`, `missingChannelIds[]`, `createdAt` |
| `pendingRequests` | `groupId_userId` | in-flight join requests: `status` (`pending`/`approved`/`stale`), `attempts`, `lastCheckAt`. Backend only |
| `settings` | `general` | `panelName`, `timezone`, `logRetentionDays` |

`botSecrets` and `pendingRequests` are extra collections beyond the required list: tokens need a place the browser can never read, and the verify button needs to know which request it belongs to.

Validation lives in the backend (`src/utils/validators.js`, zod, strict objects). Firestore rules deny all client writes; the Admin SDK used by the backend bypasses rules.

## Verification workflow and Telegram limits

1. Telegram sends a `chat_join_request` update. The bot looks up the group, stores a pending request and sends the instructions (channel buttons + **Verify**) to `user_chat_id`. Telegram allows this for a limited time after the request even if the user never started the bot.
2. **Fallback** when that message fails (user blocked the bot, time window passed): the failure is logged with a deep link `https://t.me/<bot>?start=v_<groupId>`. The Group Management page has a "Copy link" button for it. Opening it makes the user start the bot, which re-sends the instructions if a request is pending, or shows the group invite link if not.
3. The user joins the channels and presses **Verify** (callback query). Presses are rate limited per request (`cooldownSeconds`).
4. The backend calls `getChatMember` for every required channel. Statuses `creator`, `administrator`, `member` (and `restricted` with `is_member`) count as joined.
5. All joined → `approveChatJoinRequest`. Otherwise the request stays pending and the message is edited to list the missing channels.
6. If a membership lookup itself fails (for example the bot is not an admin of a channel) the bot **fails closed**: nobody is approved and a `config_error` is logged.

### Welcome messages: group vs private

- **Group welcome** is a normal message in the group, posted once after an approval. Telegram cannot show a group message to only one member, so everyone sees it. It is off by default.
- **Private welcome** is a message in the user's private chat with the bot, sent when they press `/start`. It only reaches people who have started the bot.

Both can use buttons from Inline Buttons → "Welcome messages". Text is plain (no Markdown/HTML), so user names can never inject formatting.

## Setup

Requirements: Node.js 20+, a Firebase project, Firebase CLI (`npm i -g firebase-tools`), and a bot token from [@BotFather](https://t.me/BotFather).

### 1. Firebase project

1. Create a project in the Firebase Console.
2. **Authentication** → enable **Email/Password**. Create your admin user (Users → Add user). Because the panel has no sign-up page and the backend only trusts users listed in `admins`, stray sign-ups cannot reach any data.
3. **Firestore** → create a database (production mode).
4. **Project settings → Service accounts** → generate a private key for the backend (keep it out of git).
5. **Project settings → Your apps** → add a Web app and copy its config.

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env
```

Edit `.env`:

- `FIREBASE_PROJECT_ID`
- credentials: either `GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json` or `FIREBASE_SERVICE_ACCOUNT_JSON` (single line)
- `TOKEN_ENCRYPTION_KEY`: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Back it up**: losing it makes stored bot tokens unreadable.
- `PUBLIC_BASE_URL`: public **https** URL of the backend (Telegram requires https for webhooks)
- `CORS_ALLOWED_ORIGINS`: your Firebase Hosting origins, comma separated

Create the first super admin (the user must already exist in Firebase Auth):

```bash
npm run seed-admin -- you@example.com
npm run dev        # or: npm start
```

Local webhooks need a public https URL: run a tunnel (for example `cloudflared tunnel --url http://localhost:8080`) and use its URL as `PUBLIC_BASE_URL`.

### 3. Frontend and Firestore

```bash
cp .firebaserc.example .firebaserc    # set your project id
# edit frontend/js/config.js: firebaseConfig + API_BASE_URL
firebase deploy --only firestore:rules,firestore:indexes
npx http-server frontend -p 5000      # local preview at http://localhost:5000
```

The Firestore indexes take a few minutes to build; the Logs filters work once they finish.

### 4. Telegram side

- **Group**: make it a group/supergroup where join requests are enabled (invite link with "Request Admin Approval", or the group's "Approve new members" setting). Add the bot as **administrator with "Invite users"** permission.
- **Each required channel**: add the bot as administrator so `getChatMember` works.
- Use "Check access" on the Groups and Channels pages to confirm.

## Deployment

**Backend** (any Node host: Cloud Run, Render, Railway, Fly.io, a VPS). A `Dockerfile` is included.

- Set the same variables as `.env` as the host's *secrets* / environment (never commit them). On hosts without files use `FIREBASE_SERVICE_ACCOUNT_JSON`; on Google Cloud the runtime service account works with no key at all.
- Health check path: `/healthz`. Set `TRUST_PROXY=1` behind one proxy.
- Run a single always-on instance or more; the app is stateless (rate-limit counters are per instance).
- After the first deploy, open Bot Management → add the bot → the webhook is registered automatically. Use "Re-sync webhook" if the URL changes.

**Frontend**: `firebase deploy --only hosting`. Then add the Hosting domain to `CORS_ALLOWED_ORIGINS` and redeploy the backend. The CSP in `firebase.json` allows `connect-src https:`; tighten it to your backend origin.

## Security notes

- Every `/api` route: Firebase ID token verification → active `admins` record → role check (`super_admin` for admin management, general settings, log purge). Roles come from Firestore only.
- Bot tokens: encrypted at rest, decrypted only in backend memory, scrubbed from logs and error messages, never returned by the API, never in Firestore documents the browser can read.
- Webhooks: constant-time secret-header check per bot; unknown bot ids and bad secrets get 404/403.
- Rate limiting on `/api` and on webhooks; `helmet`, strict CORS allow-list, 100 KB body limit, generic 500 errors with a request id.
- Frontend builds all DOM with `textContent`, so Telegram-supplied names cannot inject HTML.
- Rotate a leaked token: revoke it in @BotFather, then Bot Management → "Replace token".

## Testing

```bash
cd backend && npm test
```

Runs unit tests (crypto, keyboard builder, membership rules, redaction, input validation) and an end-to-end verification flow against a fake Firestore and fake Telegram client: join request → instructions → missing channel → approval, DM failure fallback, `/start` deep link, cooldown, fail-closed errors, stale requests.

### Manual test with two bots

1. Create two bots in @BotFather (A and B), a test group (join requests on), and two test channels. Add both bots as admins in the group and channels.
2. In the panel add bot A and bot B (tokens are verified with Telegram). Both show "Webhook active".
3. For each bot: Channels → add the two channels; Groups → add the group → "Check access" shows OK; Verification → pick the group, select both channels, enable, save.
   (Two bots can share a group or use different groups; each bot's configuration is separate.)
4. Optional: Inline Buttons → add a "Rules" button under "Verification message"; check the preview. Welcome Messages → enable the group welcome.
5. From a second Telegram account, request to join the group through bot A's group.
   - You should receive the instructions privately with channel buttons and **Verify**.
   - Press Verify without joining: the message lists both channels and the request stays pending.
   - Join one channel and press Verify: only the other one is listed.
   - Join both and press Verify: the request is approved, the message confirms, and (if enabled) the group welcome appears.
6. Fallback test: block the bot, send a new join request, check Logs for `dm_failed`, unblock, open the "DM fallback link" from Groups, and continue.
7. Disable bot A in Bot Management and send a request: nothing happens, and its webhook shows "off". Bot B keeps working.
8. Check Logs (filter by bot, event, user) and the Dashboard counters.

## API summary (all under `/api`, Bearer ID token)

`GET /me` · `GET /dashboard` · `bots` (GET, POST, PATCH /:id, PUT /:id/token, POST /:id/webhook, GET /:id/webhook-info, DELETE /:id) · `groups` and `channels` (GET ?botId, POST, PATCH /:id, POST /:id/check, DELETE /:id) · `verification` (GET ?botId, GET/PUT /:groupId) · `buttons` (GET, GET /preview, POST, PATCH /:id, PUT /layout, DELETE /:id) · `welcome` (GET/PUT /:botId) · `logs` (GET, POST /purge) · `admins` (GET, POST, PATCH /:uid, DELETE /:uid) · `settings/general` (GET, PUT). Webhook: `POST /webhooks/telegram/:botId`.

## Deployment fixes / troubleshooting (project-specific)

- `.firebaserc` is preconfigured for Firebase project `entirebazar-360`.
- Hosting `cleanUrls` is enabled, so both `/dashboard` and `/dashboard.html` can resolve without changing any HTML/CSS or page layout.
- Before deploying, edit `frontend/js/config.js`: replace `FIREBASE_WEB_APP_ID` with the `appId` from a **Web app** registered under Firebase Console → Project settings → Your apps. The Android `google-services.json` appId is not the web appId.
- Replace `https://REPLACE_WITH_YOUR_BACKEND_URL` with the public HTTPS base URL of the deployed Node.js backend, without a trailing slash.
- Set the exact Firebase Hosting origin (for example `https://entirebazar-360.web.app`) in the backend's `CORS_ALLOWED_ORIGINS` and redeploy the backend.
- Then run `firebase deploy --only hosting,firestore:rules,firestore:indexes` from this project folder. Deploy the backend separately on its Node.js host.
- A Firebase Hosting 404 at the site root usually means the wrong URL/project was opened or Hosting was not deployed from this folder. Check `firebase hosting:sites:list` and `firebase deploy --only hosting`.
