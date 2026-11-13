import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmLead } from '@/src/__tests__/factories/crm-lead.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { moduleDisabled } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/src/services/authz', () => ({
  assertModuleEnabled: vi.fn(),
  assertModuleMember: vi.fn(),
}))
vi.mock('@/src/repositories/crm-lead.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/services/whatsapp-conversation.service', () => ({
  WhatsAppConversationService: { start: vi.fn() },
}))

import { CrmLeadRepository } from '@/src/repositories/crm-lead.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { assertModuleEnabled, assertModuleMember } from '@/src/services/authz'
import { WhatsAppConversationService } from '@/src/services/whatsapp-conversation.service'
import { ensureLeadContact, syncLeadContacts } from '../crm-lead-contact-sync'
import {
  CrmLeadWhatsappService,
  pickLeadConnection,
} from '../crm-lead-whatsapp.service'

const leadRepo = vi.mocked(CrmLeadRepository)
const connRepo = vi.mocked(WhatsAppConnectionRepository)
const contactRepo = vi.mocked(WhatsAppContactRepository)
const start = vi.mocked(WhatsAppConversationService.start)

const zapi = createFakeWhatsAppConnection({
  id: 'zapi',
  provider: 'ZAPI',
  status: 'CONNECTED',
})
const meta = createFakeWhatsAppConnection({
  id: 'meta',
  provider: 'META',
  status: 'CONNECTED',
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(assertModuleMember).mockResolvedValue(ok({} as never))
  vi.mocked(assertModuleEnabled).mockResolvedValue(ok(true))
  leadRepo.findById.mockResolvedValue(
    ok(
      createFakeCrmLead({ id: 'l1', name: 'Ana', phones: ['+5511988887777'] }),
    ),
  )
  contactRepo.findManyByWaIds.mockResolvedValue(ok([]))
  contactRepo.create.mockImplementation(async (data) =>
    ok(createFakeWhatsAppContact({ id: 'c1', ...data })),
  )
  connRepo.listByWorkspace.mockResolvedValue(ok([meta, zapi]))
  start.mockResolvedValue(ok({ id: 'conv1' } as never))
})

describe('pickLeadConnection', () => {
  it('prefers a connected Z-API line, then any connected one', () => {
    expect(pickLeadConnection([meta, zapi])?.id).toBe('zapi')
    expect(pickLeadConnection([meta])?.id).toBe('meta')
    const down = { ...zapi, status: 'DISCONNECTED' as const }
    expect(pickLeadConnection([down, meta])?.id).toBe('meta')
    expect(pickLeadConnection([down])?.id).toBe('zapi')
    expect(pickLeadConnection([])).toBeNull()
  })
})

describe('ensureLeadContact', () => {
  it('creates a "Lead do CRM" contact for a new number', async () => {
    const result = expectOk(
      await ensureLeadContact('ws1', 'Ana', '(11) 98888-7777'),
    )
    expect(contactRepo.create).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      waId: '5511988887777',
      name: 'Ana',
      description: 'Lead do CRM',
    })
    expect(result?.id).toBe('c1')
  })

  it('reuses an existing contact and labels it only when it has no description', async () => {
    const existing = createFakeWhatsAppContact({
      id: 'c9',
      waId: '5511988887777',
      name: 'Ana Silva',
      description: null,
    })
    contactRepo.findManyByWaIds.mockResolvedValue(ok([existing]))
    contactRepo.update.mockResolvedValue(ok(existing))
    expectOk(await ensureLeadContact('ws1', 'Ana', '11988887777'))
    expect(contactRepo.create).not.toHaveBeenCalled()
    expect(contactRepo.update).toHaveBeenCalledWith('c9', {
      description: 'Lead do CRM',
    })

    contactRepo.update.mockClear()
    contactRepo.findManyByWaIds.mockResolvedValue(
      ok([{ ...existing, description: 'Cliente VIP' }]),
    )
    expectOk(await ensureLeadContact('ws1', 'Ana', '11988887777'))
    expect(contactRepo.update).not.toHaveBeenCalled()
  })

  it('ignores a phone that cannot be a WhatsApp number', async () => {
    expect(expectOk(await ensureLeadContact('ws1', 'Ana', '1234'))).toBeNull()
    expect(contactRepo.create).not.toHaveBeenCalled()
  })
})

describe('syncLeadContacts', () => {
  it('does nothing when Comunicação is not enabled', async () => {
    vi.mocked(assertModuleEnabled).mockResolvedValue(err(moduleDisabled()))
    await syncLeadContacts('ws1', 'Ana', ['11988887777'])
    expect(contactRepo.create).not.toHaveBeenCalled()
  })

  it('creates a contact per phone and never throws', async () => {
    await syncLeadContacts('ws1', 'Ana', ['11988887777', '1133334444'])
    expect(contactRepo.create).toHaveBeenCalledTimes(2)
    contactRepo.findManyByWaIds.mockRejectedValue(new Error('db down'))
    await expect(
      syncLeadContacts('ws1', 'Ana', ['11988887777']),
    ).resolves.toBeUndefined()
  })
})

describe('CrmLeadWhatsappService.open', () => {
  it('opens the conversation of the lead phone through a Z-API line', async () => {
    const result = expectOk(
      await CrmLeadWhatsappService.open('u1', 'ws1', 'l1', {
        phone: '+5511988887777',
      }),
    )
    expect(result).toEqual({ conversationId: 'conv1', contactId: 'c1' })
    expect(start).toHaveBeenCalledWith('u1', 'ws1', {
      contactId: 'c1',
      connectionId: 'zapi',
    })
  })

  it('defaults to the first phone and honors an explicit connection', async () => {
    expectOk(
      await CrmLeadWhatsappService.open('u1', 'ws1', 'l1', {
        connectionId: 'meta',
      }),
    )
    expect(start).toHaveBeenCalledWith('u1', 'ws1', {
      contactId: 'c1',
      connectionId: 'meta',
    })
  })

  it('rejects a phone the lead does not have', async () => {
    const error = expectErr(
      await CrmLeadWhatsappService.open('u1', 'ws1', 'l1', {
        phone: '11977776666',
      }),
    )
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(start).not.toHaveBeenCalled()
  })

  it('requires Comunicação, the lead and a connection', async () => {
    vi.mocked(assertModuleEnabled).mockResolvedValue(err(moduleDisabled()))
    expectErr(await CrmLeadWhatsappService.open('u1', 'ws1', 'l1'))

    vi.mocked(assertModuleEnabled).mockResolvedValue(ok(true))
    connRepo.listByWorkspace.mockResolvedValue(ok([]))
    expect(
      expectErr(await CrmLeadWhatsappService.open('u1', 'ws1', 'l1')).code,
    ).toBe('WHATSAPP_CONNECTION_NOT_FOUND')
  })

  it('passes along a refusal to open the conversation', async () => {
    start.mockResolvedValue(err({ code: 'FORBIDDEN', message: 'x' } as never))
    expect(
      expectErr(await CrmLeadWhatsappService.open('u1', 'ws1', 'l1')).code,
    ).toBe('FORBIDDEN')
  })
})
