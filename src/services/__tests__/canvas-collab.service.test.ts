import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createSiteDocument } from '@/src/__tests__/factories/site.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { appError } from '@/src/errors/app-error'
import type { CanvasDocument } from '@/src/lib/canvas/types'
import { canvasDocumentName } from '@/src/lib/canvas-collab/names'
import { readCanvas } from '@/src/lib/canvas-collab/project'
import { nodesOf, seedYDoc } from '@/src/lib/canvas-collab/ydoc'
import { createEmailDocumentFromLayout } from '@/src/lib/canvas-email/convert-v1'
import { createBuilderDocument } from '@/src/lib/crm-email-builder/layouts'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/canvas-collab.repository')
vi.mock('../authz')
vi.mock('../site-access')
vi.mock('../site-page.service')
vi.mock('../site-global.service')
vi.mock('../crm-email-template.service')
vi.mock('@/lib/axiom/logger')

import { CanvasCollabRepository } from '@/src/repositories/canvas-collab.repository'
import { assertModuleMember } from '../authz'
import {
  createCanvasCollabRuntime,
  documentHash,
  SERVER_ORIGIN,
  stableStringify,
} from '../canvas-collab.service'
import { CrmEmailTemplateService } from '../crm-email-template.service'
import { assertSitesPermission, authorizeSite } from '../site-access'
import { SiteGlobalService } from '../site-global.service'
import { SitePageService } from '../site-page.service'

const repo = vi.mocked(CanvasCollabRepository)
const moduleMember = vi.mocked(assertModuleMember)
const sitesPermission = vi.mocked(assertSitesPermission)
const siteAuth = vi.mocked(authorizeSite)
const pages = vi.mocked(SitePageService)
const globals = vi.mocked(SiteGlobalService)
const templates = vi.mocked(CrmEmailTemplateService)

const WS = 'ws1'
const PAGE = canvasDocumentName('site-page', 'p1')
const GLOBAL = canvasDocumentName('site-global', 'g1')
const EMAIL = canvasDocumentName('email-template', 't1')
const member = ok({
  ...createFakeMembership({ role: 'MEMBER' }),
  isPrivileged: false,
  permissions: null,
} as never)

let stored: CanvasDocument

function plain(doc: CanvasDocument | undefined) {
  return JSON.parse(JSON.stringify(doc ? { ...doc, nodes: doc.nodes } : null))
}

function docOf(ydoc: Y.Doc): CanvasDocument {
  const projection = readCanvas(ydoc)
  if (!projection) throw new Error('empty Y document')
  return projection.doc
}

function withText(text: string): CanvasDocument {
  return createSiteDocument(text)
}

beforeEach(() => {
  stored = createSiteDocument()
  repo.findSitePage.mockImplementation(async () =>
    ok({ workspaceId: WS, siteId: 's1', document: stored }),
  )
  repo.findSiteGlobal.mockImplementation(async () =>
    ok({ workspaceId: WS, siteId: 's1', document: stored }),
  )
  repo.findEmailTemplate.mockImplementation(async () =>
    ok({ workspaceId: WS, siteId: null, document: stored }),
  )
  repo.findState.mockResolvedValue(ok(null))
  repo.saveState.mockResolvedValue(ok(true))
  siteAuth.mockResolvedValue(ok({} as never))
  sitesPermission.mockResolvedValue(member)
  moduleMember.mockResolvedValue(member)
  pages.update.mockImplementation(async (_a, _w, _s, _p, dto) =>
    ok({ document: dto.document } as never),
  )
  globals.update.mockImplementation(async (_a, _w, _s, _g, dto) =>
    ok({ document: dto.document } as never),
  )
  templates.update.mockImplementation(async (_a, _w, _t, dto) =>
    ok({ builderDocument: dto.builderDocument } as never),
  )
})

describe('stableStringify / documentHash', () => {
  it('ignores key order and undefined values', () => {
    expect(stableStringify({ b: 1, a: [1, undefined], c: undefined })).toBe(
      '{"a":[1,null],"b":1}',
    )
    expect(stableStringify(undefined)).toBe('null')
    const a = createSiteDocument()
    const b = JSON.parse(JSON.stringify(a)) as CanvasDocument
    b.nodes = Object.fromEntries(Object.entries(b.nodes).reverse())
    expect(documentHash(a)).toBe(documentHash(b))
    expect(documentHash(a)).not.toBe(documentHash(withText('outro')))
  })
})

