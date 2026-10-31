import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  deleteJson,
  getJson,
  patchJson,
  postJson,
  putJson,
} from '@/src/__tests__/helpers/e2e'
import { signStorePayload } from '@/src/lib/ecommerce/signature'
import { prisma } from '@/src/lib/prisma'

let counter = 0
async function metaConnection(workspaceId: string, createdById: string) {
  counter += 1
  return prisma.whatsAppConnection.create({
    data: {
      workspaceId,
      provider: 'META',
      label: 'Oficial',
      phoneNumber: `5511${Date.now()}${counter}`,
      metaPhoneNumberId: `phone-${Date.now()}${counter}`,
      metaWabaId: `waba-${Date.now()}${counter}`,
      encryptedMetaAccessToken: 'enc:token',
      createdById,
    },
  })
}

const WEBHOOK = (id: string) => `/api/whatsapp/webhook/ecommerce/${id}`

describe('store routes and webhook', () => {
  it('rejects unauthenticated calls and non-admin writes', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/whatsapp`
    expect((await getJson(`${base}/stores`)).status).toBe(401)
    expect((await getJson(`${base}/ecommerce/triggers`)).status).toBe(401)
    expect((await getJson(`${base}/ecommerce/events`)).status).toBe(401)

    const connection = await metaConnection(workspace.id, user.id)
    const member = await addMember(workspace.id, 'MEMBER')
    const denied = await postJson(
      `${base}/stores`,
      { provider: 'TRAY', name: 'Loja', connectionId: connection.id },
      member.cookie,
    )
    expect(denied.status).toBe(403)
    expect((await getJson(`${base}/stores`, member.cookie)).status).toBe(200)
  })

  it('connects a store, receives a signed event and rotates the secret', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/whatsapp`
    const connection = await metaConnection(workspace.id, user.id)

    const invalid = await postJson(`${base}/stores`, { name: '' }, user.cookie)
    expect(invalid.status).toBe(422)

    const created = await postJson(
      `${base}/stores`,
      { provider: 'TRAY', name: 'Loja Tray', connectionId: connection.id },
      user.cookie,
    )
    expect(created.status).toBe(201)
    const store = (await created.json()).data
    expect(store.webhookSecret).toMatch(/^[0-9a-f]{48}$/)

    const listed = (await (await getJson(`${base}/stores`, user.cookie)).json())
      .data
    expect(listed).toHaveLength(1)
    expect(listed[0]).not.toHaveProperty('webhookSecret')
    expect(listed[0]).not.toHaveProperty('encryptedWebhookSecret')

    const payload = {
      event: 'cart.abandoned',
      id: 'cart-1',
      customer: { name: 'Maria', phone: '11988887777' },
    }
    const signed = (secret: string) => ({
      'x-steel-signature': signStorePayload(secret, JSON.stringify(payload)),
    })

    // A wrong signature and an unknown store look the same.
    expect(
      (
        await postJson(WEBHOOK(store.id), payload, {
          extraHeaders: signed('wrong'),
        })
      ).status,
    ).toBe(401)
    expect(
      (
        await postJson(WEBHOOK('missing'), payload, {
          extraHeaders: signed(store.webhookSecret),
        })
      ).status,
    ).toBe(401)

    // The store is off until enabled: signed but not accepted.
    const off = await postJson(WEBHOOK(store.id), payload, {
      extraHeaders: signed(store.webhookSecret),
    })
    expect(off.status).toBe(200)
    expect((await off.json()).data).toMatchObject({ accepted: false })

    expect(
      (
        await patchJson(
          `${base}/stores/${store.id}`,
          { enabled: true },
          user.cookie,
        )
      ).status,
    ).toBe(200)
    await patchJson(
      `${base}/commerce/settings`,
      { triggersEnabled: true },
      user.cookie,
    )
    const accepted = await postJson(WEBHOOK(store.id), payload, {
      extraHeaders: signed(store.webhookSecret),
    })
    expect(accepted.status).toBe(200)
    expect((await accepted.json()).data).toEqual({ accepted: true })
    // A retry of the same event is idempotent.
    const retry = await postJson(WEBHOOK(store.id), payload, {
      extraHeaders: signed(store.webhookSecret),
    })
    expect((await retry.json()).data).toEqual({ accepted: false })

    const events = (
      await (await getJson(`${base}/ecommerce/events`, user.cookie)).json()
    ).data
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'CART_ABANDONED',
      storeName: 'Loja Tray',
      // No abandoned-cart trigger was configured, so nothing is sent.
      status: 'SKIPPED',
    })

    const rotated = await postJson(
      `${base}/stores/${store.id}/rotate-secret`,
      {},
      user.cookie,
    )
    const next = (await rotated.json()).data.webhookSecret
    expect(next).not.toBe(store.webhookSecret)
    expect(
      (
        await postJson(
          WEBHOOK(store.id),
          { ...payload, id: 'cart-2' },
          {
            extraHeaders: {
              'x-steel-signature': signStorePayload(
                store.webhookSecret,
                JSON.stringify({ ...payload, id: 'cart-2' }),
              ),
            },
          },
        )
      ).status,
    ).toBe(401)

    expect(
      (await deleteJson(`${base}/stores/${store.id}`, user.cookie)).status,
    ).toBe(200)
    expect(
      (await patchJson(`${base}/stores/${store.id}`, {}, user.cookie)).status,
    ).toBe(404)
  })

  it('lists the three triggers and validates saving one', async () => {
    const { user, workspace } = await authenticatedOwner()
    const base = `/api/workspaces/${workspace.id}/whatsapp/ecommerce/triggers`
    const list = (await (await getJson(base, user.cookie)).json()).data
    expect(list.map((t: { kind: string }) => t.kind)).toEqual([
      'ABANDONED_CART',
      'ORDER_SHIPPED',
      'POST_PURCHASE',
    ])
    const unknownKind = await putJson(
      `${base}/NOPE`,
      { enabled: false, templateId: null, delayMinutes: 0 },
      user.cookie,
    )
    expect(unknownKind.status).toBe(422)
    const needsTemplate = await putJson(
      `${base}/ORDER_SHIPPED`,
      { enabled: true, templateId: null, delayMinutes: 0 },
      user.cookie,
    )
    expect(needsTemplate.status).toBe(422)
  })
})
