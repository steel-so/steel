import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeCrmEmailSavedBlock,
  headingFragment,
} from '@/src/__tests__/factories/crm-email-editor.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { emailBlock } from '@/src/__tests__/helpers/email-canvas'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { crmEmailSavedBlockNotFound, databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-email-saved-block.repository')

import { auditMutation } from '@/lib/axiom/audit'
import { CrmEmailSavedBlockRepository } from '@/src/repositories/crm-email-saved-block.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import {
  CrmEmailSavedBlockService,
  SAVED_BLOCK_LIMIT,
} from '../crm-email-saved-block.service'

const membership = vi.mocked(MembershipRepository)
const repo = vi.mocked(CrmEmailSavedBlockRepository)
const audit = vi.mocked(auditMutation)

const WS = 'ws1'
const ACTOR = 'u1'

function asRole(role: 'MEMBER' | 'ADMIN' | 'OWNER' | 'VIEWER') {
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
}

const htmlFragment = () => ({
  rootId: 'h',
  nodes: { h: emailBlock({ type: 'email.html', id: 'h' }) },
})

beforeEach(() => {
  asRole('MEMBER')
  repo.count.mockResolvedValue(ok(0))
})

describe('CrmEmailSavedBlockService.list()', () => {
  it('lists the workspace blocks as DTOs', async () => {
    const block = createFakeCrmEmailSavedBlock()
    repo.list.mockResolvedValueOnce(ok([block]))
    const list = expectOk(
      await CrmEmailSavedBlockService.list(ACTOR, WS, 'cab'),
    )
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      id: block.id,
      kind: 'block',
      createdAt: '2026-10-14T12:00:00.000Z',
    })
    expect(repo.list).toHaveBeenCalledWith(WS, 'cab')
  })

  it('refuses non-members and propagates database errors', async () => {
    membership.findByUserAndWorkspace.mockResolvedValueOnce(ok(null))
    expectErr(await CrmEmailSavedBlockService.list(ACTOR, WS), 'FORBIDDEN')
    repo.list.mockResolvedValueOnce(err(databaseError('boom')))
    expectErr(await CrmEmailSavedBlockService.list(ACTOR, WS), 'DATABASE_ERROR')
  })
})

