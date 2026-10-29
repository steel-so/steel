import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeFlow,
  createFakeFlowResponse,
  createFakePublishedFlow,
} from '@/src/__tests__/factories/nov-z3-whatsapp-flows.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContactWithoutCount } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppMessage } from '@/src/__tests__/factories/whatsapp-message.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { err, ok } from '@/src/lib/result'
import { flowFromPreset } from '@/src/lib/whatsapp/flows/templates'

vi.mock('@/lib/axiom/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/repositories/whatsapp-flow.repository')
vi.mock('@/src/repositories/whatsapp-flow-response.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-conversation.repository')
vi.mock('@/src/repositories/whatsapp-message.repository')
vi.mock('@/src/repositories/crm-person.repository')
vi.mock('@/src/repositories/crm-company.repository')
vi.mock('../crm-lead.service', () => ({
  CrmLeadService: { intake: vi.fn() },
}))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn() },
}))
vi.mock('@/src/lib/whatsapp/realtime', () => ({
  publishWhatsAppEvent: vi.fn(async () => undefined),
}))

import { logger } from '@/lib/axiom/logger'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import { CrmCompanyRepository } from '@/src/repositories/crm-company.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppConversationRepository } from '@/src/repositories/whatsapp-conversation.repository'
import { WhatsAppFlowRepository } from '@/src/repositories/whatsapp-flow.repository'
import { WhatsAppFlowResponseRepository } from '@/src/repositories/whatsapp-flow-response.repository'
import { WhatsAppMessageRepository } from '@/src/repositories/whatsapp-message.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmLeadService } from '../crm-lead.service'
import { WhatsAppFlowResponseService } from '../whatsapp-flow-response.service'

const flowRepo = vi.mocked(WhatsAppFlowRepository)
const responseRepo = vi.mocked(WhatsAppFlowResponseRepository)
const contactRepo = vi.mocked(WhatsAppContactRepository)
const conversationRepo = vi.mocked(WhatsAppConversationRepository)
const messageRepo = vi.mocked(WhatsAppMessageRepository)
const personRepo = vi.mocked(CrmPersonRepository)
const companyRepo = vi.mocked(CrmCompanyRepository)
const leads = vi.mocked(CrmLeadService)
const send = vi.mocked(WhatsAppSend)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)

const dbErr = () => err({ code: 'DATABASE_ERROR' as const, message: 'x' })

const contact = createFakeWhatsAppContactWithoutCount({
  id: 'ct1',
  workspaceId: 'ws1',
  waId: '5511988887777',
  name: 'Maria',
})
const connection = createFakeWhatsAppConnection({ id: 'conn1' })

const reply = (answers: Record<string, unknown>, token = 'stlf.flow1.n1') =>
  JSON.stringify({ flow_token: token, ...answers })

const input = (responseJson: string) => ({
  workspaceId: 'ws1',
  connection,
  contact,
  conversationId: 'conv1',
  messageId: 'msg1',
  responseJson,
})

const signUpAnswers = {
  nome: 'Ana Souza',
  email: 'ana@x.com',
  telefone: '11999990000',
  empresa: 'ACME',
  consentimento: true,
}

const flowRow = (overrides = {}) =>
  createFakePublishedFlow({
    id: 'flow1',
    workspaceId: 'ws1',
    createdByUserId: 'owner1',
    ...overrides,
  })

beforeEach(() => {
  vi.resetAllMocks()
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
  const pending = createFakeFlowResponse({
    id: 'resp1',
    flowId: 'flow1',
    flowToken: 'stlf.flow1.n1',
  })
  responseRepo.findByToken.mockResolvedValue(ok(pending))
  flowRepo.findById.mockResolvedValue(ok(flowRow()))
  responseRepo.complete.mockResolvedValue(
    ok({ ...pending, status: 'COMPLETED' as const }),
  )
  responseRepo.setMapping.mockResolvedValue(ok(pending))
  contactRepo.update.mockResolvedValue(ok(contact))
  messageRepo.update.mockResolvedValue(ok(createFakeWhatsAppMessage()))
  messageRepo.create.mockResolvedValue(ok(createFakeWhatsAppMessage()))
  conversationRepo.update.mockResolvedValue(ok({} as never))
  send.text.mockResolvedValue(ok({ providerMessageId: 'pm-thanks' }))
  leads.intake.mockResolvedValue(
    ok({ lead: { id: 'lead1' }, created: true } as never),
  )
})

