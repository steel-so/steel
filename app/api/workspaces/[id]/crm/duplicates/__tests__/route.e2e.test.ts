import { describe, expect, it } from 'vitest'
import {
  addMember,
  authenticatedOwner,
  createAuthenticatedUser,
  getJson,
  postJson,
} from '@/src/__tests__/helpers/e2e'
import { BASE_URL } from '@/src/__tests__/setup.e2e'
import { prisma } from '@/src/lib/prisma'

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/crm/duplicates`

async function twoAnas() {
  const { user, workspace } = await authenticatedOwner()
  const survivor = await prisma.crmPerson.create({
    data: {
      name: 'Ana Souza',
      emails: ['ana@acme.com'],
      workspaceId: workspace.id,
      createdById: user.id,
    },
  })
  const loser = await prisma.crmPerson.create({
    data: {
      name: 'Ana S.',
      emails: ['ANA@acme.com'],
      phones: ['5581999990000'],
      workspaceId: workspace.id,
      createdById: user.id,
    },
  })
  const note = await prisma.crmNote.create({
    data: {
      body: 'Nota',
      personId: loser.id,
      workspaceId: workspace.id,
      createdById: user.id,
    },
  })
  return { user, workspace, survivor, loser, note }
}

async function scanned() {
  const ctx = await twoAnas()
  const scan = await postJson(
    `${base(ctx.workspace.id)}/scan`,
    {},
    ctx.user.cookie,
  )
  expect(scan.status).toBe(200)
  const list = await getJson(
    `${base(ctx.workspace.id)}?entity=PERSON`,
    ctx.user.cookie,
  )
  const page = (await list.json()).data
  return { ...ctx, scan: (await scan.json()).data, page }
}

describe('duplicates review API', () => {
  it('should scan, list the pair with history counts and totals', async () => {
    const { scan, page, survivor, loser } = await scanned()

    expect(scan.person.pairs).toBe(1)
    expect(page.total).toBe(1)
    expect(page.pending.person).toBe(1)
    const [pair] = page.items
    expect([pair.left.id, pair.right.id].sort()).toEqual(
      [survivor.id, loser.id].sort(),
    )
    expect(pair.reasons).toContain('email')
    const loserSide = pair.left.id === loser.id ? pair.left : pair.right
    expect(loserSide.historyCount).toBe(1)
  })

  it('should validate query and body', async () => {
    const { user, workspace } = await authenticatedOwner()

    expect(
      (await getJson(`${base(workspace.id)}?entity=NOPE`, user.cookie)).status,
    ).toBe(422)
    expect(
      (
        await postJson(
          `${base(workspace.id)}/scan`,
          { entity: 'NOPE' },
          user.cookie,
        )
      ).status,
    ).toBe(422)
    expect(
      (await postJson(`${base(workspace.id)}/anything/merge`, {}, user.cookie))
        .status,
    ).toBe(422)
  })

  it('should merge, move the history and undo within the window', async () => {
    const { user, workspace, survivor, loser, note, page } = await scanned()
    const candidateId = page.items[0].id

    const merged = await postJson(
      `${base(workspace.id)}/${candidateId}/merge`,
      { survivorId: survivor.id },
      user.cookie,
    )
    expect(merged.status).toBe(200)
    const merge = (await merged.json()).data
    expect(merge).toMatchObject({
      survivorId: survivor.id,
      mergedId: loser.id,
      canUndo: true,
    })
    expect(
      (await prisma.crmNote.findUniqueOrThrow({ where: { id: note.id } }))
        .personId,
    ).toBe(survivor.id)
    expect(
      (await prisma.crmPerson.findUniqueOrThrow({ where: { id: loser.id } }))
        .deletedAt,
    ).not.toBeNull()
    const survivorRow = await prisma.crmPerson.findUniqueOrThrow({
      where: { id: survivor.id },
    })
    expect(survivorRow.phones).toContain('5581999990000')

    const history = await getJson(
      `${base(workspace.id)}/merges?entity=PERSON`,
      user.cookie,
    )
    expect(history.status).toBe(200)
    expect((await history.json()).data[0].id).toBe(merge.id)

    const again = await postJson(
      `${base(workspace.id)}/${candidateId}/merge`,
      { survivorId: survivor.id },
      user.cookie,
    )
    expect(again.status).toBe(422)

    const undone = await postJson(
      `${base(workspace.id)}/merges/${merge.id}/undo`,
      {},
      user.cookie,
    )
    expect(undone.status).toBe(200)
    expect((await undone.json()).data.undoneAt).not.toBeNull()
    expect(
      (await prisma.crmNote.findUniqueOrThrow({ where: { id: note.id } }))
        .personId,
    ).toBe(loser.id)
    expect(
      (await prisma.crmPerson.findUniqueOrThrow({ where: { id: loser.id } }))
        .deletedAt,
    ).toBeNull()

    const twice = await postJson(
      `${base(workspace.id)}/merges/${merge.id}/undo`,
      {},
      user.cookie,
    )
    expect(twice.status).toBe(409)
    expect((await twice.json()).error.code).toBe('CRM_MERGE_UNDO_EXPIRED')
  })

  it('should refuse a survivor outside the pair', async () => {
    const { user, workspace, page } = await scanned()

    const res = await postJson(
      `${base(workspace.id)}/${page.items[0].id}/merge`,
      { survivorId: 'someone-else' },
      user.cookie,
    )

    expect(res.status).toBe(422)
  })

  it('should dismiss a pair so it leaves the pending queue', async () => {
    const { user, workspace, page } = await scanned()

    const res = await postJson(
      `${base(workspace.id)}/${page.items[0].id}/dismiss`,
      {},
      user.cookie,
    )

    expect(res.status).toBe(200)
    const pending = await getJson(
      `${base(workspace.id)}?entity=PERSON`,
      user.cookie,
    )
    expect((await pending.json()).data.total).toBe(0)
    const dismissed = await getJson(
      `${base(workspace.id)}?entity=PERSON&status=DISMISSED`,
      user.cookie,
    )
    expect((await dismissed.json()).data.total).toBe(1)
    expect(
      (
        await postJson(
          `${base(workspace.id)}/${page.items[0].id}/dismiss`,
          {},
          user.cookie,
        )
      ).status,
    ).toBe(422)
  })

  it('should answer 404 for unknown candidates and merges', async () => {
    const { user, workspace } = await authenticatedOwner()

    expect(
      (await postJson(`${base(workspace.id)}/missing/dismiss`, {}, user.cookie))
        .status,
    ).toBe(404)
    expect(
      (
        await postJson(
          `${base(workspace.id)}/missing/merge`,
          { survivorId: 'x' },
          user.cookie,
        )
      ).status,
    ).toBe(404)
    expect(
      (
        await postJson(
          `${base(workspace.id)}/merges/missing/undo`,
          {},
          user.cookie,
        )
      ).status,
    ).toBe(404)
  })

  it('should enforce session, membership and role', async () => {
    const { workspace, page, user } = await scanned()
    const stranger = await createAuthenticatedUser()
    const member = await addMember(workspace.id, 'MEMBER')
    const viewer = await addMember(workspace.id, 'VIEWER')

    const anon = await fetch(`${BASE_URL}${base(workspace.id)}`, {
      redirect: 'manual',
    })
    expect(anon.status).toBe(401)
    expect((await getJson(base(workspace.id), stranger.cookie)).status).toBe(
      403,
    )
    expect((await getJson(base(workspace.id), viewer.cookie)).status).toBe(200)
    expect(
      (await postJson(`${base(workspace.id)}/scan`, {}, viewer.cookie)).status,
    ).toBe(403)
    expect(
      (
        await postJson(
          `${base(workspace.id)}/${page.items[0].id}/dismiss`,
          {},
          viewer.cookie,
        )
      ).status,
    ).toBe(403)
    // Merging is destructive: MEMBER cannot (no DELETE permission), the owner can.
    expect(
      (
        await postJson(
          `${base(workspace.id)}/${page.items[0].id}/merge`,
          { survivorId: page.items[0].left.id },
          member.cookie,
        )
      ).status,
    ).toBe(403)
    expect(user.id).toBeTruthy()
  })

  it('should not expose pairs of another workspace', async () => {
    const { page } = await scanned()
    const other = await authenticatedOwner()

    expect(
      (
        await postJson(
          `${base(other.workspace.id)}/${page.items[0].id}/dismiss`,
          {},
          other.user.cookie,
        )
      ).status,
    ).toBe(404)
  })

  it('should detect company duplicates by CNPJ root', async () => {
    const { user, workspace } = await authenticatedOwner()
    await prisma.crmCompany.createMany({
      data: [
        {
          name: 'Acme Brasil',
          cnpj: '11222333000181',
          workspaceId: workspace.id,
          createdById: user.id,
        },
        {
          name: 'ACME Brasil Ltda',
          domain: 'acme.com',
          workspaceId: workspace.id,
          createdById: user.id,
        },
      ],
    })

    const scan = await postJson(
      `${base(workspace.id)}/scan`,
      { entity: 'COMPANY' },
      user.cookie,
    )

    expect(scan.status).toBe(200)
    expect((await scan.json()).data.company.pairs).toBe(1)
    const list = await getJson(
      `${base(workspace.id)}?entity=COMPANY`,
      user.cookie,
    )
    expect((await list.json()).data.total).toBe(1)
  })
})
