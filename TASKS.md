# CueRoom task tracker

Plans is the Lead Architect. Dependencies below are planning prerequisites. Plans may authorize independent work in parallel. A dash means no evidence or blocker recorded.

| ID and task | Owner | Status | Dependencies | Evidence | Blockers |
| --- | --- | --- | --- | --- | --- |
| CR-001 DeepSpace bootstrap | Unrecorded | Complete | None | Plans approved scaffold commit `16f5652` | — |
| CR-002 Canonical specifications | Codex | Complete | CR-001 | Plans approved the specifications merged in PR #2 | — |
| CR-003 App registration and build verification | Unrecorded | Complete | CR-002 | Registration commit `6a41340`. Plans confirmed local TypeScript, production build, unit tests and lint passed. | — |
| CR-004 Data schema and permission foundations | Codex | In progress pending Plans review | CR-002, CR-003 | Three collections registered. TypeScript, production build, 31 unit tests and lint passed. SDK schema lint returned zero warnings. | Plans approval pending. Authenticated integration tests pending. |
| CR-005 Room creation and invitation joining | Unassigned | Pending | CR-004 | — | — |
| CR-006 Track CRUD and validation | Unassigned | Pending | CR-004, CR-005 for membership integration | — | — |
| CR-007 Frontend dashboard and setlist editor | Unassigned | Pending | CR-002 contracts, CR-005 and CR-006 for integration | — | — |
| CR-008 Data subscriptions and collaborative ordering | Unassigned | Pending | CR-004, CR-006, CR-007 for editor integration | — | — |
| CR-009 Multi-user authorization and integration tests | Unassigned | Pending | CR-005 through CR-008 for full scenarios | — | — |
| CR-010 Deployment, production verification and submission | Unassigned | Pending | CR-003, CR-009 | — | — |

## CR-004 review notes

The corrected schemas deny wildcard and viewer access. Members have team reads on rooms and tracks, and admins may read both collections. All client roles are denied membership reads and direct writes on all three collections. In SDK 0.44.2, both the per-record membership lookup and the team list query read `c_team_members` directly, independently of client permissions on that collection.

Plans approved the v1 creator invariant in SPEC.md. Room creators receive active membership during creation, and track creators must already be active members. V1 has no membership removal or deactivation operation. External membership removal leaves the SDK creator read grant in effect.

CR-005 owns server-side authorization for room creation and invitation joining, write ordering and recovery after partial failure, membership uniqueness, duplicate joins, and explicit validation of active status.

Future authenticated actions must set the room envelope ID equal to `roomId`, validate `trackOrder` as a string array, and write only the literal `active` for membership status. JSON and select interpretations do not enforce those value constraints. The SDK also counts a stored null status as membership. Required columns are checked on create, so actions must preserve required values on updates. Optional track columns accept null without additional configuration.

Local tests exercised SDK permission predicates and schema lint. The cloud CLI reported `not_authenticated`. Live reads, lists, subscriptions, direct-write denial and persisted membership uniqueness still need authenticated integration coverage.
