# DiskPilot — agent instructions

## Product
Local-first Windows disk space diagnosis: pick a folder path, scan via WizTree (or local analysis where supported), classify usage, show mild/medium/strong cleanup plans, export Chinese Markdown reports. Suggestions only — never delete or migrate files automatically.

## Stack
- Node.js >= 20, no heavy framework (see `package.json`)
- Server: `src/server.js`, analyzer: `src/analyzer.js`, WizTree: `src/wiztree.js`
- UI: `public/index.html`, `public/app.js`, `public/style.css`
- Desktop bridge (Windows): `scripts/desktop.js`, `native/DiskPilotBridge.cs`
- Tests: `npm test` (`node --test`)

## Commands
- `npm start` — local web server (manual path entry)
- `npm run desktop` — Windows desktop helper + web (requires .NET Framework)
- `npm test` — unit tests

## Roles (Codex custom agents in `.codex/agents/`)
| Agent | Job |
| --- | --- |
| `product` | Roadmap, acceptance criteria, privacy/scope |
| `user` | End-user critique and scenarios (read-only) |
| `ui` | Web UI/UX and Chinese copy |
| `tester` | Tests and fixtures |
| Orchestrator (human + Grok Bot driving Codex) | Decide priorities, spawn the right agents, review diffs, push |

When asked to improve the product, prefer: `user` critique → `product` backlog → `ui`/`tester`/`worker` implement → `tester` verify.

## Boundaries
- No network upload of scan data; no analytics SDKs
- Do not bundle WizTree binaries
- Do not execute deletes/migrations
- Keep `.env` and secrets out of git
- Folder picker is Windows-only; on Linux tests may fail that case — skip or guard, do not fake Windows APIs

## Git
Private repo: `https://github.com/xpeng5278-web/diskpilot`. Prefer small commits with clear Chinese or English messages. Never force-push `main` without asking.
