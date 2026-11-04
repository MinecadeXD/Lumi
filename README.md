# Lumi

A female AI Minecraft companion with a shared server conversation, fixed movement commands, permanent memory suggestions and a remote web dashboard.

## Features

- Minecraft Java 1.21.11 bot powered by Mineflayer.
- One shared server-wide AI conversation. Player names are included in context.
- Ten most recent messages are supplied to the AI.
- Mention Lumi to start a conversation; all players can continue it for three minutes after the latest message.
- Multiple OpenAI-compatible AI endpoints, multiple keys and ordered fallback.
- Provider API keys encrypted at rest with AES-256-GCM.
- AI-generated memory suggestions require dashboard approval before becoming permanent.
- SQLite storage for providers, memories, player context and chat logs.
- Fixed commands: \`Lumi come here\`, \`Lumi goto X Y Z\`, \`Lumi follow me\`, \`Lumi stop\`, \`Lumi stay\`, \`Lumi jump\`, \`Lumi sneak\`.
- Passive by default. No autonomous wandering.
- Web dashboard with live status, movement controls, chat bridge, memory editor and provider settings.
- Prismarine Viewer for the bot's world perspective, reverse-proxied through the dashboard.
- Dashboard chat is separate from AI conversation and listens for incoming Minecraft chat for five minutes after a dashboard message.

## Requirements

- Node.js 22 or newer.
- A Minecraft Java server compatible with 1.21.11.
- A hosting environment that can keep a Node.js process running.
- One public TCP port allocation.
- One or more API keys for OpenAI-compatible chat-completion endpoints.

## Installation

1. Clone this repository.
2. Install dependencies:

   \`\`\`bash
   npm install
   \`\`\`

3. Copy \`.env.example\` to \`.env\`.
4. Set your Minecraft server details and dashboard credentials.
5. Generate a 32-byte encryption key and put its 64-character hexadecimal output in \`APP_ENCRYPTION_KEY\`:

   \`\`\`bash
   openssl rand -hex 32
   \`\`\`

6. Start Lumi:

   \`\`\`bash
   npm run build
   npm start
   \`\`\`

For development, use \`npm run dev\`.

## Minecraft configuration

- \`MC_HOST\`: Minecraft server address.
- \`MC_PORT\`: server port.
- \`MC_USERNAME\`: bot username.
- \`MC_AUTH\`: \`offline\` for offline-mode servers or \`microsoft\` for Microsoft-authenticated accounts.
- \`MC_VERSION\`: defaults to \`1.21.11\`.

Use a dedicated Minecraft account for Lumi. Do not put a Microsoft password in the repository.

## Dashboard

Open \`http://YOUR_HOST:3000\` (or your configured web port) and sign in with \`DASHBOARD_USERNAME\` and \`DASHBOARD_PASSWORD\`.

The Settings page accepts OpenAI-compatible chat completion providers. Enter the provider's base URL, model and API key. The base URL should normally be the API root, for example \`https://api.openai.com/v1\`; Lumi appends \`/chat/completions\`. Give primary providers a lower priority number than fallback providers. Add a separate entry for each key or fallback model.

Keys are encrypted in SQLite. Keep \`APP_ENCRYPTION_KEY\` private and back it up securely; losing it makes stored provider keys unreadable.

## Viewer port

Prismarine Viewer runs on \`VIEWER_PORT\` (default 3001). The dashboard embeds this port directly. Configure your hosting firewall to expose it only where appropriate. The viewer port is separate from the authenticated dashboard, so do not expose it publicly unless you are comfortable with that access.

## Data

SQLite data is stored at \`DB_PATH\` (default \`./data/lumi.sqlite\`). Back up the database and encryption key together.

## Notes

- AI provider adapters currently use the OpenAI-compatible Chat Completions request format. Providers that do not support this format need a dedicated adapter.
- Conversation history is held in memory and resets when Lumi restarts. Approved permanent memories persist in SQLite.
- Dashboard chat messages are not added to AI history.
- Movement is controlled by fixed commands or dashboard controls; AI responses cannot execute actions.

## License

MIT
