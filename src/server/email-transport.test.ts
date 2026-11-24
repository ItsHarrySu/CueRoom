import {expect, it, vi} from 'vitest'
import type {Env} from '../../worker'
import {emailDelivery} from './email-transport'

// Synthetic acknowledgment exercises the adapter; the catalog has no email response schema.
const delivery = emailDelivery(data => data === 'fixture-only-receipt')!
const message = {recipient:'user@example.com', subject:'Invitation', text:'Fixture'}
const envelope = {success:true,data:'fixture-only-receipt'}
it('confirms the explicit fixture receipt using the fixed endpoint and billing identity',async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(envelope))
  await expect(delivery(message,{API_WORKER:{fetch},APP_OWNER_JWT:'owner-fixture'} as unknown as Env)).resolves.toBe('accepted')
  expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/integrations\/email\/send$/),
    expect.objectContaining({method:'POST',headers:{Authorization:'Bearer owner-fixture','Content-Type':'application/json'},
      body:JSON.stringify({to:message.recipient,subject:message.subject,text:message.text})}))
})
it.each([
  Response.json(envelope,{status:502}), Response.json({success:true}), Response.json({accepted:true}),
  Response.json({...envelope,error:'failed'}), Response.json({...envelope,success:false}),
  Response.json({...envelope,data:'other'}), new Response(JSON.stringify(envelope)),
  new Response('{',{headers:{'Content-Type':'application/json'}}),
  Response.json({...envelope,padding:'x'.repeat(4096)}),
])('rejects an ambiguous fixture response %#',async response => {
  const fetch = vi.fn().mockResolvedValue(response)
  await expect(delivery(message,{API_WORKER:{fetch},APP_OWNER_JWT:'fixture'} as unknown as Env)).rejects.toThrow()
  expect(fetch).toHaveBeenCalledTimes(1)
})
