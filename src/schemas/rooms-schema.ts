import type { CollectionSchema } from 'deepspace/schema'

export const roomsSchema: CollectionSchema = {
  name: 'rooms',
  teamField: 'roomId',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'name', storage: 'text', interpretation: 'plain', required: true },
    { name: 'ownerId', storage: 'text', interpretation: 'plain', required: true, immutable: true, userBound: true },
    { name: 'inviteToken', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'trackOrder', storage: 'text', interpretation: { kind: 'json' }, required: true },
  ],
  permissions: {
    anonymous: { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'team', create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}
