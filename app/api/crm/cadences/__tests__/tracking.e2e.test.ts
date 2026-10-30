import { describe, expect, it } from 'vitest'
import { seedCrmLead } from '@/src/__tests__/factories/crm-lead.factory'
import {
  seedCrmCadence,
  seedCrmCadenceEnrollment,
} from '@/src/__tests__/factories/nov-c1-sales-cadences.factory'
import { seedCrmCadenceRun } from '@/src/__tests__/factories/nov-cadence-followups.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { defaultHeaders } from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import {
  createCadenceClickToken,
  createCadenceOpenToken,
} from '@/src/lib/crm-cadence/tracking'
import { prisma } from '@/src/lib/prisma'

const DESTINATION = 'https://example.com/proposta?x=1'

async function seedRun(stopOnClick: boolean) {
  const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
  const cadence = await seedCrmCadence(workspace.id, user.id, { stopOnClick }, [
    { type: 'EMAIL', subject: 'Oi', body: 'a' },
  ])
  const lead = await seedCrmLead(workspace.id, user.id)
  const enrollment = await seedCrmCadenceEnrollment({
    workspaceId: workspace.id,
    cadenceId: cadence.id,
    leadId: lead.id,
    enrolledById: user.id,
  })
  const run = await seedCrmCadenceRun({
    workspaceId: workspace.id,
    cadenceId: cadence.id,
    enrollmentId: enrollment.id,
    status: 'SENT',
    createdAt: new Date(Date.now() - 60 * 60_000),
  })
  return { enrollment, run }
}

const click = (token: string, url: string) =>
  fetch(
    `${BASE_URL}/api/crm/cadences/c/${token}?u=${encodeURIComponent(url)}`,
    { headers: defaultHeaders, redirect: 'manual' },
  )

describe('/api/crm/cadences — public tracking', () => {
  it('should serve the pixel for any token and count a valid open', async () => {
    const bad = await fetch(`${BASE_URL}/api/crm/cadences/o/nope.bad`)
    expect(bad.status).toBe(200)
    expect(bad.headers.get('content-type')).toBe('image/gif')

    const { run } = await seedRun(false)
    const ok = await fetch(
      `${BASE_URL}/api/crm/cadences/o/${createCadenceOpenToken(run.id)}`,
    )
    expect(ok.status).toBe(200)
    const row = await prisma.crmCadenceRun.findUniqueOrThrow({
      where: { id: run.id },
    })
    expect(row.openCount).toBe(1)
    expect(row.openedAt).not.toBeNull()
  })

  it('should refuse a link whose destination was changed', async () => {
    const { run } = await seedRun(false)
    const token = createCadenceClickToken(run.id, DESTINATION)
    expect((await click(token, 'https://evil.example.org')).status).toBe(404)
    expect((await click('nope.bad', DESTINATION)).status).toBe(404)
    expect(
      (
        await click(
          createCadenceClickToken(run.id, 'javascript:1'),
          'javascript:1',
        )
      ).status,
    ).toBe(404)
  })

  it('should record the click, redirect, and keep the enrollment running', async () => {
    const { run, enrollment } = await seedRun(false)
    const res = await click(
      createCadenceClickToken(run.id, DESTINATION),
      DESTINATION,
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(DESTINATION)
    expect(
      await prisma.crmCadenceRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).toMatchObject({ clickCount: 1 })
    expect(
      (
        await prisma.crmCadenceEnrollment.findUniqueOrThrow({
          where: { id: enrollment.id },
        })
      ).status,
    ).toBe('ACTIVE')
  })

  it('should stop the enrollment on click when the cadence is set to', async () => {
    const { run, enrollment } = await seedRun(true)
    const res = await click(
      createCadenceClickToken(run.id, DESTINATION),
      DESTINATION,
    )
    expect(res.status).toBe(302)
    expect(
      await prisma.crmCadenceEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      }),
    ).toMatchObject({ status: 'STOPPED', stopReason: 'CLICKED' })
  })
})
