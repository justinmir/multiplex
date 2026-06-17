# Multiplex

![License: MIT](https://img.shields.io/badge/license-MIT-66800B?style=flat)
![Built with opencode](https://img.shields.io/badge/built%20with-opencode-205EA6?style=flat)

Multiplex is a desktop app for running [opencode](https://opencode.ai) agents across your projects. The point isn't really the individual agent runs, though — it's everything you build up *around* a project so each run starts with more context than the last.

A project in Multiplex is a place to collect the things that matter: notes, references, decisions, open questions, and the diffs and PRs your agents produce. Multiplex feeds that growing pile back into every agent run. Instead of re-explaining your codebase and your intent in a fresh chat each time, you build the context once and the agent reads it on every run.

![Project view](docs/screenshots/project.png)

![Session view](docs/screenshots/session.png)

## What it's for

Most agent tools treat every chat as a blank slate. Multiplex treats the *project* as the durable thing and the chats as disposable:

- Keep **notes** — design decisions, runbooks, the stuff you'd otherwise paste into a prompt over and over. The agent reads them on every run, and can write them too.
- Add **references** — issues, docs, links. They're fetched and indexed once so the agent works from their actual contents, not just a title.
- Every **session** keeps its full transcript, the diffs it produced, and the PRs it opened — so the project's history of changes lives in one place.
- A synthesis pass turns all of that into a living **summary and next steps**, which you can steer ("focus on what's blocking the cutover").

The more you put into a project, the better-grounded each run is. That's the whole loop.

## Running it

You'll need Node 22 (there's an `.nvmrc`) and [opencode](https://opencode.ai) installed — it's the agent backend. Multiplex looks for it at `~/.opencode/bin/opencode`, or you can point `OPENCODE_BIN` at it. A GitHub token is optional and only needed for live PR detail.

```bash
npm install
npm start        # run in dev, with hot reload
npm run compile  # build a packaged desktop app
```

## Notes

- Everything stays local — a JSON file by default, or SQLite if you set `MULTIPLEX_DB=sqlite`. Your GitHub token never leaves the main process.
- Connect GitHub in Settings for live PR files, reviews, and checks in the session side rail; open PRs refresh in the background.
- Set `MULTIPLEX_SEED=1` to populate a fresh store with demo data.
- It's a TypeScript monorepo: `core` (shared types + the IPC contract), `main` (Electron, the agent runtime, storage), `preload` (the bridge), and `renderer` (the React UI).

## License

MIT
