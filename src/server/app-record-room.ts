import { RecordRoom } from 'deepspace/worker'
import type { Env } from '../../worker'
import { schemas } from '../schemas'

const index = 'uniq_c_tracks_roomId_capacitySlot'
const validSlot = (column: string) =>
  `typeof(${column}) IN ('integer','real') AND ${column} BETWEEN 0 AND 199 AND ${column} = CAST(${column} AS INTEGER)`

function initializeTracks(sql: SqlStorage) {
  // Only rows with both new fields absent are legacy. Never reinterpret a
  // partially migrated row or silently pick a winner for a corrupt room.
  const corrupt = sql.exec(`SELECT 1 FROM c_tracks WHERE
    typeof(_row_id) <> 'text' OR _row_id = '' OR
    typeof(col_roomid) <> 'text' OR col_roomid = '' OR
    (col_capacityslot IS NULL) <> (col_creationtoken IS NULL) OR
    (col_capacityslot IS NOT NULL AND (NOT (${validSlot('col_capacityslot')})
      OR typeof(col_creationtoken) <> 'text' OR col_creationtoken = '')) LIMIT 1`)
  if (corrupt.toArray().length) throw Error('Invalid track allocation metadata')
  if (
    sql.exec('SELECT 1 FROM c_tracks GROUP BY col_roomid HAVING count(*) > 200 LIMIT 1').toArray().length
  )
    throw Error('Over-capacity room requires reconciliation')

  sql.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "${index}" ON c_tracks(col_roomid,col_capacityslot)`)
  const meta = sql
    .exec('PRAGMA index_list(c_tracks)')
    .toArray()
    .find((row) => row.name === index)
  const columns = sql.exec(`PRAGMA index_info("${index}")`).toArray()
  if (
    meta?.unique !== 1 ||
    meta.partial !== 0 ||
    columns.length !== 2 ||
    columns[0].name !== 'col_roomid' ||
    columns[1].name !== 'col_capacityslot'
  )
    throw Error('Invalid track capacity index')

  for (const { room } of sql
    .exec('SELECT DISTINCT col_roomid AS room FROM c_tracks WHERE col_capacityslot IS NULL')
    .toArray()) {
    const tracks = sql
      .exec('SELECT _row_id, col_capacityslot FROM c_tracks WHERE col_roomid = ? ORDER BY _row_id', room)
      .toArray()
    const used = new Set(tracks.map((track) => track.col_capacityslot))
    let next = 0
    for (const track of tracks) {
      if (track.col_capacityslot !== null) continue
      while (used.has(next)) next++
      sql.exec(
        'UPDATE c_tracks SET col_capacityslot=?, col_creationtoken=? WHERE _row_id=?',
        next++,
        crypto.randomUUID(),
        track._row_id,
      )
    }
  }

  if (
    sql
      .exec('SELECT 1 FROM c_tracks WHERE col_capacityslot IS NULL OR col_creationtoken IS NULL LIMIT 1')
      .toArray().length
  )
    throw Error('Incomplete legacy track migration')

  // Replace our definitions on each cold start, including after an interrupted upgrade.
  for (const operation of ['INSERT', 'UPDATE']) {
    const name = 'cueroom_tracks_' + operation.toLowerCase()
    sql.exec(`DROP TRIGGER IF EXISTS ${name}`)
    sql.exec(`CREATE TRIGGER ${name} BEFORE ${operation} ON c_tracks
      WHEN NOT (${validSlot('NEW.col_capacityslot')})
        OR typeof(NEW.col_creationtoken) <> 'text' OR NEW.col_creationtoken = ''
        OR typeof(NEW.col_roomid) <> 'text' OR NEW.col_roomid = ''
        ${operation === 'UPDATE' ? 'OR NEW.col_roomid IS NOT OLD.col_roomid OR NEW.col_capacityslot IS NOT OLD.col_capacityslot OR NEW.col_creationtoken IS NOT OLD.col_creationtoken' : ''}
      BEGIN SELECT RAISE(ABORT, 'Invalid track allocation'); END`)
  }
}

export class AppRecordRoom extends RecordRoom<Env> {
  // SDK debug routes include arbitrary SQL, which could remove storage guards.
  protected override get debugRoutesEnabled() {
    return false
  }

  constructor(state: DurableObjectState, env: Env) {
    super(state, env, schemas, { ownerUserId: env.OWNER_USER_ID })
    void state.blockConcurrencyWhile(async () => {
      // The SDK readiness route initializes collection tables on its normal path.
      const response = await super.fetch(
        new Request('https://internal/ws/records?_deepspace_probe=readiness'),
      )
      if (!response.ok) throw Error('RecordRoom initialization failed')
      state.storage.transactionSync(() => initializeTracks(state.storage.sql))
    })
  }
}
