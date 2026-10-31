import { describe, expect, it } from 'vitest'
import { seedSdTicket } from '@/src/__tests__/factories/sd-ticket.factory'
import {
  seedSdCalendar,
  seedSdDepartment,
  seedSdDepartmentMember,
  seedSdPhase,
} from '@/src/__tests__/factories/sd-ticket-context.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { SdWfmRepository } from '../sd-wfm.repository'

describe('SdWfmRepository', () => {
  it('upserts and finds the settings per workspace', async () => {
    const workspace = await seedWorkspace()
    expect(
      expectOk(await SdWfmRepository.findSettings(workspace.id)),
    ).toBeNull()

    const created = expectOk(
      await SdWfmRepository.upsertSettings(workspace.id, { historyWeeks: 12 }),
    )
    expect(created).toMatchObject({
      historyWeeks: 12,
      ticketsPerAgentHour: 2.5,
    })

    const updated = expectOk(
      await SdWfmRepository.upsertSettings(workspace.id, {
        minAgentsPerShift: 3,
        shifts: [{ name: 'Noite', startHour: 22, endHour: 6 }],
      }),
    )
    expect(updated).toMatchObject({ historyWeeks: 12, minAgentsPerShift: 3 })
    expect(updated.shifts).toEqual([
      { name: 'Noite', startHour: 22, endHour: 6 },
    ])
  })

  it('counts tickets per hour inside the workspace and window', async () => {
    const [workspace, other] = await Promise.all([
      seedWorkspace(),
      seedWorkspace(),
    ])
    const [phase, otherPhase] = await Promise.all([
      seedSdPhase(workspace.id),
      seedSdPhase(other.id),
    ])
    const department = await seedSdDepartment(workspace.id)
    const at = (iso: string) => new Date(iso)
    await seedSdTicket(workspace.id, phase.id, {
      createdAt: at('2026-11-02T10:05:00Z'),
      departmentId: department.id,
    })
    await seedSdTicket(workspace.id, phase.id, {
      createdAt: at('2026-11-02T10:55:00Z'),
    })
    await seedSdTicket(workspace.id, phase.id, {
      createdAt: at('2026-11-02T11:00:00Z'),
    })
    await seedSdTicket(workspace.id, phase.id, {
      createdAt: at('2026-11-02T12:00:00Z'),
      deletedAt: at('2026-11-03T00:00:00Z'),
    })
    await seedSdTicket(workspace.id, phase.id, {
      createdAt: at('2026-10-01T10:00:00Z'),
    })
    await seedSdTicket(other.id, otherPhase.id, {
      createdAt: at('2026-11-02T10:10:00Z'),
    })

    const since = at('2026-11-01T00:00:00Z')
    const until = at('2026-11-04T00:00:00Z')
    const all = expectOk(
      await SdWfmRepository.hourlyCounts(workspace.id, since, until),
    )
    expect(all.map((r) => [r.bucket.toISOString(), r.count])).toEqual([
      ['2026-11-02T10:00:00.000Z', 2],
      ['2026-11-02T11:00:00.000Z', 1],
    ])

    const filtered = expectOk(
      await SdWfmRepository.hourlyCounts(
        workspace.id,
        since,
        until,
        department.id,
      ),
    )
    expect(filtered).toHaveLength(1)
    expect(filtered[0].count).toBe(1)
  })

  it('resolves the time zone from the default calendar', async () => {
    const workspace = await seedWorkspace()
    expect(
      expectOk(await SdWfmRepository.findTimeZone(workspace.id)),
    ).toBeNull()
    await seedSdCalendar(workspace.id, { name: 'A', timezone: 'UTC' })
    await seedSdCalendar(workspace.id, {
      name: 'B',
      timezone: 'America/Manaus',
      isDefault: true,
    })
    expect(expectOk(await SdWfmRepository.findTimeZone(workspace.id))).toBe(
      'America/Manaus',
    )
  })

  it('counts distinct people in active departments', async () => {
    const workspace = await seedWorkspace()
    const [a, b] = await Promise.all([seedUser(), seedUser()])
    const [d1, d2, gone] = await Promise.all([
      seedSdDepartment(workspace.id, { name: 'N1' }),
      seedSdDepartment(workspace.id, { name: 'N2' }),
      seedSdDepartment(workspace.id, { name: 'Velho', active: false }),
    ])
    await seedSdDepartmentMember(d1.id, a.id)
    await seedSdDepartmentMember(d2.id, a.id)
    await seedSdDepartmentMember(d2.id, b.id)
    await seedSdDepartmentMember(gone.id, b.id)

    expect(expectOk(await SdWfmRepository.countTeam(workspace.id))).toBe(2)
    expect(expectOk(await SdWfmRepository.countTeam(workspace.id, d1.id))).toBe(
      1,
    )
    expect(
      expectOk(await SdWfmRepository.countTeam(workspace.id, gone.id)),
    ).toBe(0)
  })
})
