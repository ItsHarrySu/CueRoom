import { apiWorkerFetch, readBoundedBodyText } from 'deepspace/worker'
import type { Env } from '../../worker'

type Message = { recipient: string; subject: string; text: string }
type Acknowledgement = (data: unknown) => boolean

// Requires endpoint-specific evidence and independent review in an enablement commit.
export const verifiedEmailAcknowledgement: Acknowledgement | undefined = undefined

export function emailDelivery(acknowledged?: Acknowledgement) {
  if (!acknowledged) return undefined
  return async (message: Message, env: Env): Promise<'accepted'> => {
    const response = await apiWorkerFetch(env, '/api/integrations/email/send', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Authorization: 'Bearer ' + env.APP_OWNER_JWT, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: message.recipient, subject: message.subject, text: message.text }),
    })
    if (!response.ok || response.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
      await response.body?.cancel()
      throw Error('Unconfirmed delivery')
    }
    const payload = JSON.parse(await readBoundedBodyText(response, 4096))
    if (payload?.success !== true || 'error' in payload || 'code' in payload ||
      !Object.hasOwn(payload, 'data') || !acknowledged(payload.data)) throw Error('Unconfirmed delivery')
    return 'accepted'
  }
}
