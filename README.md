# OpenClaw RingCentral Channel

[![npm version](https://img.shields.io/npm/v/openclaw-ringcentral)](https://www.npmjs.com/package/openclaw-ringcentral)
[![CI](https://github.com/ringclaw/openclaw-ringcentral/actions/workflows/ci.yml/badge.svg)](https://github.com/ringclaw/openclaw-ringcentral/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=ringclaw_openclaw-ringcentral&metric=alert_status)](https://sonarcloud.io/dashboard?id=ringclaw_openclaw-ringcentral)

RingCentral Team Messaging channel plugin for OpenClaw.

## Overview

Use this plugin when you want an OpenClaw agent to receive and send RingCentral
Team Messaging conversations through a RingCentral Bot Add-in.

It supports:

- Direct messages with `pairing`, `allowlist`, `open`, or `disabled` policy.
- RingCentral `Team` and `Everyone` chats as channel surfaces.
- RingCentral `Group` conversations as group DMs, disabled by default and enabled only by explicit allowlist.
- Threaded replies, mention gates, per-chat user allowlists, and per-chat system prompts.
- Inbound file/image attachment download into OpenClaw managed media storage.
- Shared OpenClaw `message` actions for send/read/edit/delete/channel-info.
- Optional `ringcentral_get_recent_messages`, Adaptive Card, note, and calendar event tools.

RingCentral `Team` chats are topic-oriented chats, while `Group` conversations
are member-set conversations. See the RingCentral Team Messaging
[Teams documentation](https://developers.ringcentral.com/guide/team-messaging/concepts/teams)
for the platform model this plugin follows.

## Human Install

### 1. Install The Plugin

Install through the OpenClaw plugin manager:

```bash
openclaw plugins install npm:openclaw-ringcentral
openclaw plugins enable ringcentral
openclaw gateway restart
```

Use `npm install openclaw-ringcentral` only for package inspection or local
plugin development. Normal OpenClaw installs should go through the plugin
manager so OpenClaw can register the channel, tool contracts, and hook metadata.

### 2. Create A RingCentral Bot

Create a RingCentral Bot Add-in app with Team Messaging and WebSocket
Subscriptions permissions, then copy the bot static token.

Optional owner credentials are only needed for owner-backed operations such as
recent message history and Home-confirmed note/calendar writes. If you need
those flows, create a JWT REST API app for the owner user with Team Messaging,
WebSocket Subscriptions, Read Accounts, and Read Messages permissions.

### 3. Configure The Channel

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

The same bot token can also be supplied as `RC_BOT_TOKEN`.

### 4. Route RingCentral To An Agent

Use a dedicated agent for RingCentral traffic. This keeps RingCentral
conversation state separate from webchat/TUI debugging and avoids global coding
tool profiles hiding optional `ringcentral_*` tools.

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

Set `tools.allow` only for optional tools you want the RingCentral agent to use.

## AI-Assisted Install

When installing this plugin for a user, use this checklist:

1. Inspect the existing OpenClaw config for `channels.ringcentral`, existing
   `agents`, and existing `bindings`.
2. Install and enable the plugin through OpenClaw's plugin manager, not by
   manually editing package files.
3. Ask for or provision the RingCentral bot static token, then set
   `channels.ringcentral.botToken` or `RC_BOT_TOKEN`.
4. Write canonical config under `channels.ringcentral`. Do not add legacy
   fields such as `allowedChannels`, `allowedUserEmails`, or `groups`.
5. Prefer stable RingCentral person IDs for DM allowlists and explicit chat IDs
   for Team/Group allowlists.
6. Add a dedicated `ringcentral-bot` agent and channel binding unless the user
   already has a clear RingCentral-specific agent.
7. Enable optional `ringcentral_*` tools only when requested. Keep
   `tools.profile: null` on the RingCentral agent if the user's global profile
   would hide channel tools.
8. For artifact tools in RingCentral Teams or Group DMs, ensure the target chat
   is explicitly allowlisted with `teams.<chatId>.allow=true` or
   `dm.groupChannels.<chatId>.allow=true`.
9. Restart the OpenClaw gateway and verify the bot can receive one admitted
   message and send one reply.

Example AI-generated config patch:

```json
{
  "channels": {
    "ringcentral": {
      "enabled": true,
      "botToken": "your-bot-static-token",
      "dmPolicy": "pairing",
      "groupPolicy": "allowlist",
      "teams": {
        "123456789": {
          "allow": true,
          "requireMention": true
        }
      }
    }
  },
  "agents": {
    "list": [
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

## Configuration Recipes

### Bot-Only Default

This is enough for paired DMs and bot-authenticated sends:

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

### DM Allowlist

```json
{
  "channels": {
    "ringcentral": {
      "enabled": true,
      "botToken": "your-bot-static-token",
      "dmPolicy": "allowlist",
      "allowFrom": ["sender-person-id"]
    }
  }
}
```

`dmPolicy` defaults to `pairing`. `dmPolicy: "open"` requires
`allowFrom: ["*"]`. `allowFrom` matches stable RingCentral person IDs by
default. Email matching is disabled unless `dangerouslyAllowEmailMatching: true`
is set.

### Team Allowlist

```json
{
  "channels": {
    "ringcentral": {
      "enabled": true,
      "botToken": "your-bot-static-token",
      "groupPolicy": "allowlist",
      "teams": {
        "*": {
          "requireMention": true
        },
        "123456789": {
          "allow": true,
          "requireMention": true,
          "users": ["sender-person-id"],
          "systemPrompt": "Answer as the RingCentral support bot."
        }
      }
    }
  }
}
```

`teams."*"` is only a default entry. It can provide settings such as
`requireMention`, but it does not allow every Team and does not authorize the
artifact bot-token path.

### Group DM Allowlist

RingCentral `Group` conversations are ignored by default. Enable only explicit
group DMs:

```json
{
  "channels": {
    "ringcentral": {
      "enabled": true,
      "botToken": "your-bot-static-token",
      "dm": {
        "groupEnabled": true,
        "groupChannels": {
          "987654321": {
            "allow": true,
            "requireMention": false,
            "users": ["sender-person-id"]
          }
        }
      }
    }
  }
}
```

### Threads And Replies

```json
{
  "channels": {
    "ringcentral": {
      "replyToMode": "first",
      "threadRequireMention": false,
      "noThreadChannels": ["123456789"]
    }
  }
}
```

`replyToMode` can be `off`, `first`, or `all`. When
`threadRequireMention=false`, replies inside a thread where the bot already
participated can activate the bot without a new mention.

### Attachments And Processing Placeholder

```json
{
  "channels": {
    "ringcentral": {
      "attachments": {
        "enabled": true,
        "maxCount": 5,
        "maxBytes": 5242880
      },
      "processingPlaceholder": {
        "enabled": true,
        "initialText": "Working...",
        "delayedText": "Still working...",
        "editDelaySeconds": 2
      }
    }
  }
}
```

### Artifact Tools

Enable only the artifact tools your RingCentral agent should use:

```json
{
  "tools": {
    "allow": [
      "ringcentral_create_adaptive_card",
      "ringcentral_create_note",
      "ringcentral_create_calendar_event"
    ]
  }
}
```

Artifact target resolution order is:

1. Explicit `chat_id`, `chatId`, or `target`.
2. Current RingCentral Team/Group chat injected by the plugin's
   `before_tool_call` hook.
3. `homeChannel` or `RC_HOME_CHANNEL`.

If the resolved chat is explicitly allowlisted with
`teams.<chatId>.allow=true` or `dm.groupChannels.<chatId>.allow=true`, Adaptive
Card, note, and calendar event artifact tools use the bot token directly. Bot
token failures are returned directly and do not fall back to owner credentials.

For object-ID tools such as `ringcentral_get_note`,
`ringcentral_update_note`, `ringcentral_get_calendar_event`, and
`ringcentral_delete_adaptive_card`, `chat_id` is only the authorization context.
The RingCentral API still operates on the object ID.

When OpenClaw supplies agent-scoped config to a channel tool, artifact tools
fall back to the plugin runtime's full OpenClaw config before reading
`RC_TEAMS` or `RC_GROUP_DM_CHANNELS`. Normal JSON config under
`channels.ringcentral` therefore remains authoritative for artifact allowlists.

### Owner Credentials And Home Confirmation

```json
{
  "channels": {
    "ringcentral": {
      "enabled": true,
      "botToken": "your-bot-static-token",
      "homeChannel": "home-chat-id",
      "homeChannelName": "RingCentral Home",
      "ownerCredentials": {
        "clientId": "owner-app-client-id",
        "clientSecret": "owner-app-client-secret",
        "jwt": "owner-jwt-token"
      }
    }
  },
  "tools": {
    "allow": ["ringcentral_get_recent_messages"]
  }
}
```

`homeChannel` is the default chat for history/artifact tools when neither an
explicit target nor a current RingCentral Team/Group target is available. For
non-allowlisted targets, owner-backed note and calendar writes keep the Home
confirmation flow through `ringcentral_confirm_artifact_action`. Owner-backed
reads outside Home are rejected. Adaptive Card tools are bot-token tools and
require Home or an allowlisted target.

`credentials` is still accepted as a deprecated alias for `ownerCredentials`,
but new configs should use `ownerCredentials`.

## Targets And Tools

### Canonical Targets

| Target | Description |
| --- | --- |
| `user:<personId>` | Create/find a DM with that RingCentral person, then send |
| `team:<chatId>` | Send to a RingCentral Team chat |
| `channel:<chatId>` | Send to a RingCentral Everyone/channel chat |
| `group:<chatId>` | Send to an explicitly configured RingCentral Group conversation |

Legacy `ringcentral:*`, `rc:*`, and bare numeric targets are rejected with a
migration error.

### Shared Message Actions

The shared OpenClaw `message` tool exposes these RingCentral actions when the
channel is configured:

| Action | Description |
| --- | --- |
| `send` | Send a message |
| `read` | Read recent messages |
| `edit` | Edit a message |
| `delete` | Delete a message |
| `channel-info` | Read chat metadata |

### Optional RingCentral Tools

| Tool family | Tool names |
| --- | --- |
| History | `ringcentral_get_recent_messages` |
| Adaptive Cards | `ringcentral_create_adaptive_card`, `ringcentral_get_adaptive_card`, `ringcentral_update_adaptive_card`, `ringcentral_delete_adaptive_card` |
| Notes | `ringcentral_list_notes`, `ringcentral_create_note`, `ringcentral_get_note`, `ringcentral_update_note`, `ringcentral_delete_note`, `ringcentral_publish_note` |
| Calendar Events | `ringcentral_list_calendar_events`, `ringcentral_create_calendar_event`, `ringcentral_get_calendar_event`, `ringcentral_update_calendar_event`, `ringcentral_delete_calendar_event` |
| Confirmation | `ringcentral_confirm_artifact_action` |

## Reference

### Environment Variables

Use `RC_*` variables only. Existing `RINGCENTRAL_*` variables are intentionally
ignored.

| Variable | Description |
| --- | --- |
| `RC_BOT_TOKEN` | Bot static token |
| `RC_SERVER_URL` | API server URL, default `https://platform.ringcentral.com` |
| `RC_USER_CLIENT_ID` | Owner REST API app client ID |
| `RC_USER_CLIENT_SECRET` | Owner REST API app client secret |
| `RC_USER_JWT_TOKEN` | Owner JWT token |
| `RC_DM_POLICY` | `disabled`, `allowlist`, `pairing`, or `open`; default `pairing` |
| `RC_ALLOW_FROM` | Comma-separated stable person IDs allowed for DMs |
| `RC_GROUP_POLICY` | Team/Everyone policy: `disabled`, `allowlist`, or `open`; default `disabled` |
| `RC_TEAMS` | JSON object of Team configurations keyed by chat ID |
| `RC_TEAM_REQUIRE_MENTION` | Wildcard Team mention default |
| `RC_GROUP_DM_ENABLED` | Enable explicitly configured RingCentral Group DM conversations |
| `RC_GROUP_DM_CHANNELS` | JSON object of Group DM configurations keyed by chat ID |
| `RC_REQUIRE_MENTION` | Global Team/Everyone mention override |
| `RC_THREAD_REQUIRE_MENTION` | Require mention in thread follow-ups, default `true` |
| `RC_NO_THREAD_CHANNELS` | Channels where replies must be unthreaded |
| `RC_REPLY_TO_MODE` | `off`, `first`, or `all`; default `first` |
| `RC_PROCESSING_EMOJI_ENABLED` | Enable processing placeholder, default `false` |
| `RC_PROCESSING_EMOJI_EDIT_DELAY_SECONDS` | Delay before placeholder update |
| `RC_DEBUG_INBOUND_MESSAGES` | Log inbound message metadata, default `false` |
| `RC_ATTACHMENT_DOWNLOAD_ENABLED` | Download admitted inbound attachments, default `true` |
| `RC_ATTACHMENT_MAX_COUNT` | Max attachments per inbound message, default `5` |
| `RC_ATTACHMENT_MAX_BYTES` | Max bytes per downloaded attachment, default `5242880` |
| `RC_HISTORY_MESSAGE_LIMIT` | Default history record count, max `1000` |
| `RC_HOME_CHANNEL` | Default Home chat for history/artifact tools and owner confirmations |
| `RC_HOME_CHANNEL_NAME` | Display name for the Home chat |

### Key Options

| Option | Default | Description |
| --- | --- | --- |
| `dmPolicy` | `pairing` | Direct message handling: `disabled`, `allowlist`, `pairing`, or `open` |
| `allowFrom` | `[]` | Stable RingCentral person IDs allowed in DMs |
| `dangerouslyAllowEmailMatching` | `false` | Match `allowFrom` against email aliases |
| `groupPolicy` | `disabled` | Team/Everyone handling: `disabled`, `allowlist`, or `open` |
| `teams.<chatId>.allow` | `true` when present | Enable an explicit Team/Everyone chat |
| `teams."*"` | none | Defaults only; not an allowlist entry |
| `dm.groupEnabled` | `false` | Enable explicit RingCentral Group DM conversations |
| `dm.groupChannels.<chatId>.allow` | `true` when present | Enable an explicit group DM |
| `requireMention` | `true` | Global Team/Everyone mention gate |
| `threadRequireMention` | `true` | Require mention in thread follow-ups |
| `replyToMode` | `first` | Threading behavior for replies: `off`, `first`, or `all` |
| `attachments.enabled` | `true` | Download admitted RingCentral file/image attachments |
| `processingPlaceholder.enabled` | `false` | Show a placeholder while the agent is processing |
| `debugInboundMessages` | `false` | Log inbound message metadata for troubleshooting |
| `allowBots` | `false` | Allow bot-authored inbound messages |
| `botExtensionId` | auto-detected | Bot person ID for mention detection |
| `historyMessageLimit` | `250` | Default history record count, max `1000` |
| `homeChannel` | none | Default Home chat for history/artifact tools and owner confirmations |

### Legacy Migration Errors

These old access-control fields are rejected:

| Old | New |
| --- | --- |
| `allowedUserEmails` | `allowFrom` with stable person IDs |
| `allowAllUsers` | `dmPolicy: "open"` plus `allowFrom: ["*"]` |
| `allowedChannels` | `teams` |
| `ignoredChannels` | omit the chat or set `teams.<id>.allow=false` |
| `freeResponseChannels` | `teams.<id>.requireMention=false` |
| `groups` | `teams` or `dm.groupChannels`, depending on RingCentral chat type |
| `dm.policy` | `dmPolicy` |
| `dm.allowFrom` | `allowFrom` |

The corresponding legacy env vars (`RC_ALLOWED_USER_EMAILS`,
`RC_ALLOW_ALL_USERS`, `RC_ALLOWED_CHANNELS`, `RC_IGNORED_CHANNELS`, and
`RC_FREE_RESPONSE_CHANNELS`) are rejected with migration guidance.

### Local Verification

```bash
git diff --check
node -e 'JSON.parse(require("fs").readFileSync("openclaw.plugin.json","utf8"))'
pnpm test src/artifact-tools.test.ts --run
pnpm typecheck
pnpm build
```

## License

MIT
