# CueRoom task tracker

Plans is the Lead Architect. Dependencies below are planning prerequisites. Plans may authorize independent work in parallel. A dash means no evidence or blocker recorded.

| ID and task | Owner | Status | Dependencies | Evidence | Blockers |
| --- | --- | --- | --- | --- | --- |
| CR-001 DeepSpace bootstrap | Unrecorded | Complete | None | Plans approved scaffold commit `16f5652` | — |
| CR-002 Canonical specifications | Codex | Complete | CR-001 | Plans approved the specifications merged in PR #2 | — |
| CR-003 App registration and build verification | Unrecorded | Complete | CR-002 | Registration commit `6a41340`. Plans confirmed local TypeScript, production build, unit tests and lint passed. | — |
| CR-004 Data schema and permission foundations | Codex | In progress pending Plans review | CR-002, CR-003 | Three collections registered. TypeScript, production build, 22 unit tests and lint passed. SDK schema lint returned zero warnings. | Review creator access below. Authenticated integration tests pending. |
| CR-005 Room creation and invitation joining | Unassigned | Pending | CR-004 | — | — |
| CR-006 Track CRUD and validation | Unassigned | Pending | CR-004, CR-005 for membership integration | — | — |
| CR-007 Frontend dashboard and setlist editor | Unassigned | Pending | CR-002 contracts, CR-005 and CR-006 for integration | — | — |
| CR-008 Data subscriptions and collaborative ordering | Unassigned | Pending | CR-004, CR-006, CR-007 for editor integration | — | — |
| CR-009 Multi-user authorization and integration tests | Unassigned | Pending | CR-005 through CR-008 for full scenarios | — | — |
| CR-010 Deployment, production verification and submission | Unassigned | Pending | CR-003, CR-009 | — | — |

## CR-004 review notes

DeepSpace 0.44.2 grants a member with team read permission access through active membership or record ownership. Rooms and tracks use the default owner, the envelope's `createdBy`. A creator can read their row after membership removal. Plans must resolve this exception before accepting strict membership-only access. Membership rows use `ownerField: 'userId'` for own reads. All three collections deny direct creates, updates and deletes for every declared role.

Future authenticated actions must set the room envelope ID equal to `roomId`, validate `trackOrder` as a string array, and write only the literal `active` for membership status. JSON and select interpretations do not enforce those value constraints. The SDK also counts a stored null status as membership. Required columns are checked on create, so actions must preserve required values on updates. Optional track columns accept null without additional configuration.

Local tests exercised SDK permission predicates and schema lint. The cloud CLI reported `not_authenticated`. Live reads, lists, subscriptions, direct-write denial and persisted membership uniqueness still need authenticated integration coverage.
