# Cleo

Cleo is a WhatsApp campaign assistant: the Publicist and Strategist for **Aliu Johnson Temitope**, candidate for President of the Patrician Set of 2012, St. Patrick's College, Iwaro-Oka. She answers voters' questions in the Set's WhatsApp group using only the candidate knowledge base.

## Behaviour

- **Groups:** Cleo replies only when her name appears in the message ("Cleo, ...") or someone tags her number. Everything else is ignored. Replies quote the voter's message.
- **Private chats:** Cleo replies to every message.
- **Greetings:** "Hi / Hello / Hey / Good morning" (with her name or tag in a group) gets a fixed welcome card: "Hey <name>", her name, role and what she can do. No AI call.
- **Memory:** the last 20 messages (voter + Cleo) are kept per voter per chat and sent to the AI as context. Stored in `data/cleo-sessions.json`.
- **AI:** Groq (`openai/gpt-oss-120b`) first; if it is not configured or fails (error, timeout, empty answer), NVIDIA (`meta/muse-glimmer-30b`) answers instead.
- **Knowledge:** `artifacts/api-server/knowledge/candidate-knowledge-base.md`. Edit it and restart to change what Cleo knows.

## Run & Operate

- `pnpm install --frozen-lockfile`
- Set secrets `GROQ_API_KEY` and `NVIDIA_API_KEY` (see `.env.example`).
- In Replit run the workflows `artifacts/api-server: API Server` and `artifacts/cleo-dashboard: web`.
- Open the dashboard at `/`, then in WhatsApp: **Linked devices > Link a device** and scan the QR code. The same QR is also printed in the API logs.
- Health check: `/api/healthz`. Status: `/api/cleo/status`.
- Try Cleo without WhatsApp: `curl -X POST localhost:8080/api/cleo/preview -H 'content-type: application/json' -d '{"name":"Tunde","text":"Hello Cleo"}'`
- `pnpm run typecheck`, `pnpm run build`

## Where things live (artifacts/api-server/src)

- `cleo/whatsapp.ts` Baileys connection, QR pairing, group mention rules
- `cleo/chatHandler.ts` greeting vs AI routing, one message at a time per voter
- `cleo/triggers.ts` name/tag stripping and greeting detection
- `cleo/persona.ts` greeting card and Cleo's system prompt
- `cleo/aiHandler.ts` Groq then NVIDIA, WhatsApp formatting
- `cleo/sessionStore.ts` 20-message memory, JSON file
- `routes/cleo.ts` status, pairing reset, preview

## Railway

- The root `Dockerfile` builds the dashboard and API together; `railway.toml` starts the API and checks `/api/healthz`.
- Attach a persistent volume at `/data` so the WhatsApp login and chat memory survive restarts.
- Add `GROQ_API_KEY` and `NVIDIA_API_KEY` as service variables. Replit Secrets are not copied to Railway.
- Railway's `railway.toml` config-as-code is documented as deprecated and expected to stop working on December 1, 2026; migrate before then.

## Gotchas

- The dashboard and its endpoints have no sign-in. Anyone who can open the URL can see the pairing QR and reset the pairing. Keep the URL private or add access control before sharing it.
- Never commit `data/` (WhatsApp login and voter chat history) or `.env`; both are git-ignored.
- Only one deployment should use the paired number at a time, or WhatsApp will keep replacing the connection.
