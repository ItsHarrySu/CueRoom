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
| CR-009 Multi-user authorization and integration tests | Unassigned | Pending | CR-005 through CR-008 for full scenarios | — | — |
| CR-010 Deployment, production verification and submission | Unassigned | Pending | CR-003, CR-009 | — | — |

## CR-004 review notes

The corrected schemas deny wildcard and viewer access. Members have team reads on rooms and tracks, and admins may read both collections. All client roles are denied membership reads and direct writes on all three collections. In SDK 0.44.2, both the per-record membership lookup and the team list query read `c_team_members` directly, independently of client permissions on that collection.

Plans approved the v1 creator invariant in SPEC.md. Room creators receive active membership during creation, and track creators must already be active members. V1 has no membership removal or deactivation operation. External membership removal leaves the SDK creator read grant in effect.

CR-005 owns server-side authorization for room creation and invitation joining, write ordering and recovery after partial failure, membership uniqueness, duplicate joins, and explicit validation of active status.

Future authenticated actions must set the room envelope ID equal to `roomId`, validate `trackOrder` as a string array, and write only the literal `active` for membership status. JSON and select interpretations do not enforce those value constraints. The SDK also counts a stored null status as membership. Required columns are checked on create, so actions must preserve required values on updates. Optional track columns accept null without additional configuration.

Local tests exercised SDK permission predicates and schema lint. The cloud CLI reported `not_authenticated`. Live reads, lists, subscriptions, direct-write denial and persisted membership uniqueness still need authenticated integration coverage.

## CR-006 review notes

SDK 0.44.2 merges a partial update with the current record inside RecordRoom. Track edits submit only supplied fields and order writes submit only trackOrder. Track creation omits recordId because a supplied key is an upsert. Internally the SDK also uses putRecord for its generated timestamp/random ID, so absolute collision exclusion would require a create-only primitive.

Track actions reject overlapping requests for the same room in one Worker isolate. Across isolates, capacity checks, record writes and order updates are separate operations with no transaction or compare-and-swap in ActionTools. Adds recheck capacity and attempt to remove their own acknowledged row on observed overflow. Order repair reloads live IDs and stored order after a write and retries once. Ambiguous creates can repair order but cannot safely identify a row to undo or return. Refresh before retrying an unconfirmed add because replay can create a duplicate.

CR-008 must account for intervening or late writes after verification, including concurrent reorders. Strict distributed capacity, atomic order changes and crash recovery remain open. CR-009 should exercise these paths and authorization on a live RecordRoom.

## CR-008 review notes

Reorder shares the existing isolate-local guard with add, edit and delete. It checks the submitted permutation against a complete room-scoped track query, writes only trackOrder, then rereads live IDs and the room. A changed live set triggers bounded reconciliation from fresh state and rejects the move. A different stored order triggers rejection without replaying the submitted order. Readback can confirm a write whose acknowledgement was lost.

SDK 0.44.2 ActionTools sends each operation to RecordRoom separately and exposes no transaction or conditional update. Across isolates a write can intervene between checks or after readback. A stale order over the same live IDs is indistinguishable from an intentional move under this contract. Confirmation describes the observed state. It cannot establish a globally last accepted reorder.

The editor subscribes to rooms and tracks by roomId. RecordRoom checks socket identity and schema read permissions for changes, and the SDK reissues active queries on reconnect. Each render recomputes order from both snapshots, skipping duplicates and deleted IDs and appending omitted live IDs in ordinal order. Snapshots can arrive separately. Reorder uses connection readiness, renders subscribed data throughout submission, and resubscribes after the response. The SDK may display its prior snapshot while the fresh query is in flight.

The Playwright scenario in tests/collab.spec.ts exercises add, edit, delete, keyboard reorder and persistence with two independent authenticated browsers. Run it locally with two usable DeepSpace test accounts. This workspace had zero usable accounts. Live collaboration and third-user denial remain pending CR-009 verification.
