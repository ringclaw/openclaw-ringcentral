# OpenClaw RingCentral Channel

RingCentral Team Messaging channel plugin for OpenClaw. Enables bidirectional messaging with AI assistants through RingCentral Team Messaging.

## Features

- WebSocket-based real-time messaging (no public webhook required)
- Bot Add-in support with static token authentication
- Optional Private App for reading chat history and cross-chat actions
- Typing indicators
- Agent actions: tasks, notes, events, adaptive cards CRUD
- Group chat support with @mention gating
- Markdown to RingCentral Mini-Markdown conversion

## Architecture

| Client | Auth | Role |
|--------|------|------|
| **Bot Add-in** (required) | Static token | WebSocket monitoring, sending messages, replying |
| **Private App** (optional) | JWT | Reading chat history, cross-chat actions (notes/events/cards) |

The bot client handles all inbound/outbound messaging. The private app client is used when the bot lacks permissions (e.g., reading private chats for summarization, creating resources in chats where the bot isn't a member).

## Prerequisites

1. A RingCentral account with Team Messaging enabled
2. A RingCentral Bot Add-in app (get static token from Developer Portal)
3. (Optional) A RingCentral REST API App for Private App credentials

## Installation

```bash
openclaw plugins install openclaw-ringcentral
```

## Configuration

### Minimal (Bot only)

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

### With Private App (for chat summarization and cross-chat actions)

```json
{
  "channels": {
    "ringcentral": {
      "enabled": true,
      "botToken": "your-bot-static-token",
      "credentials": {
        "clientId": "your-client-id",
        "clientSecret": "your-client-secret",
        "jwt": "your-jwt-token"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RINGCENTRAL_BOT_TOKEN` | Yes | Bot static token |
| `RINGCENTRAL_CLIENT_ID` | No | Private App client ID |
| `RINGCENTRAL_CLIENT_SECRET` | No | Private App client secret |
| `RINGCENTRAL_JWT` | No | Private App JWT token |
| `RINGCENTRAL_SERVER` | No | API server URL (default: `https://platform.ringcentral.com`) |

### All Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable the RingCentral channel |
| `botToken` | string | - | Bot static token (required) |
| `credentials.clientId` | string | - | Private App client ID |
| `credentials.clientSecret` | string | - | Private App client secret |
| `credentials.jwt` | string | - | Private App JWT token |
| `server` | string | `https://platform.ringcentral.com` | API server URL |
| `botExtensionId` | string | auto-detected | Bot extension ID for @mention detection |
| `selfOnly` | boolean | `true` | Only respond in DMs with the bot |
| `groupPolicy` | string | `"disabled"` | Group policy: `disabled`, `allowlist`, `open` |
| `groups.<id>.enabled` | boolean | `true` | Enable specific group |
| `groups.<id>.requireMention` | boolean | inherited | Require @mention in this group |
| `groups.<id>.systemPrompt` | string | - | Custom system prompt for this group |
| `groups.<id>.users` | array | - | Allowed user IDs in this group |
| `requireMention` | boolean | `true` | Global default: require @mention in groups |
| `dm.policy` | string | `"open"` | DM policy: `disabled`, `allowlist`, `pairing`, `open` |
| `dm.allowFrom` | array | - | User IDs allowed to DM |
| `textChunkLimit` | number | `4000` | Max characters per message chunk |
| `allowBots` | boolean | `false` | Allow messages from other bots |
| `actions.messages` | boolean | `true` | Allow agent to read/edit/delete messages |
| `actions.channelInfo` | boolean | `true` | Allow agent to get chat info |
| `actions.tasks` | boolean | `true` | Allow agent to manage tasks |
| `actions.events` | boolean | `true` | Allow agent to manage events |
| `actions.notes` | boolean | `true` | Allow agent to manage notes |

## RingCentral App Setup

### Bot Add-in (Required)

1. Go to [RingCentral Developer Portal](https://developers.ringcentral.com/)
2. Create a **Bot Add-in** app
3. Add permissions: **Team Messaging**, **WebSocket Subscriptions**
4. Copy the bot's static token

### Private App (Optional)

1. Create a **REST API App** with JWT auth flow
2. Add permissions: **Team Messaging**, **WebSocket Subscriptions**, **Read Accounts**, **Read Messages**
3. Generate a JWT token for your user

## Agent Actions

The plugin provides agent tools for RingCentral resource management:

| Action | Description |
|--------|-------------|
| `send-message` | Send a message to a chat |
| `read-messages` | Read message history |
| `edit-message` | Edit an existing message |
| `delete-message` | Delete a message |
| `channel-info` | Get chat/channel information |
| `list-tasks` / `create-task` / `update-task` / `complete-task` / `delete-task` | Task management |
| `list-events` / `create-event` / `update-event` / `delete-event` | Calendar event management |
| `list-notes` / `create-note` / `update-note` / `delete-note` / `publish-note` | Note management |

Actions use the Private App client when available (for cross-chat access), falling back to the Bot client.

## Usage

1. Start the OpenClaw gateway:

```bash
openclaw gateway run
```

2. Message the bot in RingCentral — the AI will respond!

## Troubleshooting

### Bot not responding

- Verify `botToken` is correct
- Check that the bot has **Team Messaging** and **WebSocket Subscriptions** permissions
- Check gateway logs: `openclaw gateway logs`

### Actions failing with 404

- The bot can only access chats it's a member of
- For cross-chat actions, configure Private App credentials

### Rate limit errors

RingCentral has API rate limits. If you see "Request rate exceeded", wait a minute before retrying.

## License

MIT