describe('WhatsAppFlowResponseService.handleInbound', () => {
  it('stores the answers, creates the lead and thanks the contact', async () => {
    const outcome = expectOk(
      await WhatsAppFlowResponseService.handleInbound(
        input(reply(signUpAnswers)),
      ),
    )
    expect(outcome.handled).toBe(true)
    expect(outcome.text).toContain('Formulário respondido: Cadastro')
    expect(outcome.text).toContain('E-mail: ana@x.com')

    expect(responseRepo.complete).toHaveBeenCalledWith(
      'resp1',
      expect.objectContaining({
        conversationId: 'conv1',
        answers: expect.objectContaining({ nome: 'Ana Souza' }),
      }),
    )
    expect(leads.intake).toHaveBeenCalledWith(
      'ws1',
      expect.objectContaining({
        kind: 'system',
        via: 'whatsapp_flow',
        createdById: 'owner1',
        refId: 'resp1',
      }),
      expect.objectContaining({
        name: 'Ana Souza',
        emails: ['ana@x.com'],
        phones: ['11999990000'],
        company: 'ACME',
        channel: 'WhatsApp',
      }),
    )
    expect(responseRepo.setMapping).toHaveBeenCalledWith('resp1', {
      createdLeadId: 'lead1',
      createdPersonId: null,
      createdCompanyId: null,
      mappingNote: null,
    })
    expect(messageRepo.update).toHaveBeenCalledWith('msg1', {
      text: expect.stringContaining('Formulário respondido'),
    })

    // The thank-you only goes out when the webhook says so.
    expect(send.text).not.toHaveBeenCalled()
    await outcome.afterPublish?.()
    expect(send.text).toHaveBeenCalledWith(
      connection,
      {
        to: '5511988887777',
        text: 'Recebemos seu cadastro. Em breve entramos em contato.',
      },
      expect.anything(),
    )
    expect(messageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'OUT',
        providerMessageId: 'pm-thanks',
      }),
    )
    expect(conversationRepo.update).toHaveBeenCalled()
  })

  it('uses the contact phone when the form did not ask for one', async () => {
    await WhatsAppFlowResponseService.handleInbound(
      input(reply({ nome: 'Ana', email: 'ana@x.com' })),
    )
    expect(leads.intake.mock.calls[0][2]).toMatchObject({
      phones: ['5511988887777'],
    })
  })

  it('names the lead after the contact when the form has no name', async () => {
    flowRepo.findById.mockResolvedValue(
      ok(
        flowRow({
          definition: {
            screens: [
              {
                title: 'T',
                fields: [
                  {
                    key: 'email',
                    label: 'E-mail',
                    type: 'email',
                    required: false,
                    mapping: { target: 'lead', attribute: 'email' },
                  },
                ],
              },
            ],
          },
          publishedDefinition: null,
        }),
      ),
    )
    await WhatsAppFlowResponseService.handleInbound(
      input(reply({ email: 'a@x.com' })),
    )
    expect(leads.intake.mock.calls[0][2]).toMatchObject({ name: 'Maria' })
  })

  it('does not use a BSUID as the phone', async () => {
    const bsuidContact = { ...contact, waId: 'BR.123abc', name: null }
    await WhatsAppFlowResponseService.handleInbound({
      ...input(reply({ email: 'a@x.com' })),
      contact: bsuidContact,
    })
    expect(leads.intake.mock.calls[0][2]).toMatchObject({
      phones: [],
      name: 'Sem nome',
    })
  })

  it('updates the WhatsApp contact name from a mapped field', async () => {
    flowRepo.findById.mockResolvedValue(
      ok(
        flowRow({
          ...flowFromPreset('APPOINTMENT'),
          crmAction: 'NONE',
        } as never),
      ),
    )
    flowRepo.findById.mockResolvedValue(
      ok(
        flowRow({
          definition: flowFromPreset('APPOINTMENT').definition,
          publishedDefinition: flowFromPreset('APPOINTMENT').definition,
          crmAction: 'NONE',
          confirmationText: null,
        }),
      ),
    )
    const outcome = expectOk(
      await WhatsAppFlowResponseService.handleInbound(
        input(
          reply({
            nome: 'Maria Souza',
            servico: 'consulta',
            data: '2026-11-03',
            periodo: 'manha',
          }),
        ),
      ),
    )
    expect(contactRepo.update).toHaveBeenCalledWith('ct1', {
      name: 'Maria Souza',
    })
    expect(leads.intake).not.toHaveBeenCalled()
    expect(outcome.afterPublish).toBeUndefined()
  })

  it('leaves the contact alone when the name is unchanged or the update fails', async () => {
    flowRepo.findById.mockResolvedValue(
      ok(
        flowRow({
          definition: flowFromPreset('APPOINTMENT').definition,
          publishedDefinition: flowFromPreset('APPOINTMENT').definition,
          crmAction: 'NONE',
        }),
      ),
    )
    await WhatsAppFlowResponseService.handleInbound(
      input(reply({ nome: 'Maria' })),
    )
    expect(contactRepo.update).not.toHaveBeenCalled()

    contactRepo.update.mockResolvedValue(dbErr())
    responseRepo.complete.mockResolvedValue(
      ok(createFakeFlowResponse({ status: 'COMPLETED' })),
    )
    expectOk(
      await WhatsAppFlowResponseService.handleInbound(
        input(reply({ nome: 'Outra Pessoa' })),
      ),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      'whatsapp.flow.contact_update_failed',
      expect.objectContaining({ contactId: 'ct1' }),
    )
  })

  describe('CRM mapping', () => {
    it('explains when the lead could not be created', async () => {
      leads.intake.mockResolvedValue(
        err({
          code: 'VALIDATION_ERROR' as const,
          message: 'Telefone inválido',
        }),
      )
      expectOk(
        await WhatsAppFlowResponseService.handleInbound(
          input(reply(signUpAnswers)),
        ),
      )
      expect(responseRepo.setMapping).toHaveBeenCalledWith(
        'resp1',
        expect.objectContaining({
          createdLeadId: null,
          mappingNote: 'Lead não criado: Telefone inválido',
        }),
      )
    })

    it('keeps the answer only when the CRM module is off', async () => {
      moduleAccess.isEnabled.mockResolvedValue(ok(false))
      expectOk(
        await WhatsAppFlowResponseService.handleInbound(
          input(reply(signUpAnswers)),
        ),
      )
      expect(leads.intake).not.toHaveBeenCalled()
      expect(responseRepo.setMapping.mock.calls[0][1].mappingNote).toContain(
        'CRM está desabilitado',
      )
    })

    it('keeps the answer only when the flow has no owner', async () => {
      flowRepo.findById.mockResolvedValue(
        ok(flowRow({ createdByUserId: null })),
      )
      expectOk(
        await WhatsAppFlowResponseService.handleInbound(
          input(reply(signUpAnswers)),
        ),
      )
      expect(leads.intake).not.toHaveBeenCalled()
      expect(responseRepo.setMapping.mock.calls[0][1].mappingNote).toContain(
        'responsável',
      )
    })

    const personFlow = () =>
      flowRow({
        crmAction: 'PERSON',
        definition: {
          screens: [
            {
              title: 'T',
              fields: [
                {
                  key: 'nome',
                  label: 'Nome',
                  type: 'text',
                  required: false,
                  mapping: { target: 'person', attribute: 'name' },
                },
                {
                  key: 'email',
                  label: 'E-mail',
                  type: 'email',
                  required: false,
                  mapping: { target: 'person', attribute: 'email' },
                },
                {
                  key: 'cidade',
                  label: 'Cidade',
                  type: 'text',
                  required: false,
                  mapping: { target: 'person', attribute: 'city' },
                },
              ],
            },
          ],
        },
        publishedDefinition: null,
      })

    it('creates a person', async () => {
      flowRepo.findById.mockResolvedValue(ok(personFlow()))
      personRepo.create.mockResolvedValue(ok({ id: 'person1' } as never))
      expectOk(
        await WhatsAppFlowResponseService.handleInbound(
          input(reply({ nome: 'Ana', email: 'a@x.com', cidade: 'Recife' })),
        ),
      )
      expect(personRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws1',
          createdById: 'owner1',
          name: 'Ana',
          emails: ['a@x.com'],
          phones: ['5511988887777'],
          city: 'Recife',
        }),
      )
      expect(responseRepo.setMapping.mock.calls[0][1]).toMatchObject({
        createdPersonId: 'person1',
      })
    })

    it('falls back to the contact when the person has no name or phone', async () => {
      flowRepo.findById.mockResolvedValue(ok(personFlow()))
      personRepo.create.mockResolvedValue(ok({ id: 'person1' } as never))
      await WhatsAppFlowResponseService.handleInbound({
        ...input(reply({})),
        contact: { ...contact, waId: 'BR.1', name: null },
      })
      expect(personRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Sem nome', phones: [], emails: [] }),
      )
    })

    it('explains a person that could not be created', async () => {
      flowRepo.findById.mockResolvedValue(ok(personFlow()))
      personRepo.create.mockResolvedValue(dbErr())
      await WhatsAppFlowResponseService.handleInbound(
        input(reply({ nome: 'A' })),
      )
      expect(responseRepo.setMapping.mock.calls[0][1].mappingNote).toContain(
        'Pessoa não criada',
      )
    })

    const companyFlow = () =>
      flowRow({
        crmAction: 'COMPANY',
        definition: {
          screens: [
            {
              title: 'T',
              fields: [
                {
                  key: 'razao',
                  label: 'Empresa',
                  type: 'text',
                  required: false,
                  mapping: { target: 'company', attribute: 'name' },
                },
                {
                  key: 'funcs',
                  label: 'Funcionários',
                  type: 'number',
                  required: false,
                  mapping: { target: 'company', attribute: 'employees' },
                },
                {
                  key: 'arr',
                  label: 'Receita',
                  type: 'number',
                  required: false,
                  mapping: { target: 'company', attribute: 'arr' },
                },
              ],
            },
          ],
        },
        publishedDefinition: null,
      })

    it('creates a company with numeric attributes', async () => {
      flowRepo.findById.mockResolvedValue(ok(companyFlow()))
      companyRepo.create.mockResolvedValue(ok({ id: 'co1' } as never))
      await WhatsAppFlowResponseService.handleInbound(
        input(reply({ razao: 'ACME', funcs: '40', arr: '1200' })),
      )
      expect(companyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'ACME', employees: 40, arr: 1200 }),
      )
      expect(responseRepo.setMapping.mock.calls[0][1]).toMatchObject({
        createdCompanyId: 'co1',
      })
    })

    it('ignores numbers that are not numbers and names an unnamed company', async () => {
      flowRepo.findById.mockResolvedValue(ok(companyFlow()))
      companyRepo.create.mockResolvedValue(ok({ id: 'co1' } as never))
      await WhatsAppFlowResponseService.handleInbound(
        input(reply({ funcs: 'muitos', arr: 'x' })),
      )
      expect(companyRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Sem nome',
          employees: undefined,
          arr: undefined,
        }),
      )
    })

    it('explains a company that could not be created', async () => {
      flowRepo.findById.mockResolvedValue(ok(companyFlow()))
      companyRepo.create.mockResolvedValue(dbErr())
      await WhatsAppFlowResponseService.handleInbound(input(reply({})))
      expect(responseRepo.setMapping.mock.calls[0][1].mappingNote).toContain(
        'Empresa não criada',
      )
    })
  })

  describe('finding the send', () => {
    it('is not handled when the reply is not JSON', async () => {
      expect(
        expectOk(
          await WhatsAppFlowResponseService.handleInbound(input('nope')),
        ),
      ).toEqual({ handled: false })
    })

    it('answers the newest pending flow when the token is not ours', async () => {
      responseRepo.findByToken.mockResolvedValue(ok(null))
      responseRepo.findLatestOpenByConversation.mockResolvedValue(
        ok(createFakeFlowResponse({ id: 'resp2', flowId: 'flow1' })),
      )
      const outcome = expectOk(
        await WhatsAppFlowResponseService.handleInbound(
          input(reply(signUpAnswers, 'unused')),
        ),
      )
      expect(outcome.handled).toBe(true)
      expect(responseRepo.complete).toHaveBeenCalledWith(
        'resp2',
        expect.anything(),
      )
    })

    it('finds the pending flow when the reply carries no token at all', async () => {
      responseRepo.findLatestOpenByConversation.mockResolvedValue(
        ok(createFakeFlowResponse({ id: 'resp3', flowId: 'flow1' })),
      )
      const outcome = expectOk(
        await WhatsAppFlowResponseService.handleInbound(
          input(JSON.stringify(signUpAnswers)),
        ),
      )
      expect(outcome.handled).toBe(true)
      expect(responseRepo.findByToken).not.toHaveBeenCalled()
    })

    it('rebuilds the send from the flow id inside the token', async () => {
      responseRepo.findByToken.mockResolvedValue(ok(null))
      responseRepo.findLatestOpenByConversation.mockResolvedValue(ok(null))
      responseRepo.create.mockResolvedValue(
        ok(createFakeFlowResponse({ id: 'resp4', flowId: 'flow1' })),
      )
      const outcome = expectOk(
        await WhatsAppFlowResponseService.handleInbound(
          input(reply(signUpAnswers, 'stlf.flow1.lost')),
        ),
      )
      expect(outcome.handled).toBe(true)
      expect(responseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          flowId: 'flow1',
          contactId: 'ct1',
          conversationId: 'conv1',
          flowToken: 'stlf.flow1.lost',
        }),
      )
    })

    it('is not handled when there is no token and nothing is pending', async () => {
      responseRepo.findLatestOpenByConversation.mockResolvedValue(ok(null))
      expect(
        expectOk(
          await WhatsAppFlowResponseService.handleInbound(
            input(JSON.stringify(signUpAnswers)),
          ),
        ).handled,
      ).toBe(false)
      expect(responseRepo.create).not.toHaveBeenCalled()
    })

    it('is not handled when the flow named by the token is gone', async () => {
      responseRepo.findByToken.mockResolvedValue(ok(null))
      responseRepo.findLatestOpenByConversation.mockResolvedValue(ok(null))
      flowRepo.findById.mockResolvedValue(ok(null))
      expect(
        expectOk(
          await WhatsAppFlowResponseService.handleInbound(
            input(reply(signUpAnswers, 'stlf.gone.x')),
          ),
        ).handled,
      ).toBe(false)
    })

    it('is not handled for a token of nobody', async () => {
      responseRepo.findByToken.mockResolvedValue(ok(null))
      responseRepo.findLatestOpenByConversation.mockResolvedValue(ok(null))
      expect(
        expectOk(
          await WhatsAppFlowResponseService.handleInbound(
            input(reply(signUpAnswers, 'whatever')),
          ),
        ).handled,
      ).toBe(false)
    })

    it('ignores a retry of an answer already stored', async () => {
      responseRepo.complete.mockResolvedValue(ok(null))
      const outcome = expectOk(
        await WhatsAppFlowResponseService.handleInbound(
          input(reply(signUpAnswers)),
        ),
      )
      expect(outcome).toEqual({ handled: true })
      expect(leads.intake).not.toHaveBeenCalled()
      expect(messageRepo.update).not.toHaveBeenCalled()
    })
  })

  describe('failures', () => {
    it('propagates lookup failures', async () => {
      responseRepo.findByToken.mockResolvedValue(dbErr())
      expectErr(
        await WhatsAppFlowResponseService.handleInbound(input(reply({}))),
        'DATABASE_ERROR',
      )
      responseRepo.findByToken.mockResolvedValue(ok(null))
      responseRepo.findLatestOpenByConversation.mockResolvedValue(dbErr())
      expectErr(
        await WhatsAppFlowResponseService.handleInbound(input(reply({}))),
        'DATABASE_ERROR',
      )
      responseRepo.findLatestOpenByConversation.mockResolvedValue(ok(null))
      flowRepo.findById.mockResolvedValue(dbErr())
      expectErr(
        await WhatsAppFlowResponseService.handleInbound(
          input(reply({}, 'stlf.flow1.x')),
        ),
        'DATABASE_ERROR',
      )
      flowRepo.findById.mockResolvedValue(ok(createFakeFlow({ id: 'flow1' })))
      responseRepo.create.mockResolvedValue(dbErr())
      expectErr(
        await WhatsAppFlowResponseService.handleInbound(
          input(reply({}, 'stlf.flow1.x')),
        ),
        'DATABASE_ERROR',
      )
    })

    it('propagates storage failures', async () => {
      responseRepo.complete.mockResolvedValue(dbErr())
      expectErr(
        await WhatsAppFlowResponseService.handleInbound(input(reply({}))),
        'DATABASE_ERROR',
      )
      responseRepo.complete.mockResolvedValue(
        ok(createFakeFlowResponse({ status: 'COMPLETED' })),
      )
      responseRepo.setMapping.mockResolvedValue(dbErr())
      expectErr(
        await WhatsAppFlowResponseService.handleInbound(input(reply({}))),
        'DATABASE_ERROR',
      )
    })

    it('still answers when the timeline message cannot be rewritten', async () => {
      messageRepo.update.mockResolvedValue(dbErr())
      const outcome = expectOk(
        await WhatsAppFlowResponseService.handleInbound(
          input(reply(signUpAnswers)),
        ),
      )
      expect(outcome.handled).toBe(true)
      expect(logger.warn).toHaveBeenCalledWith(
        'whatsapp.flow.annotate_failed',
        expect.anything(),
      )
    })

    it('words an empty answer without a summary', async () => {
      const outcome = expectOk(
        await WhatsAppFlowResponseService.handleInbound(input(reply({}))),
      )
      expect(outcome.text).toBe('Formulário respondido: Cadastro')
    })
  })

  describe('thank-you message', () => {
    it('does not break when Meta refuses the text', async () => {
      send.text.mockResolvedValue(
        err({ code: 'WHATSAPP_PROVIDER_ERROR' as const, message: 'x' }),
      )
      const outcome = expectOk(
        await WhatsAppFlowResponseService.handleInbound(input(reply({}))),
      )
      await outcome.afterPublish?.()
      expect(logger.warn).toHaveBeenCalledWith(
        'whatsapp.flow.confirmation_failed',
        expect.objectContaining({ conversationId: 'conv1' }),
      )
      expect(messageRepo.create).not.toHaveBeenCalled()
    })

    it('stops quietly when the message cannot be stored', async () => {
      messageRepo.create.mockResolvedValue(dbErr())
      const outcome = expectOk(
        await WhatsAppFlowResponseService.handleInbound(input(reply({}))),
      )
      await outcome.afterPublish?.()
      expect(conversationRepo.update).not.toHaveBeenCalled()
    })
  })
})
