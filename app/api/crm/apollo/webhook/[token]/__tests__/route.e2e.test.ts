import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { seedCrmApolloImport } from '@/src/__tests__/factories/crm-apollo.factory'
import { seedCrmLead } from '@/src/__tests__/factories/crm-lead.factory'
import { authenticatedOwner, postJson } from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex')

const payload = (id: string) => ({
  request_id: '1039995589705121900',
  webhook_status: 'success',
  request_type: 'phone',
  webhook_result: {
    status: 'success',
    credits_consumed: 8,
    people: [
      {
        id,
        status: 'success',
        phone_numbers: [
          { sanitized_number: '+5581999990000', status_cd: 'valid_number' },
        ],
      },
    ],
  },
})

// Public route: no cookie. Apollo itself is never called.
describe('POST /api/crm/apollo/webhook/[token]', () => {
  it('should answer 404 for an unknown token', async () => {
    const response = await postJson(
      '/api/crm/apollo/webhook/not-a-real-token',
      payload('p1'),
    )
    expect(response.status).toBe(404)
  })

  it('should answer 422 for a malformed payload', async () => {
    const response = await postJson('/api/crm/apollo/webhook/anything', {
      webhook_result: { people: [{ id: '' }] },
    })
    expect(response.status).toBe(422)
  })

  it('should append the phone to the imported lead, once', async () => {
    const { user, workspace } = await authenticatedOwner()
    const token = `e2e-token-${Date.now()}`
    const row = await seedCrmApolloImport(workspace.id, user.id)
    await prisma.crmApolloImport.update({
      where: { id: row.id },
      data: { revealPhones: true, webhookTokenHash: sha256(token) },
    })
    const lead = await seedCrmLead(workspace.id, user.id, {
      externalSource: 'apollo',
      externalId: 'p1',
    })

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await postJson(
        `/api/crm/apollo/webhook/${token}`,
        payload('p1'),
      )
      expect(response.status).toBe(200)
    }

    const after = await prisma.crmLead.findUniqueOrThrow({
      where: { id: lead.id },
    })
    expect(after.phones).toEqual(['+5581999990000'])
    const run = await prisma.crmApolloImport.findUniqueOrThrow({
      where: { id: row.id },
    })
    expect(run.phonesReceived).toBe(1)
    expect(run.creditsConsumed).toBe(8)
  })

  it('should answer 404 once the import is older than 7 days', async () => {
    const { user, workspace } = await authenticatedOwner()
    const token = `e2e-old-${Date.now()}`
    const row = await seedCrmApolloImport(workspace.id, user.id)
    await prisma.crmApolloImport.update({
      where: { id: row.id },
      data: {
        status: 'DONE',
        webhookTokenHash: sha256(token),
        finishedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      },
    })
    const response = await postJson(
      `/api/crm/apollo/webhook/${token}`,
      payload('p1'),
    )
    expect(response.status).toBe(404)
  })
})