describe('CrmEmailSavedBlockService.create()', () => {
  it('validates the fragment, stores it normalized and audits', async () => {
    const fragment = headingFragment('Oi')
    repo.create.mockImplementationOnce(async (data) =>
      ok(
        createFakeCrmEmailSavedBlock({
          name: data.name,
          fragment: data.fragment as never,
        }),
      ),
    )
    const dto = expectOk(
      await CrmEmailSavedBlockService.create(ACTOR, WS, {
        name: 'Título',
        category: 'Cabeçalhos',
        fragment: fragment as never,
      }),
    )
    expect(dto.name).toBe('Título')
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        kind: 'block',
        nodeCount: 1,
        thumbnail: null,
        createdById: ACTOR,
      }),
    )
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'crm_email_saved_block',
        action: 'create',
      }),
    )
  })

  it('refuses an invalid fragment with every issue', async () => {
    const error = expectErr(
      await CrmEmailSavedBlockService.create(ACTOR, WS, {
        name: 'X',
        category: 'Outros',
        fragment: {
          rootId: 'c',
          nodes: { c: { id: 'c', type: 'email.column', props: {} } },
        },
      }),
      'CRM_EMAIL_SAVED_BLOCK_INVALID',
    )
    expect(error.details).toEqual({
      issues: ['Só seções e blocos de conteúdo podem ser salvos'],
    })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('only lets admins save an HTML block', async () => {
    expectErr(
      await CrmEmailSavedBlockService.create(ACTOR, WS, {
        name: 'HTML',
        category: 'Outros',
        fragment: htmlFragment() as never,
        thumbnail: 'https://cdn.example/x.png',
      }),
      'CRM_EMAIL_CANVAS_HTML_FORBIDDEN',
    )
    asRole('ADMIN')
    repo.create.mockResolvedValueOnce(ok(createFakeCrmEmailSavedBlock()))
    expectOk(
      await CrmEmailSavedBlockService.create(ACTOR, WS, {
        name: 'HTML',
        category: 'Outros',
        fragment: htmlFragment() as never,
        thumbnail: 'https://cdn.example/x.png',
      }),
    )
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ thumbnail: 'https://cdn.example/x.png' }),
    )
  })

  it('enforces the per-workspace limit', async () => {
    repo.count.mockResolvedValueOnce(ok(SAVED_BLOCK_LIMIT))
    expectErr(
      await CrmEmailSavedBlockService.create(ACTOR, WS, {
        name: 'X',
        category: 'Outros',
        fragment: headingFragment() as never,
      }),
      'CRM_EMAIL_SAVED_BLOCK_LIMIT_REACHED',
    )
  })

  it('refuses viewers and propagates database errors', async () => {
    const input = {
      name: 'X',
      category: 'Outros',
      fragment: headingFragment() as never,
    }
    asRole('VIEWER')
    expectErr(
      await CrmEmailSavedBlockService.create(ACTOR, WS, input),
      'FORBIDDEN',
    )
    asRole('MEMBER')
    repo.count.mockResolvedValueOnce(err(databaseError('boom')))
    expectErr(
      await CrmEmailSavedBlockService.create(ACTOR, WS, input),
      'DATABASE_ERROR',
    )
    repo.create.mockResolvedValueOnce(err(databaseError('boom')))
    expectErr(
      await CrmEmailSavedBlockService.create(ACTOR, WS, input),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmEmailSavedBlockService.update()', () => {
  it('renames a block of the workspace', async () => {
    const block = createFakeCrmEmailSavedBlock()
    repo.findById.mockResolvedValueOnce(ok(block))
    repo.update.mockResolvedValueOnce(ok({ ...block, name: 'Novo' }))
    const dto = expectOk(
      await CrmEmailSavedBlockService.update(ACTOR, WS, block.id, {
        name: 'Novo',
      }),
    )
    expect(dto.name).toBe('Novo')
    expect(repo.findById).toHaveBeenCalledWith(block.id, WS)
    expect(repo.update).toHaveBeenCalledWith(block.id, {
      name: 'Novo',
      category: undefined,
    })
  })

  it('refuses unknown or foreign blocks, viewers and DB errors', async () => {
    repo.findById.mockResolvedValueOnce(err(crmEmailSavedBlockNotFound()))
    expectErr(
      await CrmEmailSavedBlockService.update(ACTOR, WS, 'x', { name: 'a' }),
      'CRM_EMAIL_SAVED_BLOCK_NOT_FOUND',
    )
    asRole('VIEWER')
    expectErr(
      await CrmEmailSavedBlockService.update(ACTOR, WS, 'x', { name: 'a' }),
      'FORBIDDEN',
    )
    asRole('MEMBER')
    repo.findById.mockResolvedValueOnce(ok(createFakeCrmEmailSavedBlock()))
    repo.update.mockResolvedValueOnce(err(databaseError('boom')))
    expectErr(
      await CrmEmailSavedBlockService.update(ACTOR, WS, 'x', { name: 'a' }),
      'DATABASE_ERROR',
    )
  })
})

describe('CrmEmailSavedBlockService.remove()', () => {
  it('deletes a block of the workspace and audits', async () => {
    asRole('ADMIN')
    const block = createFakeCrmEmailSavedBlock()
    repo.findById.mockResolvedValueOnce(ok(block))
    repo.delete.mockResolvedValueOnce(ok(undefined))
    expectOk(await CrmEmailSavedBlockService.remove(ACTOR, WS, block.id))
    expect(repo.delete).toHaveBeenCalledWith(block.id)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', targetId: block.id }),
    )
  })

  it('refuses unknown blocks, viewers and DB errors', async () => {
    asRole('ADMIN')
    repo.findById.mockResolvedValueOnce(err(crmEmailSavedBlockNotFound()))
    expectErr(
      await CrmEmailSavedBlockService.remove(ACTOR, WS, 'x'),
      'CRM_EMAIL_SAVED_BLOCK_NOT_FOUND',
    )
    asRole('VIEWER')
    expectErr(
      await CrmEmailSavedBlockService.remove(ACTOR, WS, 'x'),
      'FORBIDDEN',
    )
    asRole('ADMIN')
    repo.findById.mockResolvedValueOnce(ok(createFakeCrmEmailSavedBlock()))
    repo.delete.mockResolvedValueOnce(err(databaseError('boom')))
    expectErr(
      await CrmEmailSavedBlockService.remove(ACTOR, WS, 'x'),
      'DATABASE_ERROR',
    )
  })
})
