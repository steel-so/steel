import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  getJson,
  patchJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { prisma } from '@/src/lib/prisma'

describe('catalog and commerce settings routes', () => {
  it('rejects unauthenticated calls', async () => {
    const { workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/whatsapp`
    for (const path of [
      '/commerce/settings',
      '/catalog/products',
      '/catalog/orders',
    ]) {
      expect((await getJson(`${base}${path}`)).status).toBe(401)
    }
    expect((await postJson(`${base}/catalog/sync`, {})).status).toBe(401)
  })

  it('reads defaults, validates and saves the settings (admin only)', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/whatsapp/commerce/settings`

    const defaults = await getJson(base, user.cookie)
    expect(defaults.status).toBe(200)
    expect((await defaults.json()).data).toMatchObject({
      catalogEnabled: false,
      triggersEnabled: false,
      throttleHours: 24,
    })

    expect(
      (await patchJson(base, { metaCatalogId: 'abc' }, user.cookie)).status,
    ).toBe(422)
    // The catalog cannot be turned on without a Meta catalog id.
    expect(
      (await patchJson(base, { catalogEnabled: true }, user.cookie)).status,
    ).toBe(422)

    const saved = await patchJson(
      base,
      { catalogEnabled: true, metaCatalogId: '1234567890' },
      user.cookie,
    )
    expect(saved.status).toBe(200)
    expect((await saved.json()).data).toMatchObject({
      catalogEnabled: true,
      metaCatalogId: '1234567890',
    })

    const member = await addMember(workspace.id, 'MEMBER')
    expect(
      (await patchJson(base, { throttleHours: 1 }, member.cookie)).status,
    ).toBe(403)
  })

  it('syncs the CRM products into the catalog and pauses one', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/whatsapp`
    await prisma.crmProduct.create({
      data: {
        workspaceId: workspace.id,
        name: 'Plano Fibra',
        sku: 'FIBRA-1',
        unitPrice: 99.9,
        createdById: user.id,
      },
    })

    // Off: nothing to sync yet.
    expect((await postJson(`${base}/catalog/sync`, {}, user.cookie)).status).toBe(
      409,
    )
    await patchJson(
      `${base}/commerce/settings`,
      { catalogEnabled: true, metaCatalogId: '1234567890' },
      user.cookie,
    )
    const synced = await postJson(`${base}/catalog/sync`, {}, user.cookie)
    expect(synced.status).toBe(200)
    expect((await synced.json()).data).toEqual({
      created: 1,
      updated: 0,
      removed: 0,
    })

    const list = await getJson(`${base}/catalog/products`, user.cookie)
    const products = (await list.json()).data
    expect(products).toHaveLength(1)
    expect(products[0]).toMatchObject({ retailerId: 'FIBRA-1', price: 99.9 })

    const paused = await patchJson(
      `${base}/catalog/products/${products[0].id}`,
      { available: false },
      user.cookie,
    )
    expect(paused.status).toBe(200)
    const onlyAvailable = await getJson(
      `${base}/catalog/products?available=true`,
      user.cookie,
    )
    expect((await onlyAvailable.json()).data).toEqual([])

    expect(
      (
        await patchJson(
          `${base}/catalog/products/does-not-exist`,
          { available: true },
          user.cookie,
        )
      ).status,
    ).toBe(404)
    expect((await getJson(`${base}/catalog/orders`, user.cookie)).status).toBe(
      200,
    )
  })

  it('validates sending products', async () => {
    const { user, workspace } = await authenticatedOwner()
    const send = await postJson(
      `/api/workspaces/${workspace.id}/whatsapp/catalog/send`,
      { conversationId: 'x', productIds: [], bodyText: 'oi' },
      user.cookie,
    )
    expect(send.status).toBe(422)
  })
})
