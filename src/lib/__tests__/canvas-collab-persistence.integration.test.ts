import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { seedCrmEmailBuilderTemplate } from '@/src/__tests__/factories/crm-email-marketing.factory'
import { seedMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createSiteDocument,
  seedSite,
  seedSitePage,
} from '@/src/__tests__/factories/site.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { seedWorkspaceModuleAccess } from '@/src/__tests__/factories/workspace-module-access.factory'
import { expectOk } from '@/src/__tests__/helpers/result.helpers'
import { getNode } from '@/src/lib/canvas/ops'
import { createCanvasStore } from '@/src/lib/canvas/store'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { bindCanvasStore } from '@/src/lib/canvas-collab/binding'
import { canvasDocumentName } from '@/src/lib/canvas-collab/names'
import { readCanvas } from '@/src/lib/canvas-collab/project'
import { nodesOf } from '@/src/lib/canvas-collab/ydoc'
import { siteCatalog } from '@/src/lib/canvas-site'
import { prisma } from '@/src/lib/prisma'
import { CanvasCollabRepository } from '@/src/repositories/canvas-collab.repository'
import {
  createCanvasCollabRuntime,
  documentHash,
} from '@/src/services/canvas-collab.service'
import { SitePageService } from '@/src/services/site-page.service'

const NET = Symbol('net')

/** Server Y document + clients exchanging updates immediately. */
function connect(server: Y.Doc, client: Y.Doc) {
  Y.applyUpdate(client, Y.encodeStateAsUpdate(server), NET)
  server.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== client) Y.applyUpdate(client, update, server)
  })
  client.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== server && origin !== NET)
      Y.applyUpdate(server, update, client)
  })
}

async function fixture() {
  const [workspace, owner, viewer] = await Promise.all([
    seedWorkspace(),
    seedUser(),
    seedUser(),
  ])
  await Promise.all([
    seedMembership({
      userId: owner.id,
      workspaceId: workspace.id,
      role: 'OWNER',
    }),
    seedMembership({
      userId: viewer.id,
      workspaceId: workspace.id,
      role: 'VIEWER',
    }),
    seedWorkspaceModuleAccess(workspace.id, owner.id),
  ])
  const site = await seedSite(workspace.id, owner.id)
  const page = await seedSitePage(site.id)
  return { workspace, owner, viewer, site, page }
}

function client(server: Y.Doc, initial: CanvasDocument) {
  const ydoc = new Y.Doc()
  const store = createCanvasStore(siteCatalog, initial)
  const binding = bindCanvasStore(store, ydoc)
  connect(server, ydoc)
  binding.start()
  return store
}

async function storedDocument(pageId: string): Promise<CanvasDocument> {
  const page = await prisma.sitePage.findUniqueOrThrow({
    where: { id: pageId },
  })
  return page.document as unknown as CanvasDocument
}

