import type { CollectionSchema } from 'deepspace/schema'

export const teamMembersSchema: CollectionSchema = {
  name: 'team_members',
  ownerField: 'userId',
  uniqueOn: ['teamId', 'userId'],
  columns: [
    { name: 'teamId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true, immutable: true, userBound: true },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['active'] }, required: true },
  ],
  permissions: {
    anonymous: { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}
