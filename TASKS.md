# CueRoom task tracker

Plans is the Lead Architect. Dependencies below are planning prerequisites. Plans may authorize independent work in parallel. A dash means no evidence or blocker recorded.

| ID and task | Owner | Status | Dependencies | Evidence | Blockers |
| --- | --- | --- | --- | --- | --- |
| CR-001 DeepSpace bootstrap | Unrecorded | Complete | None | Plans approved scaffold commit `16f5652` | — |
| CR-002 Canonical specifications | Codex | Complete | CR-001 | Plans approved the specifications merged in PR #2 | — |
| CR-003 App registration and build verification | Unrecorded | Complete | CR-002 | Registration commit `6a41340`. Plans confirmed local TypeScript, production build, unit tests and lint passed. | — |
| CR-004 Data schema and permission foundations | Codex | Complete | CR-002, CR-003 | Three collections registered. TypeScript, production build, 31 unit tests and lint passed. SDK schema lint returned zero warnings. | Approved and merged. Authenticated integration tests pending. |
| CR-005 Room creation and invitation joining | Codex | Complete, pending live integration verification | CR-004 | Authenticated room actions and focused unit tests | Live multi-user verification pending. |
| CR-006 Track CRUD and validation | Codex | Complete, pending live integration verification | CR-004, CR-005 | Authenticated actions and mocked RecordRoom tests | Live integration verification pending. |
| CR-007 Frontend dashboard and setlist editor | Codex | Implemented, pending Plans review | CR-002, CR-005, CR-006 | Public landing, authenticated room dashboard, invitation handling and track editor | Live multi-user verification pending. |
| CR-008 Data subscriptions and collaborative ordering | Codex | Awaiting Plans review | CR-004, CR-006, CR-007 | Verified reorder action, editor controls, unit coverage and two-session Playwright scenario | Authenticated browser run pending |
| CR-009 Multi-user authorization and integration tests | Codex | Awaiting authenticated run and Plans review | CR-005 through CR-008 | Three-account suite and local results below | Backend security review pending |
| CR-010 Premium visual and UX redesign | Codex | Merged via #11 | CR-009 | Landing, workspace and setlist editor redesign | — |
| CR-011 Advanced setlist features | Unassigned | Deferred until after CR-012 and submission gates | CR-010 | — | — |
| CR-012 Selective integration and polish | Codex | A in progress; paid execution awaiting catalog and independent reviews (#16) | CR-010 | — | — |
| CR-013 Production deployment and verification | Unassigned | Pending | CR-012 | — | Backend security sign-off pending |
| CR-014 Assessment submission | Unassigned | Pending | CR-013 | — | — |

## CR-004 review notes

The corrected schemas deny wildcard and viewer access. Members have team reads on rooms and tracks, and admins may read both collections. All client roles are denied membership reads and direct writes on all three collections. In SDK 0.44.2, both the per-record membership lookup and the team list query read `c_team_members` directly, independently of client permissions on that collection.

Plans approved the v1 creator invariant in SPEC.md. Room creators receive active membership during creation, and track creators must already be active members. V1 has no membership removal or deactivation operation. External membership removal leaves the SDK creator read grant in effect.

CR-005 owns server-side authorization for room creation and invitation joining, write ordering and recovery after partial failure, membership uniqueness, duplicate joins, and explicit validation of active status.

Future authenticated actions must set the room envelope ID equal to `roomId`, validate `trackOrder` as a string array, and write only the literal `active` for membership status. JSON and select interpretations do not enforce those value constraints. The SDK also counts a stored null status as membership. Required columns are checked on create, so actions must preserve required values on updates. Optional track columns accept null without additional configuration.

Local tests exercised SDK permission predicates and schema lint. The cloud CLI reported `not_authenticated`. Live reads, lists, subscriptions, direct-write denial and persisted membership uniqueness still need authenticated integration coverage.

## CR-006 review notes (historical, capacity superseded by SEC-002)

SDK 0.44.2 merges a partial update with the current record inside RecordRoom. Track edits submit only supplied fields and order writes submit only trackOrder. Track creation omits recordId because a supplied key is an upsert. Internally the SDK also uses putRecord for its generated timestamp/random ID, so absolute collision exclusion would require a create-only primitive.

Track actions reject overlapping requests for the same room in one Worker isolate. Across isolates, capacity checks, record writes and order updates are separate operations with no transaction or compare-and-swap in ActionTools. Adds recheck capacity and attempt to remove their own acknowledged row on observed overflow. Order repair reloads live IDs and stored order after a write and retries once. Ambiguous creates can repair order but cannot safely identify a row to undo or return. Refresh before retrying an unconfirmed add because replay can create a duplicate.

CR-008 must account for intervening or late writes after verification, including concurrent reorders. Strict distributed capacity, atomic order changes and crash recovery remain open. CR-009 should exercise these paths and authorization on a live RecordRoom.

## CR-008 review notes

Reorder shares the existing isolate-local guard with add, edit and delete. It checks the submitted permutation against a complete room-scoped track query, writes only trackOrder, then rereads live IDs and the room. A changed live set triggers bounded reconciliation from fresh state and rejects the move. A different stored order triggers rejection without replaying the submitted order. Readback can confirm a write whose acknowledgement was lost.

SDK 0.44.2 ActionTools sends each operation to RecordRoom separately and exposes no transaction or conditional update. Across isolates a write can intervene between checks or after readback. A stale order over the same live IDs is indistinguishable from an intentional move under this contract. Confirmation describes the observed state. It cannot establish a globally last accepted reorder.

The editor subscribes to rooms and tracks by roomId. RecordRoom checks socket identity and schema read permissions for changes, and the SDK reissues active queries on reconnect. Each render recomputes order from both snapshots, skipping duplicates and deleted IDs and appending omitted live IDs in ordinal order. Snapshots can arrive separately. Reorder uses connection readiness, renders subscribed data throughout submission, and resubscribes after the response. The SDK may display its prior snapshot while the fresh query is in flight.

The Playwright scenario in tests/collab.spec.ts exercises add, edit, delete, keyboard reorder and persistence with two independent authenticated browsers. Run it locally with two usable DeepSpace test accounts. This workspace had zero usable accounts. Live collaboration and third-user denial remain pending CR-009 verification.

## CR-009 verification

Baseline `origin/main` was `fc97a9737938929c064ddfd6616e1bf61a495cb5`. Git confirmed CR-008 `073640165e9caa437ec81e2c791713185aa7ef22` is an ancestor. The lockfile installed DeepSpace 0.44.2. The changes affect tests and this task record.

| Cloud check | Executed | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Unit tests | 138 | 138 | 0 | 0 |
| Playwright with local Vite and Chromium, diagnostic run | 8 | 7 | 1 | 9 |
| SDK full suite | 0 | 0 | 0 | 0 |

Type-check, build and lint passed. The SDK full-suite command stopped at CLI authentication before discovery. The standard Playwright server readiness check also timed out on `/api/auth/ok`. For the diagnostic run a temporary config used the local Vite root for readiness and retained the app, worker, assertions and zero retries. Six smoke cases and the API navigation case passed. The auth proxy check failed because the worker lacked a usable auth binding. The API navigation assertion only observes a mounted shell. A separate four-case static run passed and overlaps the diagnostic run. The SDK reported zero locally usable accounts. Playwright skipped four collaboration-file cases and five authorization/integrity cases.

The three-account scenario covers both members performing every track operation, repeat invitation acceptance, a stored membership count, peer updates, socket loss and reconnect, and reload. The security tests compare restricted subscriptions with an owner read, exercise the existing-room actions, and require confirmed SDK direct writes to reject. Independent readback uses read-only Node SQLite access to the local Miniflare AppRecordRoom, including the real membership row ID. This fixture depends on the repository's current Wrangler state layout.

Existing unit tests exercised SDK permission rules, action validation, duplicate joins, competing additions at capacity, stale permutations, failed acknowledgements and bounded reconciliation. The browser tests add persisted-state checks for the 200-track boundary and overlapping actions. A same-isolate guard rejects overlap. Separate isolates can still interleave across checks and writes. A reorder over the same set of IDs carries no version. The authenticated cases have yet to demonstrate live isolation, durable order, or recovery from disconnect. No reproducible application P0 was identified. Plans and Backend review remain pending, including acceptance of the cross-isolate limitations before production.

### Windows PowerShell verification

Use PowerShell 7.1 or later, Node 24 and npm 11.6 or later. From the repository directory, prepare the branch and authenticate the developer CLI.

```powershell
git fetch origin
git switch codex/CR-009-integration-security
npm ci
npx playwright install chromium
npx deepspace auth login
npx deepspace test accounts list
npx deepspace test accounts recover --all
```

If the pool has fewer than three usable accounts, create the missing accounts. The example creates three new ordinary test users. Use only the missing letters when topping up a pool. Enter a password of at least eight characters at each masked prompt.

```powershell
$pool = [guid]::NewGuid().ToString('N')
foreach ($role in 'a','b','c') {
  $email = "cr009-$pool-$role@deepspace.test"
  Read-Host "Password for $email" -MaskInput | npx deepspace test accounts create --email $email --name "CR009-$role" --password-stdin
  if ($LASTEXITCODE -ne 0) { throw "Account creation failed for $role" }
}
```

Run the checks below. The SDK fixtures select the oldest usable accounts, so use a developer pool whose first three users are distinct ordinary members. The role that can read all rooms is unsuitable for C. The SDK stores the account registry and cached sessions in the developer profile. The tests create disposable rooms and tracks in local Wrangler state.

```powershell
node --input-type=module -e "import {loadAllTestAccounts as pool} from 'deepspace/testing'; console.log(pool().length); if(pool().length < 3) process.exit(1)"
npm run type-check
npm run build
npm run test:unit
npm run lint
npm test -- all
```

Record the Playwright pass, fail and skip totals with the commit SHA for Plans. The full suite uses `all` because the default SDK command selects smoke and API specs.

## SEC-002 review

The shared SQLite RecordRoom enforces the 200-track ceiling. Cold initialization uses the SDK readiness request under the Durable Object event barrier, then a synchronous transaction verifies the composite index, migrates legacy rows, and installs insert/update guards. Migration preserves IDs, timestamps, and canonical order. Invalid data or an invalid physical index stops initialization. The SDK raw SQL debug API is disabled.

Local verification covers type-check, production build, lint, unit tests, and the authenticated workerd suite in `npm run test:capacity`. Three independent Worker instances share one SDK 0.44.2 RecordRoom. Coverage includes legacy migration, rejected initialization, a cold restart, last-slot competition, immutable-marker collisions, acknowledgement loss, deletion and reuse, membership checks, subscription visibility, and interleaved order changes. The multi-account browser suite requires a DeepSpace CLI login and could not start in this workspace. Independent Backend and Plans review and release approval remain pending.

## CR-012 A manual verification and billing approval

1. On the pinned CLI, capture the read-only OpenAI catalog entry including model, price, request limits and response envelope. Record evidence in issue #16. Resolve any differences with Plans.
2. Plans and Backend/Security each record their decision on the issue. Review the constant endpoint, app authentication, maximum cost, transactional quota and ambiguous-delivery behavior. The preview branch has no provider transport.
3. In a follow-up reviewed change, test the verified provider envelope with fixtures, including malformed output and zero upstream calls on denial. Race the quota across Workers. Confirm per-room and app spending limits.
4. For a live check, give the owner the target room, exact metadata scope, model, maximum charge and one-attempt limit. Record explicit approval for that attempt. Require manual confirmation against the unchanged setlist, show the result as text, and record the observed charge. An ambiguous timeout consumes the attempt; another request requires new approval.

## CR-012 B email contract review

Workstream B starts at the PR #17 merge, `239a523`. Implementation awaits the sender decision and catalog evidence required by issue #16.

| Question | Evidence from installed deepspace@0.44.2 |
| --- | --- |
| Endpoint and sender | The bundled changelog (0.43.0) names `email/send` and specifies `DeepSpace Apps <notifications@updates.app.space>`. It says the platform ignores a supplied `from` and refuses From, Sender and Return-Path headers. This conflicts with issue #16's required app-specific address. |
| Catalog and payload | Read-only CLI commands `integrations info email/send --json`, `integrations list --json` and the companion OpenAI lookup returned `catalog_unavailable`. Direct catalog and documentation requests were denied by the environment proxy. Request fields, acknowledgment envelope and current price remain unverified. |
| Identity and charges | The installed CLI invoke code uses a logged-in bearer and obtains price from the catalog. This describes interactive invocation only. CueRoom has no email billing entry. Production server credentials, billing principal and per-send maximum need authoritative confirmation. |

Plans decision requested on issue #16: accept the platform sender and amend the requirement, or supply a verified app-specific sender contract. Capture the read-only catalog result and confirm server authentication with Backend/Security before implementing delivery. Copy invitation remains available while this is pending.

Proposed review criteria for delivery:

- Accept a room ID and one recipient. Verify the authenticated caller owns the exact room and has one active membership. Construct the URL from trusted app configuration and the stored invite token, and keep the existing sign-in and token-verified join.
- Atomically reserve app, owner and room limits in durable storage before dispatch. Bind a deduplication key to each confirmation. A fresh room must not reset the app or owner limit. Fail closed on reservation errors and retain the reservation after ambiguous delivery.
- Use one constant provider endpoint behind a dedicated server action. Keep SEC-001's generic execution denial. Return safe status messages, omit tokens and addresses from logs, and avoid automatic retries on timeout.
- Test with a mock provider and a real durable-storage concurrency check. Obtain independent Plans and Backend/Security approval for any developer-billed transport and explicit owner approval for a live delivery.
