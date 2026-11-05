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
- PostgreSQL persistence for providers, memories, suggestions, chat logs and player context.
- One-time import of an existing SQLite database when the configured DB_PATH file is present.
- Fixed commands: `Lumi come here`, `Lumi goto X Y Z`, `Lumi follow me`, `Lumi stop`, `Lumi stay`, `Lumi jump`, `Lumi sneak`.
- Passive by default. No autonomous wandering.
- Web dashboard with live status, movement controls, chat bridge, memory editor and provider settings.
- Prismarine Viewer for the bot's world perspective, reverse-proxied through the dashboard.
- Dashboard chat is separate from AI conversation and listens for incoming Minecraft chat for five minutes after a dashboard message.
- Optional one-time server-plugin authentication after each connection: waits 10 seconds after spawn, then sends `/register`, `/register`, and `/login` with 5-second gaps.

## Requirements

- Node.js 22 or newer.
- A Minecraft Java server compatible with 1.21.11.
- A hosting environment that can keep a Node.js process running.
- One public TCP port allocation.
- A PieGres PostgreSQL database (or another PostgreSQL service).
- One or more API keys for OpenAI-compatible chat-completion endpoints.

## Installation

1. Clone this repository.
2. Install dependencies with `npm install`.
3. Configure environment variables in your host's private environment-variable panel.
4. Set `DATABASE_URL` to the PieGres connection string supplied by PieHost, including `sslmode=require`. Never commit or share it publicly.
5. Generate a 32-byte encryption key and set it as `APP_ENCRYPTION_KEY`:

   ```bash
   openssl rand -hex 32
   ```

6. Build and start Lumi:

   ```bash
   npm run build
   npm start
   ```

PostgreSQL tables are created automatically on startup. Lumi cannot start without DATABASE_URL. Keep DATABASE_URL and APP_ENCRYPTION_KEY stable across restarts and redeployments.

## Minecraft configuration

- `MC_HOST`: Minecraft server address.
- `MC_PORT`: server port.
- `MC_USERNAME`: bot username.
- `MC_AUTH`: `offline` for offline-mode servers or `microsoft` for Microsoft-authenticated accounts.
- `MC_VERSION`: defaults to `1.21.11`.
- `MC_SERVER_PASSWORD`: password used by the server's `/register` and `/login` plugin commands. Store it only in the host's private environment-variable/secrets panel.

Lumi intentionally does not inspect authentication-plugin messages. After the bot spawns, it waits 10 seconds, sends `/register <password>`, waits 5 seconds, sends `/register <password>` again, waits another 5 seconds, then sends `/login <password>`. This sequence runs only once per connection; there are no periodic retries. If Lumi reconnects, a new connection gets one new sequence. Use a dedicated bot account and a unique password.

## Dashboard

Open your configured web address and sign in with `DASHBOARD_USERNAME` and `DASHBOARD_PASSWORD`. The Minecraft bot does not connect automatically when Lumi starts. Use the Overview page's **Start**, **Stop**, and **Rejoin** controls to manage its connection. The dashboard and PostgreSQL-backed settings remain available while the bot is stopped.

The Settings page accepts OpenAI-compatible Chat Completions providers. Enter the provider's base URL, model and API key. The base URL should normally be the API root, for example `https://api.openai.com/v1`; Lumi appends `/chat/completions`. Give primary providers a lower priority number than fallback providers. Add a separate entry for each key or fallback model.

Provider API keys are encrypted in PostgreSQL using AES-256-GCM. Keep `APP_ENCRYPTION_KEY` private and back it up securely. Losing or changing it makes existing stored provider keys unreadable.

## Single-port viewer

Prismarine Viewer runs on an internal-only port configured by `VIEWER_INTERNAL_PORT` (default 3001). The dashboard proxies it through `/viewer/` on the same public web port. Do not allocate a second public port.

## Data and SQLite import

All permanent application data is stored in PieGres PostgreSQL, so it survives PieApp restarts and redeployments. If `DB_PATH` points to an existing old SQLite database on the first start against the new PostgreSQL database, Lumi imports providers, memories, suggestions, chat logs and player context once. The original SQLite file is not deleted. The import is recorded in PostgreSQL and will not be repeated.

Conversation history remains in memory and resets when Lumi restarts. Dashboard chat messages are not added to AI history.

## Notes

- AI provider adapters currently use the OpenAI-compatible Chat Completions request format. Providers that do not support this format need a dedicated adapter.
- Movement is controlled by fixed commands or dashboard controls; AI responses cannot execute actions.
- PieGres credentials and the encryption key must be configured in PieApp environment variables, not in source files.

## License

MIT