describe('CanvasCollab runtime — authenticate', () => {
  it('refuses rooms that are not canvas documents', async () => {
    const runtime = createCanvasCollabRuntime()
    expectErr(
      await runtime.authenticate('u1', 'wiki-page-id'),
      'CANVAS_COLLAB_NOT_FOUND',
    )
  })

  it('propagates a missing document and refuses a malformed one', async () => {
    const runtime = createCanvasCollabRuntime()
    repo.findSitePage.mockResolvedValueOnce(
      err(appError('CANVAS_COLLAB_NOT_FOUND', 'x')),
    )
    expectErr(await runtime.authenticate('u1', PAGE), 'CANVAS_COLLAB_NOT_FOUND')
    repo.findSitePage.mockResolvedValueOnce(
      ok({ workspaceId: WS, siteId: 's1', document: { nodes: 'x' } }),
    )
    expectErr(await runtime.authenticate('u1', PAGE), 'CANVAS_COLLAB_NOT_FOUND')
  })

  it('lets site editors edit and viewers only watch', async () => {
    const runtime = createCanvasCollabRuntime()
    expect(expectOk(await runtime.authenticate('u1', PAGE))).toEqual({
      workspaceId: WS,
      readOnly: false,
    })
    expect(siteAuth).toHaveBeenCalledWith('u1', WS, 's1', 'VIEW')
    expect(sitesPermission).toHaveBeenCalledWith('u1', WS, 'EDIT')
    sitesPermission.mockResolvedValueOnce(err(forbidden()))
    expect(expectOk(await runtime.authenticate('u1', GLOBAL)).readOnly).toBe(
      true,
    )
  })

  it('refuses non-members of the site’s workspace', async () => {
    const runtime = createCanvasCollabRuntime()
    siteAuth.mockResolvedValueOnce(err(forbidden()))
    expectErr(await runtime.authenticate('u1', PAGE), 'FORBIDDEN')
  })

  it('checks the e-mail permission for templates', async () => {
    const runtime = createCanvasCollabRuntime()
    stored = createBuilderDocument('newsletter') as never
    expect(expectOk(await runtime.authenticate('u1', EMAIL)).readOnly).toBe(
      false,
    )
    expect(moduleMember).toHaveBeenCalledWith('u1', WS, 'CRM', {
      resource: 'email',
      action: 'EDIT',
    })
    moduleMember.mockResolvedValueOnce(member)
    moduleMember.mockResolvedValueOnce(err(forbidden()))
    expect(expectOk(await runtime.authenticate('u1', EMAIL)).readOnly).toBe(
      true,
    )
    moduleMember.mockResolvedValueOnce(err(forbidden()))
    expectErr(await runtime.authenticate('u1', EMAIL), 'FORBIDDEN')
  })

  it('refuses a template whose document cannot be opened', async () => {
    const runtime = createCanvasCollabRuntime()
    stored = { layout: 'nope' } as never
    expectErr(
      await runtime.authenticate('u1', EMAIL),
      'CANVAS_COLLAB_NOT_FOUND',
    )
  })
})

