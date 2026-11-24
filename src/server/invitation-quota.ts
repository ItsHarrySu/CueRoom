// Each app binds a private D1 database. SQLite serializes each reservation batch.
// Keep only 24 hours of opaque confirmation IDs and room/owner IDs.
export async function reserveInvitation(db: D1Database, owner: string, room: string, confirmation: string, app: string) {
  const results = await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS invitation_attempts (
      confirmation TEXT PRIMARY KEY, owner TEXT NOT NULL, room TEXT NOT NULL, reserved INTEGER NOT NULL
    )`),
    db.prepare('DELETE FROM invitation_attempts WHERE reserved <= unixepoch() - 86400'),
    db.prepare(`INSERT INTO invitation_attempts (confirmation, owner, room, reserved)
      SELECT ?, ?, ?, unixepoch()
      WHERE EXISTS (SELECT 1 FROM integration_settings WHERE app=? AND feature='email' AND enabled=1)
        AND (SELECT COUNT(*) FROM invitation_attempts) < 30
        AND (SELECT COUNT(*) FROM invitation_attempts WHERE owner = ?) < 10
        AND (SELECT COUNT(*) FROM invitation_attempts WHERE room = ?) < 3
      ON CONFLICT(confirmation) DO NOTHING`).bind(confirmation, owner, room, app, owner, room),
  ])
  return results.length === 3 && results.every(result => result.success) && results[2].meta.changes === 1
}
