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
- Fixed commands: `Lumi come here`, `Lumi goto X Y Z`, `Lumi follow me`, `Lumi stop`, `Lumi stay`, `Lumi jump`, `Lumi sneak`.
- Passive by default. No autonomous wandering.
- Web dashboard with live status, movement controls, chat bridge, memory editor and provider settings.
- Prismarine Viewer for the bot's world perspective, reverse-proxied through the dashboard.
- Dashboard chat is separate from AI conversation and listens for incoming Minecraft chat for five minutes after a dashboard message.
- Optional automatic server-plugin authentication: repeats `/register`, `/register`, then `/login` on a configurable interval.

## Requirements

- Node.js 22 or newer.
- A Minecraft Java server compatible with 1.21.11.
- A hosting environment that can keep a Node.js process running.
- One public TCP port allocation.
- One or more API keys for OpenAI-compatible chat-completion endpoints.

## Installation

1. Clone this repository.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env`.
4. Set your Minecraft server details, dashboard credentials and (if the server requires it) `MC_SERVER_PASSWORD`.
5. Generate a 32-byte encryption key and put its 64-character hexadecimal output in `APP_ENCRYPTION_KEY`:

   ```bash
   openssl rand -hex 32
   ```

6. Build and start Lumi:

   ```bash
   npm run build
   npm start
   ```

For development, use `npm run dev`.

## Minecraft configuration

- `MC_HOST`: Minecraft server address.
- `MC_PORT`: server port.
- `MC_USERNAME`: bot username.
- `MC_AUTH`: `offline` for offline-mode servers or `microsoft` for Microsoft-authenticated accounts.
- `MC_VERSION`: defaults to `1.21.11`.
- `MC_SERVER_PASSWORD`: password used by the server's `/register` and `/login` plugin commands. Store it only in the host's private environment-variable/secrets panel; never commit the real value.
- `MC_AUTH_RETRY_INTERVAL`: interval in milliseconds between authentication command sequences. Defaults to 45000 (45 seconds). Keep it below 60000. Each sequence sends `/register <password>`, waits 1.5 seconds, sends `/register <password>` again, waits 1.5 seconds, then sends `/login <password>`.

Lumi intentionally does not inspect authentication-plugin messages. It sends the full command sequence repeatedly, so the plugin may reply that the account is already registered or logged in. Use a dedicated bot account and a unique password.

## Dashboard

Open `http://YOUR_HOST:16855` (or your configured web port) and sign in with `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD`.

The Settings page accepts OpenAI-compatible chat completion providers. Enter the provider's base URL, model and API key. The base URL should normally be the API root, for example `https://api.openai.com/v1`; Lumi appends `/chat/completions`. Give primary providers a lower priority number than fallback providers. Add a separate entry for each key or fallback model.

Keys are encrypted in SQLite. Keep `APP_ENCRYPTION_KEY` private and back it up securely; losing it makes stored provider keys unreadable.

## Single-port viewer

Prismarine Viewer runs on an internal-only port configured by `VIEWER_INTERNAL_PORT` (default 3001). The dashboard proxies it through `/viewer/` on the same public web port. Do not allocate a second public port.

## Data

SQLite data is stored at `DB_PATH` (default `./data/lumi.sqlite`). Back up the database and encryption key together.

## Notes

- AI provider adapters currently use the OpenAI-compatible Chat Completions request format. Providers that do not support this format need a dedicated adapter.
- Conversation history is held in memory and resets when Lumi restarts. Approved permanent memories persist in SQLite.
- Dashboard chat messages are not added to AI history.
- Movement is controlled by fixed commands or dashboard controls; AI responses cannot execute actions.

## License

MIT