describe('CanvasCollab runtime — load and reconcile', () => {
  it('seeds a room from the stored document', async () => {
    const runtime = createCanvasCollabRuntime()
    const ydoc = new Y.Doc()
    expectOk(await runtime.load(PAGE, ydoc))
    expect(plain(readCanvas(ydoc)?.doc)).toEqual(plain(stored))
    expect(runtime.rooms.get(PAGE)?.stateSaved).toBe(false)
  })

  it('restores the saved Yjs state when the document did not change', async () => {
    const source = new Y.Doc()
    seedYDoc(source, stored)
    repo.findState.mockResolvedValueOnce(
      ok({
        state: Y.encodeStateAsUpdate(source),
        documentHash: documentHash(stored),
      }),
    )
    const runtime = createCanvasCollabRuntime()
    const ydoc = new Y.Doc()
    expectOk(await runtime.load(PAGE, ydoc))
    // Same Yjs history: an update from the old state applies cleanly.
    expect(Y.encodeStateVector(ydoc)).toEqual(Y.encodeStateVector(source))
    expect(runtime.rooms.get(PAGE)?.stateSaved).toBe(true)
  })

  it('merges a change saved elsewhere into the saved state', async () => {
    const source = new Y.Doc()
    seedYDoc(source, createSiteDocument())
    repo.findState.mockResolvedValueOnce(
      ok({
        state: Y.encodeStateAsUpdate(source),
        documentHash: documentHash(createSiteDocument()),
      }),
    )
    stored = withText('salvo pelo REST')
    const runtime = createCanvasCollabRuntime()
    const ydoc = new Y.Doc()
    expectOk(await runtime.load(PAGE, ydoc))
    expect(plain(readCanvas(ydoc)?.doc)).toEqual(plain(stored))
    expect(runtime.rooms.get(PAGE)?.stateSaved).toBe(false)
  })

  it('reseeds when the saved state is unusable', async () => {
    const source = new Y.Doc()
    source.getMap('canvas.header').set('rootId', 'root')
    repo.findState.mockResolvedValueOnce(
      ok({ state: Y.encodeStateAsUpdate(source), documentHash: 'x' }),
    )
    const runtime = createCanvasCollabRuntime()
    const ydoc = new Y.Doc()
    expectOk(await runtime.load(PAGE, ydoc))
    expect(plain(readCanvas(ydoc)?.doc)).toEqual(plain(stored))
  })

  it('propagates load failures', async () => {
    const runtime = createCanvasCollabRuntime()
    repo.findState.mockResolvedValueOnce(err(databaseError()))
    expectErr(await runtime.load(PAGE, new Y.Doc()), 'DATABASE_ERROR')
    expectErr(
      await runtime.load('canvas.site-page.', new Y.Doc()),
      'CANVAS_COLLAB_NOT_FOUND',
    )
  })

  it('reconciles a loaded room with a document restored elsewhere', async () => {
    const runtime = createCanvasCollabRuntime()
    const ydoc = new Y.Doc()
    expect(expectOk(await runtime.reconcile(PAGE, ydoc))).toBe(false)
    expectOk(await runtime.load(PAGE, ydoc))
    expect(expectOk(await runtime.reconcile(PAGE, ydoc))).toBe(false)

    // Someone edits live, then a version is restored through REST.
    ydoc.transact(() => {
      const s1 = nodesOf(ydoc).get('s1') as Y.Map<unknown>
      ;(s1.get('props') as Y.Map<unknown>).set('anchor', 'ao-vivo')
    })
    stored = withText('restaurado')
    expect(expectOk(await runtime.reconcile(PAGE, ydoc))).toBe(true)
    const doc = docOf(ydoc)
    expect(doc.nodes.h1.props.text).toBe('restaurado')
    expect(doc.nodes.s1.props.anchor).toBe('ao-vivo')

    repo.findSitePage.mockResolvedValueOnce(err(databaseError()))
    expectErr(await runtime.reconcile(PAGE, ydoc), 'DATABASE_ERROR')
  })
})

