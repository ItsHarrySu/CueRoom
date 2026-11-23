# CueRoom technical specification

## Product and deadline

CueRoom is a real-time collaborative setlist planner for DJs. The deadline is Wednesday, November 25, 2026 at 11:59 PM Eastern / 8:59 PM Pacific. The minimum demonstration requires two authenticated users collaborating on one persistent, ordered setlist and a third user denied access.

## Architecture

Use the scaffold's DeepSpace SDK 0.44.2, Vite, React, TypeScript, Tailwind CSS, and Hono Cloudflare Worker. A single application RecordRoom provides SQLite-backed persistence for all logical rooms. Use DeepSpace built-in authentication, server-enforced collection permissions, authenticated server actions for privileged writes, and record subscriptions for real-time synchronization. No separate database, custom authentication service, or custom WebSocket backend is in scope.

## Collections

Retain the generated users and settings schemas and their permissions in src/schemas.ts and src/schemas/. The following are planned record data shapes. Use the existing DeepSpace envelope for recordId and other SDK metadata. Track IDs refer to envelope record IDs.

| Collection | Record data | Identity |
| --- | --- | --- |
| rooms | roomId: string, name: string, ownerId: string, inviteToken: string, trackOrder: string[] | recordId equals roomId, which also serves as the team ID |
| tracks | roomId: string, title: string, artist: string, bpm?: number or null, musicalKey?: string or null, energy?: number or null, addedBy: string, capacitySlot: integer, creationToken: string | Each record belongs to exactly one room |
| team_members | teamId: string, userId: string, status: "active" | Exactly one record per (teamId, userId) pair |

## Security

Rooms and tracks use `teamField: 'roomId'` for member reads, including lists and subscriptions. Admins may read rooms and tracks. Wildcard and viewer roles have no access. Every client role is denied reads of `team_members` and direct creates, updates and deletes on all three collections. DeepSpace resolves team membership internally.

Room creation must establish active team membership for the room creator and handle partial failures without leaving a creator-readable room that lacks the owner's active membership. Track creators must already be active members of the room. CueRoom v1 has no membership removal or deactivation operation. The SDK's `'team'` permission also grants reads to the envelope's `createdBy` user. Externally removing a creator's membership therefore cannot guarantee revocation of reads on records they created.

For every action, obtain the caller ID from verified DeepSpace authentication. Reject caller-supplied identity, membership, ownership, and other unexpected fields. For existing-room edits verify active membership, and for every referenced track verify that the target room owns it. Both active collaborators may edit the shared setlist. Only the create and token-validated join paths may establish membership.

Generate an unguessable invitation token using a cryptographically secure random source. Validate the token against the named room on the server before granting access. Because inviteToken is stored in a member-readable room, existing participants can obtain and share it. An owner-only invitation policy would require Plans approval and a different token access design.

Before implementation, verify exact schema syntax, team resolution, privileged action context, subscription filtering, and persistence guarantees against the installed SDK version. These are behavioral requirements. Run denial tests before treating any permission as enforced.

## Server action contracts

```ts
type TrackInput = {
  title: string
  artist: string
  bpm?: number | null
  musicalKey?: string | null
  energy?: number | null
}
type TrackPatch = Partial<TrackInput>
```

| Action | Success result | Server behavior |
| --- | --- | --- |
| createRoom({name}) | {roomId} | Generate room ID and token, set ownerId to caller, initialize empty trackOrder and establish the owner's active membership before reporting success. |
| joinRoom({roomId, inviteToken}) | {joined: true} | Authenticate, check token and room, and establish a unique active membership. Repeating a valid join succeeds without duplicating the pair. |
| addTrack({roomId, track: TrackInput}) | {trackId} | Validate membership, fields, and capacity. Assign roomId and addedBy server-side and append the new record ID to the order. |
| updateTrack({roomId, trackId, patch: TrackPatch}) | {trackId} | Validate membership and room ownership of track. Apply only supplied editable fields. |
| deleteTrack({roomId, trackId}) | {trackId} | Validate membership and room ownership of track. Delete the record and remove its ID from the order. |
| reorderTracks({roomId, orderedTrackIds}) | {roomId} | Accept only a complete permutation of the current room's live track IDs. Persist it as trackOrder. |

