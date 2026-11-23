import type { CollectionSchema } from 'deepspace/schema'

export const tracksSchema: CollectionSchema = {
  name: 'tracks',
  teamField: 'roomId',
  uniqueOn: ['roomId', 'capacitySlot'],
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'capacitySlot', storage: 'number', interpretation: 'plain', required: true, immutable: true },
    { name: 'creationToken', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'title', storage: 'text', interpretation: 'plain', required: true },
    { name: 'artist', storage: 'text', interpretation: 'plain', required: true },
    { name: 'bpm', storage: 'number', interpretation: 'plain' },
    { name: 'musicalKey', storage: 'text', interpretation: 'plain' },
    { name: 'energy', storage: 'number', interpretation: 'plain' },
    { name: 'addedBy', storage: 'text', interpretation: 'plain', required: true, immutable: true, userBound: true },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'team', create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}
