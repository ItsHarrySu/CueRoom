# AGENTS.md

Read <https://docs.deep.space/llms.txt>, then fetch the relevant documentation
page as Markdown by appending `.md`. The installed package types and CLI
`--help` describe the exact version in this project. Use your existing HTTP,
shell, and browser tools; no skill, plugin, connector, or session restart is
required. Installing the optional skill is a separate explicit choice.

## About this project

This is a **DeepSpace** app — a real-time collaborative app built on the
[`deepspace`](https://www.npmjs.com/package/deepspace) SDK and deployed to
Cloudflare Workers via `npx deepspace deploy`.

## Version control

The app's **cloud repo** on the DeepSpace platform is the default version
control; no external account is needed. The first DeepSpace push/pull/deploy
command installs its Git remote as `space`. **Don't set up GitHub (or another
git host) unless the developer explicitly asks.** With the default DeepSpace
source, commit before you deploy: the release records that commit and refuses
a dirty worktree. When the app ships from GitHub (latched from the checkout's
remote at the app's first release, permanently), deploy instead ships the
current checkout, including dirty or unpushed bytes, and records no commit
lineage for that release; use ordinary Git to decide what should be committed
and pushed. For parallel DeepSpace-source work: `workspace new -t "<task>"` →
commit → `workspace sync` → `workspace land`. Use `status`, `activity`,
`releases`, and `rollback` to recover context and inspect what is live.

## Project commands

```sh
npx deepspace auth login   # authenticate with app.space
npx deepspace dev start    # local dev server (vite + miniflare)
npx deepspace deploy       # deploy to <app>.app.space
npx deepspace push         # sync code to the app's cloud repo
npx deepspace agent tools <app> --json # discover tools and their input schemas
npx deepspace agent invoke <app> <tool> --input-file tool-input.json --json
npx deepspace add --list   # list optional features (messaging, etc.)
npx deepspace add <feature>
```

`worker.ts` already exposes the tools from `src/ai/tools.ts` over HTTP, MCP and
browser tools; add tools there instead of registering the routes again. For
local app tools, always run `agent tools` first and follow the returned
description and input schema rather than guessing arguments. `agent invoke`
reuses the current CLI login and requires no separate connection. If it reports
`not_authenticated`, run the refusal's action when present. In a
headless shell without an action, run `npx deepspace auth login --help` and use
the operator-supplied credential path it names; never invent credentials or put
a password on the command line.

## CueRoom Project Rules

- Read SPEC.md and TASKS.md before implementation. Work within the assigned task boundaries and avoid duplicating another task's work.
- Obtain approval from the Lead Architect (Plans chat) before changing shared contracts.
- Keep dependencies and features within scope. Preserve SDK authentication, permissions, and worker plumbing.
- Never expose or commit credentials.
- Use task branches and descriptive commits. GitHub is the intended project source.
- Deployment, pushing to DeepSpace source, and new app registration each require an explicitly authorized task.
- Run appropriate verification commands. Report modified files, actual test results, architectural concerns, and blockers at the end of each task. Code written is evidence of implementation only. Claim verification only for checks actually performed.