describe('CanvasCollab runtime — store', () => {
  async function loaded(name = PAGE) {
    const runtime = createCanvasCollabRuntime()
    const ydoc = new Y.Doc()
    expectOk(await runtime.load(name, ydoc))
    return { runtime, ydoc }
  }

  const edit = (ydoc: Y.Doc, text: string) =>
    ydoc.transact(() => {
      const h1 = nodesOf(ydoc).get('h1') as Y.Map<unknown>
      ;(h1.get('props') as Y.Map<unknown>).set('text', text)
    })

  it('refuses rooms that were not loaded', async () => {
    const runtime = createCanvasCollabRuntime()
    expectErr(
      await runtime.store(PAGE, new Y.Doc(), 'u1'),
      'CANVAS_COLLAB_NOT_FOUND',
    )
  })

  it('refuses an empty Y document', async () => {
    const { runtime } = await loaded()
    expectErr(
      await runtime.store(PAGE, new Y.Doc(), 'u1'),
      'CANVAS_COLLAB_NOT_FOUND',
    )
  })

  it('saves only the Yjs state when the document did not change', async () => {
    const { runtime, ydoc } = await loaded()
    expect(expectOk(await runtime.store(PAGE, ydoc, 'u1'))).toBe('unchanged')
    expect(pages.update).not.toHaveBeenCalled()
    expect(repo.saveState).toHaveBeenCalledTimes(1)
    expect(expectOk(await runtime.store(PAGE, ydoc, 'u1'))).toBe('unchanged')
    expect(repo.saveState).toHaveBeenCalledTimes(1)
  })

  it('writes a changed page through the page service', async () => {
    const { runtime, ydoc } = await loaded()
    edit(ydoc, 'ao vivo')
    expect(expectOk(await runtime.store(PAGE, ydoc, 'u1'))).toBe('saved')
    const [actor, ws, site, page, dto] = pages.update.mock.calls[0]
    expect([actor, ws, site, page]).toEqual(['u1', WS, 's1', 'p1'])
    expect(
      (dto.document as unknown as CanvasDocument).nodes.h1.props.text,
    ).toBe('ao vivo')
    const saved = repo.saveState.mock.calls[0][0]
    expect(saved).toMatchObject({ documentName: PAGE, workspaceId: WS })
    expect(saved.documentHash).toBe(documentHash(docOf(ydoc)))
  })

  it('writes globals and e-mail templates through their services', async () => {
    const global = await loaded(GLOBAL)
    edit(global.ydoc, 'cabeçalho')
    expectOk(await global.runtime.store(GLOBAL, global.ydoc, 'u1'))
    expect(globals.update).toHaveBeenCalledWith(
      'u1',
      WS,
      's1',
      'g1',
      expect.anything(),
    )

    stored = createEmailDocumentFromLayout('newsletter')
    const email = await loaded(EMAIL)
    email.ydoc.transact(() => {
      const root = nodesOf(email.ydoc).get('root') as Y.Map<unknown>
      ;(root.get('props') as Y.Map<unknown>).set('preheader', 'novo')
    })
    expectOk(await email.runtime.store(EMAIL, email.ydoc, 'u2'))
    expect(templates.update).toHaveBeenCalledWith(
      'u2',
      WS,
      't1',
      expect.objectContaining({ builderDocument: expect.anything() }),
    )
  })

  it('mirrors what the service normalized into the shared state', async () => {
    const { runtime, ydoc } = await loaded()
    edit(ydoc, '  com espaços  ')
    pages.update.mockResolvedValueOnce(
      ok({ document: withText('com espaços') } as never),
    )
    expectOk(await runtime.store(PAGE, ydoc, 'u1'))
    expect(docOf(ydoc).nodes.h1.props.text).toBe('com espaços')
  })

  it('reverts everyone to the last stored document when the service refuses', async () => {
    const { runtime, ydoc } = await loaded()
    const updates: unknown[] = []
    ydoc.on('update', (_u: Uint8Array, origin: unknown) => updates.push(origin))
    edit(ydoc, 'inválido')
    pages.update.mockResolvedValueOnce(
      err(appError('SITE_DOCUMENT_INVALID', 'x')),
    )
    expect(expectOk(await runtime.store(PAGE, ydoc, 'u1'))).toBe('reverted')
    expect(docOf(ydoc).nodes.h1.props.text).toBe('Olá')
    expect(updates).toContain(SERVER_ORIGIN)

    edit(ydoc, 'sem permissão')
    pages.update.mockResolvedValueOnce(err(forbidden()))
    expect(expectOk(await runtime.store(PAGE, ydoc, 'u1'))).toBe('reverted')
  })

  it('keeps the change and reports database failures', async () => {
    const { runtime, ydoc } = await loaded()
    edit(ydoc, 'depois')
    pages.update.mockResolvedValueOnce(err(databaseError()))
    expectErr(await runtime.store(PAGE, ydoc, 'u1'), 'DATABASE_ERROR')
    expect(docOf(ydoc).nodes.h1.props.text).toBe('depois')

    repo.findSitePage.mockResolvedValueOnce(err(databaseError()))
    expectErr(await runtime.store(PAGE, ydoc, 'u1'), 'DATABASE_ERROR')

    repo.saveState.mockResolvedValueOnce(err(databaseError()))
    expectErr(await runtime.store(PAGE, ydoc, 'u1'), 'DATABASE_ERROR')
  })

  it('saves a converted v1 e-mail template on the first store', async () => {
    stored = createBuilderDocument('newsletter') as never
    const runtime = createCanvasCollabRuntime()
    const ydoc = new Y.Doc()
    expectOk(await runtime.load(EMAIL, ydoc))
    expect(runtime.rooms.get(EMAIL)?.hash).toBe('')
    expect(expectOk(await runtime.reconcile(EMAIL, ydoc))).toBe(false)
    expect(expectOk(await runtime.store(EMAIL, ydoc, 'u1'))).toBe('saved')
    expect(templates.update).toHaveBeenCalledTimes(1)
  })

  it('forgets a room on unload', async () => {
    const { runtime, ydoc } = await loaded()
    runtime.unload(PAGE)
    expectErr(await runtime.store(PAGE, ydoc, 'u1'), 'CANVAS_COLLAB_NOT_FOUND')
  })
})
