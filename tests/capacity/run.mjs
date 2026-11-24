// Run from the project root with npm run test:capacity.
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
function bearer(sub) {
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const payload =
    encode({ alg: 'ES256' }) +
    '.' +
    encode({ sub, iss: 'cue-test', exp: Math.floor(Date.now() / 1000) + 300 })
  return (
    'Bearer ' +
    payload +
    '.' +
    sign('sha256', Buffer.from(payload), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString(
      'base64url',
    )
  )
}
const bundle = await build({
  entryPoints: ['tests/capacity/worker.ts'],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
  external: ['cloudflare:*', 'node:*'],
})
const names = ['store', 'second', 'third']
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    workers: names.map((name) => ({
      name,
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: '2026-07-01',
      compatibilityFlags: ['nodejs_compat'],
      d1Databases: { INVITATION_QUOTA: 'shared-quota' },
      bindings: {
        OWNER_USER_ID: 'alice',
        DEEPSPACE_APP_ID: 'test',
        AUTH_JWT_ISSUER: 'cue-test',
        AUTH_JWT_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }),
      },
      durableObjects: {
        RECORD_ROOMS: { className: 'FixtureRoom', scriptName: 'store', useSQLite: true },
      },
    })),
  }),
)
try {
  const workers = await Promise.all(names.map((name) => runtime.getWorker(name)))
  const setting = (worker, feature) => worker.fetch('https://local/test-settings', {
    method: 'PUT', headers: {Authorization:bearer('alice'),'Content-Type':'application/json'},
    body:JSON.stringify({feature,enabled:true}),
  })
  const saved = await Promise.all([setting(workers[0],'email'),setting(workers[1],'ai')])
  for (const response of saved) assert.equal(response.status,200,await response.text())
  const settings = await (await workers[2].fetch('https://local/api/cueroom/settings',{
    headers:{Authorization:bearer('alice')},
  })).json()
  assert.deepEqual(settings.preferences,{email:true,ai:true})
  assert.equal(settings.email,false)
  const attempts = await Promise.all(Array.from({length:12},async (_,i) =>
    (await workers[i%3].fetch('https://local/test-reserve-email',{method:'POST'})).json()))
  assert.equal(attempts.filter(Boolean).length,3)
  const scope = 'app:test'
  async function sql(query, target = scope) {
    const res = await workers[0].fetch('https://local/fixture/' + target + '/inspect', {
      method: 'POST',
      body: query,
    })
    assert.equal(res.status, 200)
    return res.json()
  }
  async function tool(worker, tool, params, privileged = true) {
    const res = await worker.fetch('https://local/fixture/' + scope + '/api/tools/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': 'alice',
        ...(privileged && { 'X-App-Action': 'true' }),
      },
      body: JSON.stringify({ tool, params }),
    })
    return res.json()
  }
  const create = (worker, collection, recordId, data, privileged) =>
    tool(worker, 'records.create', { collection, recordId, data }, privileged)
  async function action(worker, name, params, user = 'alice') {
    const res = await worker.fetch('https://local/api/actions/' + name, {
      method: 'POST',
      headers: { Authorization: bearer(user), 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    assert.equal(res.status, 200)
    return res.json()
  }
  for (const wrong of ['wrong-index', 'overflow', 'duplicates'])
    await assert.rejects(() => sql('SELECT 1', wrong))
  const summary = () =>
    sql(
      'SELECT count(*) AS n, count(DISTINCT col_capacityslot) AS slots,count(DISTINCT col_creationtoken) AS tokens FROM c_tracks',
    )
  assert.deepEqual(await summary(), [{ n: 199, slots: 199, tokens: 199 }])
  const old = await sql(
    "SELECT count(*) AS n FROM c_tracks WHERE _updated_at='old' AND col_title='Legacy'",
  )
  assert.equal(old[0].n, 199)
  assert.equal(
    (
      await create(workers[0], 'rooms', 'room', {
        roomId: 'room',
        name: 'Test',
        ownerId: 'alice',
        inviteToken: 'invite',
        trackOrder: [],
      })
    ).success,
    true,
  )
  assert.equal(
    (
      await create(workers[0], 'team_members', 'member', {
        teamId: 'room',
        userId: 'alice',
        status: 'active',
      })
    ).success,
    true,
  )
  const track = { title: 'New', artist: 'Artist' }
  const add = (worker) => action(worker, 'addTrack', { roomId: 'room', track })
  assert.equal(
    (await action(workers[1], 'addTrack', { roomId: 'room', track }, 'outsider')).success,
    false,
  )
  const results = await Promise.all(workers.map(add))
  assert.equal(results.filter((r) => r.success).length, 1, JSON.stringify(results))
  assert.deepEqual(await summary(), [{ n: 200, slots: 200, tokens: 200 }])
  const winner = results.find((r) => r.success).data.trackId
  assert.equal((await add(workers[1])).success, false)
  const original = await sql('SELECT * FROM c_tracks WHERE col_capacityslot=199')
  assert.equal(original[0]._row_id, winner)
  const collisions = await Promise.all(
    workers.map((worker) =>
      create(worker, 'tracks', winner, {
        title: 'Changed',
        artist: 'Artist',
        roomId: 'room',
        addedBy: 'alice',
        capacitySlot: 199,
        creationToken: crypto.randomUUID(),
      }),
    ),
  )
  assert.ok(collisions.every((r) => !r.success))
  assert.deepEqual(await sql('SELECT * FROM c_tracks WHERE col_capacityslot=199'), original)
  assert.equal(
    (await action(workers[1], 'deleteTrack', { roomId: 'room', trackId: winner })).success,
    true,
  )
  for (const slot of [null, 1.5, -1, 200]) {
    const data = {
      ...track,
      roomId: 'room',
      addedBy: 'alice',
      creationToken: crypto.randomUUID(),
      capacitySlot: slot,
    }
    assert.equal((await create(workers[2], 'tracks', crypto.randomUUID(), data)).success, false)
    assert.deepEqual(await summary(), [{ n: 199, slots: 199, tokens: 199 }])
  }
  assert.equal(
    (
      await create(
        workers[2],
        'tracks',
        'client',
        { ...track, roomId: 'room', addedBy: 'alice', creationToken: 'client', capacitySlot: 199 },
        false,
      )
    ).success,
    false,
  )
  const replacement = await action(workers[2], 'addTrack', {
    roomId: 'room',
    track: { ...track, title: 'Lose reply' },
  })
  assert.equal(replacement.success, true)
  assert.notEqual(replacement.data.trackId, winner)
  assert.deepEqual(await summary(), [{ n: 200, slots: 200, tokens: 200 }])
  async function subscribedIds(user) {
    const token = bearer(user).slice(7)
    const { webSocket } = await workers[1].fetch('https://local/ws/app:test?token=' + token, {
      headers: { Upgrade: 'websocket' },
    })
    webSocket.accept()
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Missing subscription snapshot')), 5000)
        webSocket.addEventListener('message', (event) => {
          const msg = JSON.parse(event.data)
          if (msg.type === 'core.query_result') {
            clearTimeout(timer)
            resolve(msg.payload.records.map((r) => r.recordId))
          }
        })
        webSocket.send(
          JSON.stringify({
            type: 'core.subscribe',
            payload: {
              subscriptionId: 'tracks',
              query: { collection: 'tracks', where: { roomId: 'room' }, limit: 200 },
            },
          }),
        )
      })
    } finally {
      webSocket.close()
    }
  }
  assert.deepEqual(await subscribedIds('outsider'), [])
  assert.ok((await subscribedIds('alice')).includes(replacement.data.trackId))
  const before = await sql(
    'SELECT _row_id,col_capacityslot,col_creationtoken FROM c_tracks ORDER BY _row_id',
  )
  await sql('DROP INDEX uniq_c_tracks_roomId_capacitySlot')
  await workers[0].fetch('https://local/fixture/app:test/cold').catch(() => {})
  assert.deepEqual(
    await sql('SELECT _row_id,col_capacityslot,col_creationtoken FROM c_tracks ORDER BY _row_id'),
    before,
  )
  assert.ok(
    (await sql('PRAGMA index_list(c_tracks)')).some(
      (row) => row.name === 'uniq_c_tracks_roomId_capacitySlot' && row.unique === 1,
    ),
  )
  assert.ok((await subscribedIds('alice')).includes(replacement.data.trackId))

  const ordered = (await sql('SELECT col_trackorder FROM c_rooms'))[0].col_trackorder
  const interleaved = await Promise.all([
    action(workers[0], 'reorderTracks', {
      roomId: 'room',
      orderedTrackIds: JSON.parse(ordered).reverse(),
    }),
    action(workers[1], 'deleteTrack', { roomId: 'room', trackId: replacement.data.trackId }),
    add(workers[2]),
  ])
  assert.ok(interleaved[1].success)
  const remaining = await sql('SELECT _row_id FROM c_tracks ORDER BY _row_id')
  assert.ok([199, 200].includes(remaining.length))
  assert.deepEqual(
    JSON.parse((await sql('SELECT col_trackorder FROM c_rooms'))[0].col_trackorder).sort(),
    remaining.map((r) => r._row_id),
  )
  const claims = workers.map((worker, i) =>
    create(worker, 'tracks', 'same-id', {
      roomId: 'other-room',
      title: 'Candidate ' + i,
      artist: 'Artist',
      addedBy: 'alice',
      creationToken: crypto.randomUUID(),
      capacitySlot: i,
    }),
  )
  const accepted = (await Promise.all(claims)).map((result) => result.success)
  assert.equal(accepted.filter(Boolean).length, 1)
  const [claimed] = await sql("SELECT col_title,col_capacityslot FROM c_tracks WHERE _row_id='same-id'")
  assert.equal(claimed.col_title, 'Candidate ' + accepted.indexOf(true))
  assert.equal(claimed.col_capacityslot, accepted.indexOf(true))
  for (const value of ['NULL', '-1', '1.5', '200', '42']) {
    await assert.rejects(() =>
      sql('UPDATE c_tracks SET col_capacityslot=' + value + " WHERE _row_id='same-id'"),
    )
  }
  assert.deepEqual(
    await sql("SELECT col_title,col_capacityslot FROM c_tracks WHERE _row_id='same-id'"),
    [claimed],
  )
  console.log(
    'Passed migration, failed initialization, JWT membership, last-slot race, collision, slot domain, client denial and slot reuse.',
  )
} finally {
  await runtime.dispose()
}
