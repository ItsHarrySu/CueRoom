import { describe, expect, it } from 'vitest'
import { canCreate, canDelete, canRead, canUpdate, lintSchemas } from 'deepspace/worker'
import { schemas } from '../schemas'
import { roomsSchema } from './rooms-schema'
import { tracksSchema } from './tracks-schema'
import { teamMembersSchema } from './team-members-schema'

const roles = ['*', 'viewer', 'member', 'admin']
const row = { data: { roomId: 'room', userId: 'alice' }, createdBy: 'creator' }
const membership = { isTeamMember: (team: string, user: string) => team === 'room' && user === 'bob' }

it('registers the three collections with no SDK schema-lint findings', () => {
  expect(schemas).toEqual(expect.arrayContaining([roomsSchema, tracksSchema, teamMembersSchema]))
  expect(lintSchemas(schemas)).toEqual([])
})

describe.each([roomsSchema, tracksSchema, teamMembersSchema])('$name client permissions', (schema) => {
  it.each(roles)('denies direct writes by %s', (role) => {
    expect(canCreate(schema, role)).toBe(false)
    expect(canUpdate(schema, role, row, 'alice', membership)).toBe(false)
    expect(canDelete(schema, role, row, 'alice', membership)).toBe(false)
  })

  it('declares a deny-all wildcard for unlisted roles', () => {
    expect(schema.permissions['*']).toEqual({ read: false, create: false, update: false, delete: false })
  })
})

describe.each([roomsSchema, tracksSchema])('$name reads', (schema) => {
  it.each(['*', 'viewer'])('denies reads by %s even for a team member', (role) => {
    expect(canRead(schema, role, row, 'bob', membership)).toBe(false)
  })

  it('allows active team members and admins and denies an unrelated member', () => {
    expect(canRead(schema, 'member', row, 'bob', membership)).toBe(true)
    expect(canRead(schema, 'admin', row, 'outsider', membership)).toBe(true)
    expect(canRead(schema, 'member', row, 'outsider', membership)).toBe(false)
  })

  it('allows the record creator to read without team membership', () => {
    expect(canRead(schema, 'member', row, 'creator', membership)).toBe(true)
  })
})

it.each(roles)('denies membership reads by %s, including the membership owner', (role) => {
  for (const user of ['alice', 'creator', 'bob']) {
    expect(canRead(teamMembersSchema, role, row, user, membership)).toBe(false)
  }
})
