# CueRoom task tracker

Plans is the Lead Architect. Dependencies below are planning prerequisites. Plans may authorize independent work in parallel. A dash means no evidence or blocker recorded.

| ID and task | Owner | Status | Dependencies | Evidence | Blockers |
| --- | --- | --- | --- | --- | --- |
| CR-001 DeepSpace bootstrap | Unrecorded | Scaffold committed and reviewed. TypeScript passed. | None | Accepted scaffold commit `16f5652` and CR-001 review | Full build and unit tests blocked pending app registration |
| CR-002 Canonical specifications | Codex | In progress | CR-001 | SPEC.md, TASKS.md, AGENTS.md and README.md on the task branch | Plans review pending |
| CR-003 App registration and build verification | Unassigned | Pending | CR-002 | — | Confirm intended DeepSpace owner before registration |
| CR-004 Data schema and permission foundations | Unassigned | Pending | CR-002, CR-003 for runtime verification | — | — |
| CR-005 Room creation and invitation joining | Unassigned | Pending | CR-004 | — | — |
| CR-006 Track CRUD and validation | Unassigned | Pending | CR-004, CR-005 for membership integration | — | — |
| CR-007 Frontend dashboard and setlist editor | Unassigned | Pending | CR-002 contracts, CR-005 and CR-006 for integration | — | — |
| CR-008 Data subscriptions and collaborative ordering | Unassigned | Pending | CR-004, CR-006, CR-007 for editor integration | — | — |
| CR-009 Multi-user authorization and integration tests | Unassigned | Pending | CR-005 through CR-008 for full scenarios | — | — |
| CR-010 Deployment, production verification and submission | Unassigned | Pending | CR-003, CR-009 | — | — |

For CR-003, verify the intended DeepSpace owner, explicitly register the app under that account, commit the server-issued app ID, and rerun the build and unit tests. Record each result and preserve GitHub as the intended source.
