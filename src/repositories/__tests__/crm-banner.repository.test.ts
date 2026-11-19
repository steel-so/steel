import { describe, expect, it } from 'vitest'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import {
  BANNER_TEMPLATES,
  buildBannerDocument,
} from '@/src/lib/banners/templates'
import { CrmBannerRepository } from '../crm-banner.repository'

const template = BANNER_TEMPLATES[0]
if (!template) throw new Error('no template')
const document = buildBannerDocument({
  template,
  brand: { companyName: '', logoUrl: '', primaryColor: '#2563eb' },
  formatIds: ['gdn-300x250'],
})

describe('CrmBannerRepository', () => {
  it('creates, updates and finds a banner scoped to its workspace', async () => {
    const [workspace, other, user] = await Promise.all([
      seedWorkspace(),
      seedWorkspace(),
      seedUser(),
    ])

    const created = expectOk(
      await CrmBannerRepository.create({
        workspaceId: workspace.id,
        createdById: user.id,
        name: 'Verão',
        folder: 'Sazonal',
        tags: ['display'],
        objective: 'SALES',
        document,
      }),
    )
    expect(created).toMatchObject({
      name: 'Verão',
      folder: 'Sazonal',
      tags: ['display'],
      objective: 'SALES',
    })

    const updated = expectOk(
      await CrmBannerRepository.update(created.id, {
        updatedById: user.id,
        name: 'Verão 2027',
        tags: [],
        objective: null,
      }),
    )
    expect(updated).toMatchObject({
      name: 'Verão 2027',
      tags: [],
      objective: null,
      updatedById: user.id,
    })

    expect(
      expectOk(await CrmBannerRepository.findById(created.id, workspace.id))
        .name,
    ).toBe('Verão 2027')
    expectErr(
      await CrmBannerRepository.findById(created.id, other.id),
      'RESOURCE_NOT_FOUND',
    )
  })

  it('lists newest first and hides soft deleted banners', async () => {
    const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
    const make = async (name: string) =>
      expectOk(
        await CrmBannerRepository.create({
          workspaceId: workspace.id,
          createdById: user.id,
          name,
          folder: '',
          tags: [],
          objective: null,
          document,
        }),
      )
    const first = await make('A')
    await make('B')
    expectOk(await CrmBannerRepository.softDelete(first.id, user.id))

    const list = expectOk(
      await CrmBannerRepository.listByWorkspace(workspace.id),
    )
    expect(list.map((banner) => banner.name)).toEqual(['B'])
    expectErr(
      await CrmBannerRepository.findById(first.id, workspace.id),
      'RESOURCE_NOT_FOUND',
    )
  })
})
