import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmCustomFieldDefinition } from '@/src/__tests__/factories/crm-custom-field.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/crm-custom-field.repository')
vi.mock('@/src/repositories/workspace-module-access.repository')

import { CrmCustomFieldDefinitionRepository } from '@/src/repositories/crm-custom-field.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { WhatsAppContactFieldService } from '../whatsapp-contact-field.service'

const defs = vi.mocked(CrmCustomFieldDefinitionRepository)
const memberships = vi.mocked(MembershipRepository)

function asRole(role: 'OWNER' | 'ADMIN' | 'MEMBER') {
  memberships.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )
  vi.mocked(WorkspaceModuleAccessRepository.isEnabled).mockResolvedValue(
    ok(true),
  )
}

describe('WhatsAppContactFieldService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lets a member list the contact fields', async () => {
    asRole('MEMBER')
    defs.listByWorkspace.mockResolvedValue(
      ok([
        createFakeCrmCustomFieldDefinition({
          entity: 'WHATSAPP_CONTACT',
          label: 'CPF',
          type: 'CPF',
        }),
      ]),
    )

    const fields = expectOk(await WhatsAppContactFieldService.list('u1', 'ws1'))
    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({ label: 'CPF', type: 'CPF' })
    expect(defs.listByWorkspace).toHaveBeenCalledWith('ws1', {
      entity: 'WHATSAPP_CONTACT',
    })
  })

  it('forbids a plain member from creating a field', async () => {
    asRole('MEMBER')
    expectErr(
      await WhatsAppContactFieldService.create('u1', 'ws1', {
        label: 'CPF',
        type: 'CPF',
        options: [],
        required: false,
      }),
      'FORBIDDEN',
    )
    expect(defs.create).not.toHaveBeenCalled()
  })

  it('creates a field with a key derived from the label', async () => {
    asRole('ADMIN')
    defs.listByWorkspace.mockResolvedValue(ok([]))
    defs.create.mockResolvedValue(
      ok(
        createFakeCrmCustomFieldDefinition({
          entity: 'WHATSAPP_CONTACT',
          label: 'Razão Social',
          type: 'TEXT',
        }),
      ),
    )

    expectOk(
      await WhatsAppContactFieldService.create('u1', 'ws1', {
        label: 'Razão Social',
        type: 'TEXT',
        options: ['ignored'],
        required: true,
      }),
    )
    expect(defs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        entity: 'WHATSAPP_CONTACT',
        key: 'razao_social',
        options: [],
        required: true,
      }),
    )
  })

  it('stops at the field limit', async () => {
    asRole('OWNER')
    defs.listByWorkspace.mockResolvedValue(
      ok(
        Array.from({ length: 30 }, (_, i) =>
          createFakeCrmCustomFieldDefinition({ id: `f${i}` }),
        ),
      ),
    )
    expectErr(
      await WhatsAppContactFieldService.create('u1', 'ws1', {
        label: 'Mais um',
        type: 'TEXT',
        options: [],
        required: false,
      }),
      'CRM_CUSTOM_FIELD_INVALID',
    )
  })

  it('refuses to touch a definition that is not a contact field', async () => {
    asRole('ADMIN')
    defs.findById.mockResolvedValue(
      ok(createFakeCrmCustomFieldDefinition({ entity: 'COMPANY' })),
    )
    expectErr(
      await WhatsAppContactFieldService.remove('u1', 'ws1', 'f1'),
      'CRM_CUSTOM_FIELD_INVALID',
    )
    expect(defs.softDelete).not.toHaveBeenCalled()
  })
})
