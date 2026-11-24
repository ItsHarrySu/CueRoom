# CR-013 verification for issue #19

Use this checklist on each candidate PR head. Record the full SHA, OS, Node/npm versions, command, exit status and pass/fail/skip counts. A skipped authenticated case remains outstanding. Repeat affected checks when the SHA changes.

## Before release

1. In a clean Windows checkout, fetch the PR head, check it out by SHA and compare `git rev-parse HEAD` with the review record. Use Node 24, npm 11.6+ and the checked-in lockfile. Run each command below, stopping on failure.

   ```powershell
   npm ci
   npx playwright install chromium
   npm run type-check
   npm run lint
   npm run build
   npm run test:unit
   npm run test:capacity
   npx deepspace test accounts list
   npm test -- all
   ```

2. For authenticated Playwright coverage, use the test-account setup in TASKS.md and a local test Worker. Assign the test app owner through the trusted server configuration. Include another room owner and an ordinary member. Run the PR's integration browser specs explicitly through the repository Playwright configuration. Record executed case names. Use a mocked provider and disposable D1 storage. Keep production credentials out of fixtures.
3. Verify that each master switch and each persistent setting independently prevents its own dispatch. Check defaults on fresh storage, persisted OFF after restart, all four combinations, missing owner identity and D1 failure. Capture mock call counts and D1 quota counts before and after denied actions. Exercise two Worker instances racing for the final quota slot and confirmation replay. Retain reservations after uncertain dispatch. Verify generic integrations stay disabled and the capacity suite passes.
4. Verify email uses a single recipient and the fixed sender. Confirm the disclosed USD 0.013 per request, rolling 24-hour limits of 30/app, 10/owner and 3/room, and retained Copy invitation access while OFF. Verify AI requires an explicit confirmed action by the app owner who also owns the active room. Check the fixed model, bounded tokens, input scope, output validation, stale snapshots and an exhausted app-wide budget. Keep AI unavailable until the maximum provider charge can be proven.
5. Record independent Plans and Backend/Security decisions against each exact SHA, with evidence for the pinned SDK Worker credential, billing principal, endpoint and acknowledgement handling. Record the release operator's target app identity, D1 binding, prior release and rollback target. Approve any single paid verification separately, naming the recipient or prompt, charge ceiling and maximum one attempt.

## After deployment authorization

1. Ship the reviewed SHA from a clean checkout with both masters OFF. Compare the platform release record, checkout SHA and app identity. Verify the D1 binding belongs to this app and check the deployed owner settings against the approved release configuration.
2. With masters OFF, verify the owner can read, change and restore each durable toggle separately, including after reload. Verify another authenticated owner cannot change them. Exercise the disabled invitation and AI controls and the free preview. Check unchanged quota counts, zero dispatches and absence of charges. Keep recipient addresses, invite tokens and credentials out of release evidence.
3. Record release URL, release identifier, owner-visible settings, results and remaining skips. For an unexpected dispatch or billing discrepancy, turn the affected runtime setting OFF, disable its master and verify zero new dispatches. Use the approved rollback target if required. Preserve quota records and ambiguous reservations.
4. Track CR-014 submission separately after CR-013 verification, against the issue cutoff of November 25, 2026 at 8:59 p.m. Pacific.

On Home, the configured OWNER_USER_ID has two preference checkboxes under Integration settings. Changes persist in the app's private INVITATION_QUOTA D1 database without redeploying. “Available” describes effective server status. Supply EMAIL_SENDING_ENABLED=true only after release approval. Changing a Worker binding may require redeployment. Missing or unrecognized bindings keep delivery off. AI_GENERATION_ENABLED is its independent master, subject also to a verified price ceiling. Email costs $0.013 per attempt, with a rolling maximum of 30 app-wide ($0.39), 10 per owner and 3 per room each day. The pinned Worker scaffold bills APP_OWNER_JWT through API_WORKER. The email acknowledgment is undocumented, so an attempted dispatch cannot yet display confirmed acceptance. Keep both masters off during review.

Set the trusted Worker binding OWNER_USER_ID to the application owner's exact DeepSpace user ID (the verified JWT subject). The platform's server-side app configuration supplies this value. A room ID, email address or browser-supplied value cannot grant settings access. Treat master binding changes as requiring a redeploy unless the platform confirms live updates. The email verification gate overrides both switches before quota reservation. Releasing it requires a reviewed endpoint-specific decoder, independent billing review and separately approved one-attempt test.

SDK 0.44.2 worker.js.map (src/server/utils/proxies.ts) returns the service binding's raw Fetch Response. The SDK's generic IntegrationResponse<T> describes success, optional data and error; T is unknown. The scaffold uses APP_OWNER_JWT as the developer-billed bearer. Neither the pinned package nor the owner's catalog supplies email acceptance fields. Fixture-only receipts exercise bounded response handling; they provide no provider evidence.
