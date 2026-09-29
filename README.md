# System Design Lab

Learn system design by building architectures, sending traffic through them, breaking them and fixing them.

## Run it

```bash
npm install
npm run dev          # web app + API server together
```

Open http://localhost:5173.

- `npm run dev:web` runs only the web app. Everything except accounts, classrooms and the AI tutor works without the server.
- `npm run server` runs only the API server (port 8787). Data is stored in `server/data/lab.db`.
- `npm test` runs the simulator, mission, scoring and share-link tests.

### AI tutor

The tutor calls Claude (`claude-3-5-sonnet-20241022`) from the server, so the key never reaches the browser:

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run dev
```

Students must be signed in to use it, and each account is limited to 10 questions per minute. The server-side refusal fallback (`fallbacks: "default"`) is enabled.

## What's inside

| Area                                                                                    | Where                      |
| --------------------------------------------------------------------------------------- | -------------------------- |
| Deterministic simulator (routing, caching, replicas, queues, retries, circuit breakers) | `src/engine/simulator.ts`  |
| Mission validation, scoring, rule-based review                                          | `src/engine/`              |
| Missions (16, Beginner to Senior) with sample solutions                                 | `src/data/challenges.ts`   |
| Component lessons                                                                       | `src/data/technologies.ts` |
| App state (undo/redo, predictions, achievements, sync)                                  | `src/store/store.ts`       |
| API: accounts, progress, designs, classrooms, tutor                                     | `server/index.mjs`         |

Designs can be shared as links (`#d=…`). The whole design is encoded in the URL, so no server is needed to open one.
