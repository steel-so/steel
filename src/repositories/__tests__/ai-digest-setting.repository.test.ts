import { describe, expect, it, vi } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { AiDigestSettingRepository } from '../ai-digest-setting.repository'

describe('AiDigestSettingRepository', () => {
  it('upserts the channels per user and workspace', async () => {
    const [workspace, user, other] = await Promise.all([
      seedWorkspace(),
      seedUser(),
      seedUser(),
    ])
    expect(
      expectOk(await AiDigestSettingRepository.find(workspace.id, user.id)),
    ).toBeNull()

    const created = expectOk(
      await AiDigestSettingRepository.upsert(workspace.id, user.id, {
        email: false,
      }),
    )
    expect(created).toMatchObject({
      inApp: true,
      email: false,
      lastSentOn: null,
    })

    const updated = expectOk(
      await AiDigestSettingRepository.upsert(workspace.id, user.id, {
        inApp: false,
      }),
    )
    expect(updated).toMatchObject({
      id: created.id,
      inApp: false,
      email: false,
    })

    await AiDigestSettingRepository.upsert(workspace.id, other.id, {
      inApp: true,
    })
    const rows = expectOk(
      await AiDigestSettingRepository.listByWorkspace(workspace.id),
    )
    expect(rows.map((row) => row.userId).sort()).toEqual(
      [user.id, other.id].sort(),
    )
    expect(
      expectOk(await AiDigestSettingRepository.find(workspace.id, user.id))?.id,
    ).toBe(created.id)
  })

  it('marks the local day sent, creating the row when missing', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const first = expectOk(
      await AiDigestSettingRepository.markSent(
        workspace.id,
        user.id,
        '2026-10-18',
      ),
    )
    expect(first).toMatchObject({
      inApp: true,
      email: true,
      lastSentOn: '2026-10-18',
    })
    const second = expectOk(
      await AiDigestSettingRepository.markSent(
        workspace.id,
        user.id,
        '2026-10-19',
      ),
    )
    expect(second).toMatchObject({ id: first.id, lastSentOn: '2026-10-19' })
  })

  it('returns DATABASE_ERROR instead of throwing', async () => {
    const boom = new Error('db down')
    vi.spyOn(prisma.aiDigestSetting, 'findUnique').mockRejectedValue(boom)
    vi.spyOn(prisma.aiDigestSetting, 'findMany').mockRejectedValue(boom)
    vi.spyOn(prisma.aiDigestSetting, 'upsert').mockRejectedValue(boom)
    expectErr(await AiDigestSettingRepository.find('ws', 'u'), 'DATABASE_ERROR')
    expectErr(
      await AiDigestSettingRepository.listByWorkspace('ws'),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiDigestSettingRepository.upsert('ws', 'u', { email: true }),
      'DATABASE_ERROR',
    )
    expectErr(
      await AiDigestSettingRepository.markSent('ws', 'u', '2026-10-18'),
      'DATABASE_ERROR',
    )
    vi.restoreAllMocks()
  })
})
