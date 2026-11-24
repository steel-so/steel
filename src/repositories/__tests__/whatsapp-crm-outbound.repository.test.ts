import { describe, expect, it } from 'vitest'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { WhatsAppCrmOutboundRepository as Outbound } from '../whatsapp-crm-outbound.repository'

const WA = '5511988887777'
const DAY = 86_400_000

async function seed(workspaceId: string, waId = WA, text = 'Oi') {
  return expectOk(
    await Outbound.create({
      workspaceId,
      waId,
      source: 'campaign',
      type: 'TEXT',
      text,
    }),
  )
}

describe('WhatsAppCrmOutboundRepository', () => {
  it('lists the pending messages of the number, oldest first', async () => {
    const ws = await seedWorkspace()
    const other = await seedWorkspace()
    const first = await seed(ws.id, WA, 'primeira')
    const second = await seed(ws.id, WA, 'segunda')
    await seed(ws.id, '5511900000000')
    await seed(other.id)

    const rows = expectOk(
      await Outbound.listPending(ws.id, WA, new Date(Date.now() - DAY), 10),
    )

    expect(rows.map((r) => r.id)).toEqual([first.id, second.id])
  })

  it('skips the ones already filed', async () => {
    const ws = await seedWorkspace()
    const row = await seed(ws.id)
    expectOk(await Outbound.markImported([row.id], new Date()))

    const rows = expectOk(
      await Outbound.listPending(ws.id, WA, new Date(Date.now() - DAY), 10),
    )

    expect(rows).toEqual([])
  })

  it('prunes rows older than the cutoff', async () => {
    const ws = await seedWorkspace()
    await seed(ws.id)

    const deleted = expectOk(
      await Outbound.deleteOlderThan(new Date(Date.now() + DAY)),
    )

    expect(deleted).toBe(1)
  })
})