describe('canvas co-editing persistence (real services)', () => {
  it('authorizes editors and viewers like the REST routes', async () => {
    const { owner, viewer, page } = await fixture()
    const runtime = createCanvasCollabRuntime()
    const name = canvasDocumentName('site-page', page.id)
    expect(expectOk(await runtime.authenticate(owner.id, name)).readOnly).toBe(
      false,
    )
    expect(expectOk(await runtime.authenticate(viewer.id, name)).readOnly).toBe(
      true,
    )
    const stranger = await seedUser()
    expect((await runtime.authenticate(stranger.id, name)).ok).toBe(false)
  })

  it('stores concurrent edits through the page service and keeps the Yjs state', async () => {
    const { owner, workspace, site, page } = await fixture()
    const runtime = createCanvasCollabRuntime()
    const name = canvasDocumentName('site-page', page.id)
    const server = new Y.Doc()
    expectOk(await runtime.load(name, server))

    const initial = createSiteDocument()
    const ana = client(server, initial)
    const bia = client(server, initial)
    ana.dispatch({ kind: 'update', id: 'h1', set: { text: 'Título da Ana' } })
    bia.dispatch({ kind: 'update', id: 's1', set: { anchor: 'secao-bia' } })

    expect(expectOk(await runtime.store(name, server, owner.id))).toBe('saved')
    const saved = await storedDocument(page.id)
    expect(saved.nodes.h1.props.text).toBe('Título da Ana')
    expect(saved.nodes.s1.props.anchor).toBe('secao-bia')
    const viaRest = expectOk(
      await SitePageService.get(owner.id, workspace.id, site.id, page.id),
    )
    expect(viaRest.document.nodes.h1.props.text).toBe('Título da Ana')

    const row = expectOk(await CanvasCollabRepository.findState(name))
    expect(row?.documentHash).toBe(documentHash(saved))

    // A fresh load (server restart) continues the same Yjs history.
    const reloaded = new Y.Doc()
    expectOk(await createCanvasCollabRuntime().load(name, reloaded))
    expect(Y.encodeStateVector(reloaded)).toEqual(Y.encodeStateVector(server))
  })

  it('merges a REST save made while the room was open', async () => {
    const { owner, workspace, site, page } = await fixture()
    const runtime = createCanvasCollabRuntime()
    const name = canvasDocumentName('site-page', page.id)
    const server = new Y.Doc()
    expectOk(await runtime.load(name, server))
    const ana = client(server, createSiteDocument())
    ana.dispatch({ kind: 'update', id: 's1', set: { anchor: 'ao-vivo' } })

    expectOk(
      await SitePageService.update(owner.id, workspace.id, site.id, page.id, {
        document: createSiteDocument('Restaurado') as never,
      }),
    )
    expect(expectOk(await runtime.reconcile(name, server))).toBe(true)
    const doc = ana.getState().doc
    expect(getNode(doc, 'h1')?.props.text).toBe('Restaurado')
    expect(getNode(doc, 's1')?.props.anchor).toBe('ao-vivo')
  })

  it('reverts a document the service refuses', async () => {
    const { owner, page } = await fixture()
    const runtime = createCanvasCollabRuntime()
    const name = canvasDocumentName('site-page', page.id)
    const server = new Y.Doc()
    expectOk(await runtime.load(name, server))
    const ana = client(server, createSiteDocument())

    // A malformed client bypasses the editor and writes an invalid level.
    server.transact(() => {
      const h1 = nodesOf(server).get('h1') as Y.Map<unknown>
      ;(h1.get('props') as Y.Map<unknown>).set('level', 'h9')
    }, 'evil-client')
    expect(expectOk(await runtime.store(name, server, owner.id))).toBe(
      'reverted',
    )
    expect(readCanvas(server)?.doc.nodes.h1.props.level).toBe('h1')
    expect((await storedDocument(page.id)).nodes.h1.props.level).toBe('h1')
    expect(getNode(ana.getState().doc, 'h1')?.props.level).toBe('h1')
  })

  it('opens a v1 e-mail template as a canvas and saves it as v2', async () => {
    const { owner, workspace } = await fixture()
    const template = await seedCrmEmailBuilderTemplate(workspace.id, owner.id)
    const runtime = createCanvasCollabRuntime()
    const name = canvasDocumentName('email-template', template.id)
    expect(expectOk(await runtime.authenticate(owner.id, name)).readOnly).toBe(
      false,
    )
    const server = new Y.Doc()
    expectOk(await runtime.load(name, server))
    const doc = readCanvas(server)?.doc as CanvasDocument
    expect(doc.catalog).toBe('email')
    expect(expectOk(await runtime.store(name, server, owner.id))).toBe('saved')
    const saved = await prisma.crmEmailTemplate.findUniqueOrThrow({
      where: { id: template.id },
    })
    expect((saved.builderDocument as { catalog?: string }).catalog).toBe(
      'email',
    )
    expect(saved.contentHtml).toContain('<')
  })
})
