# OpenClaw RingCentral Channel

[![npm version](https://img.shields.io/npm/v/openclaw-ringcentral)](https://www.npmjs.com/package/openclaw-ringcentral)
[![Release](https://github.com/ringclaw/openclaw-ringcentral/actions/workflows/release.yml/badge.svg)](https://github.com/ringclaw/openclaw-ringcentral/actions/workflows/release.yml)
[![CI](https://github.com/ringclaw/openclaw-ringcentral/actions/workflows/ci.yml/badge.svg)](https://github.com/ringclaw/openclaw-ringcentral/actions/workflows/ci.yml)
[![RingCentral Live Smoke](https://github.com/ringclaw/openclaw-ringcentral/actions/workflows/ringcentral-live-smoke.yml/badge.svg)](https://github.com/ringclaw/openclaw-ringcentral/actions/workflows/ringcentral-live-smoke.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=ringclaw_openclaw-ringcentral&metric=alert_status)](https://sonarcloud.io/dashboard?id=ringclaw_openclaw-ringcentral)

RingCentral Team Messaging channel plugin for OpenClaw.

## Install

Install the published plugin package through the OpenClaw plugin manager:

```bash
openclaw plugins install npm:openclaw-ringcentral
openclaw plugins enable ringcentral
openclaw gateway restart
```

The explicit `npm:` source matches OpenClaw's plugin install contract and lets
OpenClaw manage plugin registration, policy updates, and Gateway reloads.
Use `npm install openclaw-ringcentral` only when inspecting the package or doing
manual development outside the OpenClaw plugin manager.

## Features

- Bot Add-in WebSocket ingress and outbound replies
- Optional owner JWT credentials for owner-observed groups, history reads, and fallback sends
- OpenClaw channel ingress policy for DM/group allowlists, pairing, mention gates, and ignored/allowed channels
- Threaded replies with `off`, `first`, and `all` modes
- Thread follow-up detection: once the bot participates in a thread, subsequent messages in that thread can skip the mention requirement (controlled by `threadRequireMention`)
- Inbound file/image attachments are downloaded into OpenClaw managed media storage after admission
- Optional opt-in processing placeholder while an agent run is active
- Shared OpenClaw `message` actions for send/read/edit/delete/channel-info
- Optional `ringcentral_get_recent_messages` agent tool
- Dispatch lifecycle diagnostics (`debugInboundMessages`) for troubleshooting silent message drops

## Configuration

Minimal bot-only config:

```json
{
  "channels": {
    "ringcentral": {
      "enabled": true,
      "botToken": "your-bot-static-token"
    }
  }
}
```

Owner credentials for history/fallback:

```json
{
  "channels": {
    "ringcentral": {
      "enabled": true,
      "botToken": "your-bot-static-token",
      "ownerCredentials": {
        "clientId": "your-client-id",
        "clientSecret": "your-client-secret",
        "jwt": "your-owner-jwt-token"
      }
    }
  },
  "tools": {
    "allow": ["ringcentral_get_recent_messages"]
  }
}
```

`credentials` is still accepted as a deprecated alias for `ownerCredentials`.

Group allowlist with per-group mention gate and thread follow-up:

```json
{
  "channels": {
    "ringcentral": {
      "enabled": true,
      "botToken": "your-bot-static-token",
      "groupPolicy": "allowlist",
      "requireMention": true,
      "threadRequireMention": false,
      "groups": {
        "123456789": {
          "enabled": true,
          "requireMention": true,
          "users": ["sender-id-1", "sender-id-2"]
        }
      }
    }
  }
}
```

When `threadRequireMention` is `false`, replies inside a thread the bot has
already participated in do not need a new mention to activate the bot.
Default is `true` (every message in a thread needs a mention).

Opt in to the processing placeholder (shown while an agent run is active):

```json
{
  "channels": {
    "ringcentral": {
      "processingPlaceholder": {
        "enabled": true,
        "initialText": "👀",
        "delayedText": "⏳",
        "editDelaySeconds": 2
      }
    }
  }
}
```

DM policy and sender allowlist:

```json
{
  "channels": {
    "ringcentral": {
      "dm": {
        "policy": "allowlist",
        "allowFrom": ["sender-id-1"]
      }
    }
  }
}
```

`dm.policy` can be `disabled` (default for group-only deployments), `allowlist`,
`pairing`, or `open`.

## Pair With A Dedicated Agent

Route RingCentral traffic to its own agent instead of the default webchat/TUI
agent. This keeps operator debugging history out of RingCentral conversations
and prevents a global coding `tools.profile` from removing the optional
`ringcentral_*` tools.

```json
{
  "agents": {
    "defaults": {
      "model": "your-default-model"
    },
    "list": [
      { "id": "main", "default": true },
      {
        "id": "ringcentral-bot",
        "tools": {
          "profile": null
        }
      }
    ]
  },
  "bindings": [
    {
      "agentId": "ringcentral-bot",
      "match": {
        "channel": "ringcentral"
      }
    }
  ]
}
```

`tools.profile: null` is intentional: the RingCentral agent should not inherit a
global coding profile that removes channel tools such as
`ringcentral_get_recent_messages`, `ringcentral_create_calendar_event`,
`ringcentral_create_note`, or `ringcentral_create_adaptive_card`.

## Environment

Use `RC_*` variables only. Existing `RINGCENTRAL_*` variables are intentionally ignored.

| Variable | Description |
| --- | --- |
| `RC_BOT_TOKEN` | Bot static token |
| `RC_SERVER_URL` | API server URL, default `https://platform.ringcentral.com` |
| `RC_USER_CLIENT_ID` | Owner REST API app client ID |
| `RC_USER_CLIENT_SECRET` | Owner REST API app client secret |
| `RC_USER_JWT_TOKEN` | Owner JWT token |
| `RC_ALLOWED_USER_EMAILS` | Comma-separated DM/user allowlist aliases |
| `RC_ALLOW_ALL_USERS` | Allow all DM senders |
| `RC_ALLOWED_CHANNELS` | Comma-separated chat IDs allowed for group/channel ingress |
| `RC_IGNORED_CHANNELS` | Comma-separated chat IDs ignored for ingress |
| `RC_REQUIRE_MENTION` | Require mention in groups, default `true` |
| `RC_THREAD_REQUIRE_MENTION` | Require mention in thread follow-ups, default `true` |
| `RC_FREE_RESPONSE_CHANNELS` | Channels that do not require mentions |
| `RC_NO_THREAD_CHANNELS` | Channels where replies must be unthreaded |
| `RC_REPLY_TO_MODE` | `off`, `first`, or `all`; default `first` |
| `RC_PROCESSING_EMOJI_ENABLED` | Enable processing placeholder, default `false` |
| `RC_PROCESSING_EMOJI_EDIT_DELAY_SECONDS` | Delay before placeholder update |
| `RC_DEBUG_INBOUND_MESSAGES` | Log detailed inbound message metadata (postId, parentPostId, threadId), default `false` |
| `RC_ATTACHMENT_DOWNLOAD_ENABLED` | Download admitted inbound attachments, default `true` |
| `RC_ATTACHMENT_MAX_COUNT` | Max attachments per inbound message, default `5` |
| `RC_ATTACHMENT_MAX_BYTES` | Max bytes per downloaded attachment, default `5242880` |
| `RC_HISTORY_MESSAGE_LIMIT` | Default history record count, max `1000` |
| `RC_HOME_CHANNEL` | Default history/home chat ID |
| `RC_HOME_CHANNEL_NAME` | Display name for the home chat |

## Key Options

| Option | Default | Description |
| --- | --- | --- |
| `groupPolicy` | `disabled` | `disabled`, `allowlist`, or `open` |
| `requireMention` | `true` | Require mention in group messages |
| `threadRequireMention` | `true` | Require mention in thread follow-ups (set `false` to allow follow-up replies without mention) |
| `groups.<chatId>.enabled` | `true` | Enable an allowlisted group |
| `groups.<chatId>.requireMention` | inherited | Per-group mention gate |
| `groups.<chatId>.users` | `[]` | Per-group sender allowlist |
| `groups.<chatId>.systemPrompt` | — | Per-group system prompt override |
| `dm.policy` | contextual | Bot-only defaults to `open`; owner credentials default to owner-only `allowlist` unless explicitly configured |
| `dm.allowFrom` | `[]` | Stable sender IDs allowed in DMs |
| `replyToMode` | `first` | Threading behavior for replies (`off`, `first`, `all`) |
| `noThreadChannels` | `[]` | Chat IDs that force unthreaded sends |
| `freeResponseChannels` | `[]` | Chat IDs that do not require mentions |
| `processingPlaceholder.enabled` | `false` | Show emoji placeholder while agent is processing |
| `processingPlaceholder.initialText` | `👀` | Initial placeholder text |
| `processingPlaceholder.delayedText` | `⏳` | Text shown after edit delay |
| `processingPlaceholder.editDelaySeconds` | `2` | Seconds before switching to `delayedText` |
| `attachments.enabled` | `true` | Download admitted RingCentral file/image attachments |
| `attachments.maxCount` | `5` | Max attachments to process per inbound message |
| `attachments.maxBytes` | `5242880` | Max bytes per downloaded attachment |
| `debugInboundMessages` | `false` | Log detailed inbound message metadata (postId, parentPostId, threadId) |
| `allowBots` | `false` | Allow bot-authored inbound messages |
| `botExtensionId` | — | Override bot person ID (auto-detected if omitted) |
| `textChunkLimit` | — | Max text length per message before chunking |
| `historyMessageLimit` | `250` | Default history record count (max `1000`) |
| `homeChannel` | — | Default history/home chat ID |

When owner credentials are configured and no explicit DM allowlist is provided, the effective default is owner-only unless `allowAllUsers` is enabled.

## RingCentral Setup

1. Create a RingCentral Bot Add-in app with Team Messaging and WebSocket Subscriptions permissions.
2. Copy the bot static token into `botToken` or `RC_BOT_TOKEN`.
3. Optionally create a JWT REST API app for the owner user with Team Messaging, WebSocket Subscriptions, Read Accounts, and Read Messages permissions.
4. Put owner app credentials in `ownerCredentials` or `RC_USER_*`.

## Agent Actions

The shared OpenClaw `message` tool exposes these RingCentral actions when configured:

| Action | Description |
| --- | --- |
| `send` | Send a message |
| `read` | Read recent messages |
| `edit` | Edit a message |
| `delete` | Delete a message |
| `channel-info` | Read chat metadata |

The optional `ringcentral_get_recent_messages` tool reads recent messages through owner credentials. Enable it explicitly with `tools.allow`.

## Verification

```bash
pnpm test
pnpm typecheck
```

## Release

Stable releases are published by pushing a `v*` tag. The release workflow
validates that the tag matches `package.json`, runs typecheck and tests,
publishes `openclaw-ringcentral` to npmjs with `NPM_TOKEN`, and creates a GitHub
Release.

Pushes to `main` also keep publishing beta builds to GitHub Packages through
`publish-beta.yml`; those beta packages are separate from the stable npmjs
release.

## Live Smoke Test

The GitHub Actions workflow `RingCentral Live Smoke` validates the real RingCentral API path without starting OpenClaw and without any LLM secrets.

Configure the GitHub Environment `ringcentral-live` with these secrets:

| Secret | Description |
| --- | --- |
| `RC_BOT_TOKEN` | Bot static token used to send and delete the test message |
| `RC_USER_CLIENT_ID` | Owner JWT app client ID |
| `RC_USER_CLIENT_SECRET` | Owner JWT app client secret |
| `RC_USER_JWT_TOKEN` | Owner JWT token used to read recent history |
| `RC_E2E_CHAT_ID` | Test chat/group ID |
| `RC_SERVER_URL` | Optional API server URL, default `https://platform.ringcentral.com` |

The workflow runs on PRs and `main`, and can also be run manually from GitHub
Actions. It sends unique test messages, validates bot/owner reads, WebSocket
receive, threaded replies, artifact APIs, and file/image upload handling. Test
messages are retained by default for channel auditability; set `cleanup=true`
for manual runs when cleanup is desired. File/image upload smoke is enabled by
default and can be disabled manually with `file_upload=false`.

Local live verification is also available:

```bash
RC_E2E_ENABLED=true \
RC_BOT_TOKEN=... \
RC_USER_CLIENT_ID=... \
RC_USER_CLIENT_SECRET=... \
RC_USER_JWT_TOKEN=... \
RC_E2E_CHAT_ID=... \
pnpm test:live:ringcentral
```

## License

MIT
