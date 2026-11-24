import { emailDelivery, verifiedEmailAcknowledgement } from '../../server/email-transport'
import { emailReady, readSettings } from '../../server/integration-settings'
import type { ActionHandler } from 'deepspace/worker'
import { z } from 'zod/v4'
import type { Env } from '../../../worker'
import { reserveInvitation } from '../../server/invitation-quota'

const input = z.strictObject({
  roomId: z.uuid(),
  recipient: z.email().max(254),
  confirmation: z.uuid(),
})
const fail = (error: string) => ({ success: false as const, error })
const unavailable = 'Email delivery is unavailable. Copy the invitation link to share it.'
type Message = { recipient: string; subject: string; text: string }
// This is a CueRoom transport boundary. Provider wire fields and acknowledgement are unverified.
type Delivery = (message: Message, env: Env) => Promise<'accepted'>

export function invitationEmailAction(deliver?: Delivery): ActionHandler<Env> {
  return async ({ userId, callerJwt, params, tools, env }) => {
    if (!callerJwt || !userId?.trim() || userId.startsWith('anon-')) return fail('Sign in to continue.')
    const parsed = input.safeParse(params)
    if (!parsed.success) return fail('Enter one valid recipient and reopen the invitation.')
    const { roomId, recipient, confirmation } = parsed.data
    try {
      const room = await tools.get('rooms', roomId)
      if (!room.success || room.error !== undefined || room.data.record.recordId !== roomId)
        return fail('Room access denied.')
      const data = room.data.record.data
      if (data.roomId !== roomId || data.ownerId !== userId) return fail('Room access denied.')
      const membership = await tools.query('team_members', { where: { teamId: roomId, userId }, limit: 2 })
      if (!membership.success || membership.error !== undefined) return fail('Room access denied.')
      const page = membership.data
      const member = page.records[0]?.data
      if (page.count !== 1 || page.records.length !== 1 || 'nextOffset' in page ||
        ('truncated' in page && page.truncated) || member?.teamId !== roomId ||
        member.userId !== userId || member.status !== 'active') return fail('Room access denied.')
      if (!deliver || !emailReady(env, !!deliver) || !(await readSettings(env)).email || !z.uuid().safeParse(data.inviteToken).success ||
        typeof env.APP_NAME !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(env.APP_NAME))
        return fail(unavailable)
      const link = `https://${env.APP_NAME}.app.space/rooms/${roomId}#invite=${data.inviteToken}`
      if (!await reserveInvitation(env.INVITATION_QUOTA, userId, roomId, confirmation, env.DEEPSPACE_APP_ID))
        return fail('Invitation already requested or sending limit reached.')
      // A failed or ambiguous dispatch keeps its reservation. Never retry here.
      try {
        if (await deliver({ recipient, subject: 'Invitation to a CueRoom setlist',
          text: 'Sign in to CueRoom and accept the invitation: ' + link }, env) === 'accepted')
          return { success: true, data: { accepted: true } }
      } catch { /* Do not expose transport errors, recipient or token. */ }
      return fail('Delivery could not be confirmed.')
    } catch {
      return fail(unavailable)
    }
  }
}

export const sendInvitationEmail = invitationEmailAction(emailDelivery(verifiedEmailAcknowledgement))
