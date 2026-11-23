import { describe, expect, it } from 'vitest'
import { canCreate, canDelete, canRead, canUpdate, lintSchemas } from 'deepspace/worker'
import { schemas } from '../schemas'
import { roomsSchema } from './rooms-schema'
import { tracksSchema } from './tracks-schema'
import { teamMembersSchema } from './team-members-schema'

const row = { data: { roomId: 'room', userId: 'alice' }, createdBy: 'creator' }
const membership = { isTeamMember: (team: string, user: string) => team === 'room' && user === 'bob' }

it('registers the three collections with no SDK schema-lint findings', () => {
  expect(schemas).toEqual(expect.arrayContaining([roomsSchema, tracksSchema, teamMembersSchema]))
  expect(lintSchemas(schemas)).toEqual([])
})

describe.each([roomsSchema, tracksSchema, teamMembersSchema])('$name client permissions', (schema) => {
  it.each(['anonymous', 'viewer', 'member', 'admin'])('denies direct writes by %s', (role) => {
    expect(canCreate(schema, role)).toBe(false)
    expect(canUpdate(schema, role, row, 'alice', membership)).toBe(false)
    expect(canDelete(schema, role, row, 'alice', membership)).toBe(false)
  })

  it('denies viewer and anonymous reads and grants admin reads', () => {
    for (const role of ['viewer', 'anonymous']) {
      expect(canRead(schema, role, row, 'alice', membership)).toBe(false)
    }
    expect(canRead(schema, 'admin', row, 'outsider', membership)).toBe(true)
  })
})

it.each([roomsSchema, tracksSchema])('allows a team member or the row creator to read $name', (schema) => {
  expect(canRead(schema, 'member', row, 'bob', membership)).toBe(true)
  expect(canRead(schema, 'member', row, 'creator', membership)).toBe(true)
  expect(canRead(schema, 'member', row, 'outsider', membership)).toBe(false)
})

it('scopes membership reads to userId even when another user created the row', () => {
  expect(canRead(teamMembersSchema, 'member', row, 'alice', membership)).toBe(true)
  expect(canRead(teamMembersSchema, 'member', row, 'creator', membership)).toBe(false)
  expect(canRead(teamMembersSchema, 'member', row, 'bob', membership)).toBe(false)
})
