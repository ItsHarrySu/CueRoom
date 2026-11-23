import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'

import { createRoom, joinRoom } from './cueroom/rooms.js'
import { addTrack, updateTrack, deleteTrack, reorderTracks } from './cueroom/tracks.js'

export const actions: Record<string, ActionHandler<Env>> = { createRoom, joinRoom, addTrack, updateTrack, deleteTrack, reorderTracks }
