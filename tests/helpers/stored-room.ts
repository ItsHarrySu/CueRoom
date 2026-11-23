import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// Independent readback from the test runner's local Miniflare RecordRoom.
// Look up only this test's freshly generated room ID. Never open a remote store.
export function storedRoom(roomId: string) {
  const directory = join(process.cwd(), '.wrangler/state/v3/do/cueroom-harry-2026-AppRecordRoom')
  for (const file of readdirSync(directory).filter(name => /^[a-f0-9]+\.sqlite$/.test(name))) {
    const db = new DatabaseSync(join(directory, file), { readOnly: true })
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='c_rooms'").get()) continue
      const room = db.prepare('SELECT col_name, col_trackorder FROM c_rooms WHERE _row_id=?').get(roomId)
      if (!room) continue
      const members = db.prepare('SELECT _row_id, col_userid, col_status FROM c_team_members WHERE col_teamid=? ORDER BY _row_id').all(roomId)
      const tracks = db.prepare('SELECT _row_id, col_title FROM c_tracks WHERE col_roomid=? ORDER BY _row_id').all(roomId)
      return { name: room.col_name, order: JSON.parse(String(room.col_trackorder)) as string[], members, tracks }
    } finally {
      db.close()
    }
  }
  throw Error('Could not locate the new room in local RecordRoom storage.')
}
