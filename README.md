# CueRoom

**Real-time, collaborative setlist planning for DJs.**

[Live application](https://cueroom-harry-2026.app.space) · [Technical specification](SPEC.md) · [Development task tracker](TASKS.md)

CueRoom is a full-stack web application for planning DJ sets with other people. Instead of circulating different versions of a track list, collaborators can work in one authenticated room, update the running order, and review tempo, key, and energy information as the set develops.

Built as a focused DeepSpace full-stack engineering exercise in November 2026.

## Features

- **Shared setlist rooms:** Create a room and invite other signed-in users with a shareable invitation link.
- **Collaborative editing:** Authorized members can add, edit, delete, and reorder tracks. Room and track subscriptions update the workspace as records change.
- **Persistent running order:** Track order is stored on the room record and reconstructed from current track records when snapshots arrive separately.
- **Musical metadata:** Record the title, artist, BPM, musical key, and energy level (1–5) for each track.
- **Set insights:** View track counts, tempo information, an energy progression chart, and adjacent-track BPM/key comparisons.
- **Free transition preview:** Receive deterministic, BPM-based guidance for an adjacent pair of tracks without calling a paid AI provider.
- **Access controls:** Room reads are scoped to membership, and writes go through authenticated server actions. Nonmembers cannot directly edit another room's tracks.

CueRoom is a **planning tool**, not a music player or DJ performance engine. It does not stream or analyze audio.

## How to use it

1. Open the [live app](https://cueroom-harry-2026.app.space) and sign in.
2. Select **Create room** on the dashboard.
3. Add tracks and optionally supply BPM, key, and energy information.
4. Reorder tracks and use the set insights panel to review your running order.
5. Share the room's invitation link with another user. After they sign in and accept the invitation, both of you can edit the same setlist.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS |
| Application server | Hono on Cloudflare Workers |
| Platform | DeepSpace SDK 0.44.2 |
| Authentication | DeepSpace authentication with verified server-side identity |
| Persistent records | DeepSpace RecordRoom, backed by SQLite Durable Object storage |
| Real-time updates | RecordRoom subscriptions |
| Validation | Server-side validation and Zod where applicable |
| Testing | Vitest, Playwright, and multi-Worker capacity fixtures |

### Data model and application flow

CueRoom's primary RecordRoom collections are:

| Collection | Purpose |
| --- | --- |
| `rooms` | Room ID, owner, name, invite token, and canonical `trackOrder` |
| `tracks` | Track metadata, room association, allocation slot, and creation marker |
| `team_members` | Active user membership in each room |

The browser subscribes to authorized room and track data. Mutations are sent to named server actions, which validate the authenticated user, membership, and requested fields before updating RecordRoom. The UI recalculates its displayed order from the stored `trackOrder` and the live track inventory.

The main application paths are `/` (landing), `/home` (dashboard), and `/rooms/:roomId` (setlist editor).

## Engineering decisions

### Authorization first

The client is not allowed to choose its own authenticated identity or write directly to the three CueRoom collections. Server actions validate active room membership and check that any referenced track belongs to the target room. Invitation joining requires a valid room-specific token; repeat joins are handled without intentionally creating duplicate memberships.

Generic integration-execution routes are disabled so that ordinary app users cannot invoke arbitrary provider operations through the Worker.

### Track capacity and concurrent writes

Each room supports up to **200 live tracks**. Because requests can run on different Worker instances, a simple “count before insert” check would not reliably enforce the ceiling. CueRoom uses immutable allocation slots with a SQLite unique index and storage-level validation in its shared RecordRoom Durable Object.

Actions also use readback and bounded reconciliation when record writes or responses are ambiguous. Reordering rejects stale or incomplete track permutations. Since the SDK does not expose a single transaction for separate room and track updates, certain cross-Worker ordering races remain a documented limitation rather than a claimed atomic guarantee.

### Reliable real-time rendering

Room and track subscriptions can deliver updates at different times. The editor builds its visible setlist from both snapshots, skipping deleted or duplicated IDs and appending any otherwise unlisted live tracks in a deterministic order. The goal is to recover to a consistent view without treating an intermediate subscription snapshot as authoritative.

## Optional integrations and current limitations

The repository contains **nonbillable foundations** for invitation emails and AI-generated transition advice, including authorization, transport boundaries, and quota logic. **Neither paid integration is enabled in the deployed application.** They should not be described as working email delivery or live AI generation.

The deployment runs on a free DeepSpace tier. Its optional D1 binding was removed because that tier does not support the required custom D1 resource. With that binding absent, integration preferences read as disabled and changes to them are unavailable. Shareable room invitations and the free deterministic transition preview do not require D1.

Before activating either paid feature, the provider response contract, cost ceiling, owner billing identity, and quota behavior would require verification and separate review.

Other known limitations:

- Distributed, simultaneous reorders are not globally transactional.
- The free advisor uses supplied track metadata; it does not perform audio analysis or automatically edit the setlist.
- Development regression tests passed before the final free-tier deployment adjustment, but an authenticated production end-to-end regression was **not** completed after that adjustment.

## Run locally

**Requirements:** Node.js 24, npm 11.6 or later, and an authenticated DeepSpace developer CLI session. The application is configured for DeepSpace SDK 0.44.2.

```bash
git clone https://github.com/ItsHarrySu/CueRoom.git
cd CueRoom
npm ci
npx deepspace auth login
npm run dev
```

Follow the local URL shown by the development server. Some authenticated flows require a correctly configured DeepSpace application and test accounts.

### Useful commands

```bash
npm run type-check     # TypeScript validation
npm run lint           # ESLint
npm run build          # Production frontend build
npm run test:unit      # Vitest unit tests
npm run test:capacity  # Shared RecordRoom / multi-Worker capacity checks
npm test -- all        # DeepSpace test suite, including authenticated browser tests when configured
npm run deploy         # Deploy to the configured DeepSpace app
```

**Deployment note:** `wrangler.toml` contains the registered CueRoom app identity. Do not deploy a fork against that ID; initialize a new DeepSpace app identity for your own deployment. Keep credentials in local, ignored configuration or supported platform secrets, never in source control.

## Project organization

- `src/pages/` and `src/cueroom/`: routes, setlist UI, collaboration views, and musical insights.
- `src/actions/cueroom/`: authenticated room, track, and transition actions.
- `src/server/`: Worker routing, RecordRoom implementation, authorization, and disabled integration foundations.
- `src/schemas/`: record schemas and collection permissions.
- `tests/`: browser regression and shared-Worker capacity scenarios.
- `SPEC.md`: detailed data contracts, authorization rules, and acceptance criteria.
- `CR-013-verification.md`: production release verification checklist.

## What I'd improve next

1. Run complete, authenticated end-to-end checks against the deployed app, including two-user collaboration and third-user access denial.
2. Add revision-aware ordering or conditional writes to reduce distributed reorder conflicts.
3. Verify the provider contracts and billing guarantees before selectively enabling email or AI generation.
4. Add DJ-focused improvements such as importing and exporting setlists, collaborator comments, and richer harmonic transition analysis.

## Development approach

CueRoom was developed with AI-assisted implementation organized into small tasks and pull requests, with separate planning, backend, frontend, and security review workstreams. Independent reviews and authenticated Windows regression tests informed changes before the nonbillable integration foundations were merged. The release was then adapted to the DeepSpace free tier by removing the unsupported optional D1 binding.

The focus was a useful, reviewable collaborative application with explicit security boundaries and documented tradeoffs, rather than a large number of unfinished integrations.
