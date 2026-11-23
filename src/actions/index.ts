import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'

import { createRoom, joinRoom } from './cueroom/rooms.js'
import { addTrack, updateTrack, deleteTrack, reorderTracks } from './cueroom/tracks.js'

import { previewTransition } from './cueroom/advisor.js'

import { sendInvitationEmail } from './cueroom/invitation-email.js'

export const actions: Record<string, ActionHandler<Env>> = { sendInvitationEmail, previewTransition, createRoom, joinRoom, addTrack, updateTrack, deleteTrack, reorderTracks }
