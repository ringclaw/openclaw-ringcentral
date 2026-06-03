# OpenClaw RingCentral Channel

RingCentral Team Messaging channel plugin for OpenClaw.

## Features

- Bot Add-in WebSocket ingress and outbound replies
- Optional owner JWT credentials for owner-observed groups, history reads, and fallback sends
- OpenClaw channel ingress policy for DM/group allowlists, pairing, mention gates, and ignored/allowed channels
- Threaded replies with `off`, `first`, and `all` modes
- Optional processing placeholder while an agent run is active
- Shared OpenClaw `message` actions for send/read/edit/delete/channel-info
- Optional `ringcentral_get_recent_messages` agent tool

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

`credentials` is still accepted as a deprecated config alias for `ownerCredentials`.

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
| `RC_FREE_RESPONSE_CHANNELS` | Channels that do not require mentions |
| `RC_THREAD_REQUIRE_MENTION` | Require mention in thread follow-ups, default `true` |
| `RC_NO_THREAD_CHANNELS` | Channels where replies must be unthreaded |
| `RC_REPLY_TO_MODE` | `off`, `first`, or `all`; default `first` |
| `RC_PROCESSING_EMOJI_ENABLED` | Enable processing placeholder, default `true` |
| `RC_PROCESSING_EMOJI_EDIT_DELAY_SECONDS` | Delay before placeholder update |
| `RC_HISTORY_MESSAGE_LIMIT` | Default history record count, max `1000` |
| `RC_HOME_CHANNEL` | Default history/home chat ID |
| `RC_HOME_CHANNEL_NAME` | Display name for the home chat |

## Key Options

| Option | Default | Description |
| --- | --- | --- |
| `groupPolicy` | `disabled` | `disabled`, `allowlist`, or `open` |
| `groups.<chatId>.enabled` | `true` | Enable an allowlisted group |
| `groups.<chatId>.requireMention` | inherited | Per-group mention gate |
| `groups.<chatId>.users` | `[]` | Per-group sender allowlist |
| `dm.policy` | `open` | `disabled`, `allowlist`, `pairing`, or `open` |
| `dm.allowFrom` | `[]` | Stable sender IDs allowed in DMs |
| `replyToMode` | `first` | Threading behavior for replies |
| `noThreadChannels` | `[]` | Chat IDs that force unthreaded sends |
| `allowBots` | `false` | Allow bot-authored inbound messages |

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

## License

MIT