## Validation

Reject malformed requests on the server before writing. Validate identifiers, object types and allowed fields. Require trimmed room names of 1–80 characters and trimmed track titles and artists of 1–120 each. BPM must be finite and within 40–240 inclusive, musical key at most 16 characters, and energy an integer from 1 through 5. Optional fields accept null to clear. Omitted patch fields retain their values. Reject empty patches. Enforce a maximum of 200 live tracks per room, including concurrent additions.

Every live track has an immutable server-owned slot from 0 through 199. A physical SQLite unique index on (roomId, capacitySlot) and storage triggers enforce the ceiling in the shared RecordRoom. Slot reuse after deletion has no effect on setlist order. On cold start the RecordRoom fences incoming events, verifies the index, and audits or migrates legacy rows before serving writes. Over-capacity or inconsistent data requires explicit reconciliation.

The add action generates independent cryptographic UUIDs for the record ID and immutable creation token. A create colliding with a different stored marker cannot overwrite that track. SDK 0.44.2 still performs upserts and can edit a record if its marker is omitted or repeated. UUID uniqueness is probabilistic. Only a definite slot conflict permits a new attempt with fresh identifiers. After a lost reply, the action verifies the original ID and marker without resubmitting the create. A new client request is a separate operation. Track creation and canonical order updates are separate writes.


## Ordering and synchronization

rooms.trackOrder is canonical. Render live IDs in stored order, skipping deleted IDs and duplicate occurrences. Append missing live IDs sorted by record ID in ascending ordinal order so clients converge independently of subscription arrival order. Subscribe to authorized room and track records and recompute when either changes.

Validate reorder input against the current live ID set at acceptance. Reject missing, duplicate, foreign, and stale IDs and refresh before retry. The last accepted complete reorder wins. Verify how the SDK can coordinate concurrent server writes, including capacity and membership checks. Do not assume transactional atomicity across multiple record operations. On partial failure, surface the error, reload authoritative records and reconcile incomplete work before reporting success.

## Routes

| Path | Access and responsibility |
| --- | --- |
| / | Public landing page |
| /home | Authenticated dashboard listing authorized rooms. Remove duplicate /home route definitions when implementing the frontend. |
| /rooms/:roomId | Authenticated editor and invitation entry. Carry invitation context through sign-in, submit the join action, then subscribe after access is confirmed. |

## Feature priorities

- **P0** — Authentication, room creation, secure invitation joining, track CRUD and ordering, persistence, real-time synchronization, server-enforced authorization, loading and error states, and production deployment.
- **P1** — Presence after security validation, sharing dialog, and improved drag-and-drop.
- **P2** — Voting/comments, BPM warnings, energy progression, and export.
- **Excluded** — Spotify playback, generic integration execution, payment integrations, audio processing, and custom authentication infrastructure.

## Acceptance criteria

1. In independent authenticated sessions, A creates a room and B joins with its valid token. Both can add, edit, delete and reorder tracks. Each sees accepted changes from the other without manual refresh. Refresh both sessions and verify the same records and order persist.
2. As an authenticated third user without membership, attempt room and track reads, list queries, subscriptions, invalid-token joins, and all existing-room edits. Confirm no private data is returned or streamed and no unauthorized change persists. Attempt direct collection mutations even as a member. Test forged identity and another room's track ID on update, delete, and reorder.
3. Exercise duplicate joins, competing reorders, stale permutations, capacity at 200, invalid field values, and failed writes. Verify rejected actions show errors, leave no false success state, and converge on persisted data after reload.
4. Record implementation changes, compilation/build results, local tests, and multi-user test evidence separately. Record deployment outcome and perform the collaboration, persistence and denial checks on the actual deployed application before claiming production verification.

## CR-012 selective integrations

An active room owner may explicitly request display-only advice for adjacent tracks. The free preview uses recorded metadata. AI generation requires separate Plans and Backend/Security approval, verified developer billing, durable per-room quota and explicit cost confirmation. Only titles, artists, BPM, key and energy from the current room may enter model context. The email invitation action accepts one recipient from an active room owner. Plans accepts the platform-managed sender. The production action reports delivery unavailable pending provider contract and billing verification and security approval. See issue #16 for approval gates.
