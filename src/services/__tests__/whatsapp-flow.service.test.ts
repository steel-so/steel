import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmForm } from '@/src/__tests__/factories/crm-form.factory'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeFlow,
  createFakeFlowResponse,
  createFakePublishedFlow,
} from '@/src/__tests__/factories/nov-z3-whatsapp-flows.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppTemplate } from '@/src/__tests__/factories/whatsapp-template.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { notFound } from '@/src/errors'
import { err, ok } from '@/src/lib/result'
import { flowFromPreset } from '@/src/lib/whatsapp/flows/templates'
import type { FlowDefinition } from '@/src/schemas/whatsapp-flow.schema'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-flow.repository')
vi.mock('@/src/repositories/whatsapp-flow-response.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-template.repository')
vi.mock('@/src/repositories/crm-form.repository')
vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: vi.fn(async () => 'access-token'),
}))
vi.mock('@/src/lib/whatsapp/meta-flows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/whatsapp/meta-flows')>()),
  createMetaFlow: vi.fn(),
  uploadMetaFlowJson: vi.fn(),
  publishMetaFlow: vi.fn(),
  deprecateMetaFlow: vi.fn(),
  deleteMetaFlow: vi.fn(),
  getMetaFlow: vi.fn(),
}))
vi.mock('@/src/lib/whatsapp/meta-templates', () => ({
  createMetaTemplate: vi.fn(),
}))
vi.mock('../whatsapp-message.service', () => ({
  WhatsAppMessageService: { sendFlow: vi.fn() },
}))

import {
  createMetaFlow,
  deleteMetaFlow,
  deprecateMetaFlow,
  getMetaFlow,
  MetaFlowError,
  publishMetaFlow,
  uploadMetaFlowJson,
} from '@/src/lib/whatsapp/meta-flows'
import { createMetaTemplate } from '@/src/lib/whatsapp/meta-templates'
import { CrmFormRepository } from '@/src/repositories/crm-form.repository'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppFlowRepository } from '@/src/repositories/whatsapp-flow.repository'
import { WhatsAppFlowResponseRepository } from '@/src/repositories/whatsapp-flow-response.repository'
import { WhatsAppTemplateRepository } from '@/src/repositories/whatsapp-template.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { WhatsAppFlowService } from '../whatsapp-flow.service'
import { WhatsAppMessageService } from '../whatsapp-message.service'

const membershipRepo = vi.mocked(MembershipRepository)
const flowRepo = vi.mocked(WhatsAppFlowRepository)
const responseRepo = vi.mocked(WhatsAppFlowResponseRepository)
const connectionRepo = vi.mocked(WhatsAppConnectionRepository)
const templateRepo = vi.mocked(WhatsAppTemplateRepository)
const crmFormRepo = vi.mocked(CrmFormRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const messages = vi.mocked(WhatsAppMessageService)
const metaCreate = vi.mocked(createMetaFlow)
const metaUpload = vi.mocked(uploadMetaFlowJson)
const metaPublish = vi.mocked(publishMetaFlow)
const metaDeprecate = vi.mocked(deprecateMetaFlow)
const metaDelete = vi.mocked(deleteMetaFlow)
const metaGet = vi.mocked(getMetaFlow)
const metaTemplate = vi.mocked(createMetaTemplate)

const dbErr = () => err({ code: 'DATABASE_ERROR' as const, message: 'x' })

const asRole = (role: 'OWNER' | 'ADMIN' | 'MEMBER') =>
  membershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role })),
  )

const metaConnection = (overrides = {}) =>
  createFakeWhatsAppConnection({
    provider: 'META',
    metaPhoneNumberId: 'phone-1',
    metaWabaId: 'waba-1',
    encryptedMetaAccessToken: 'enc:token',
    ...overrides,
  })

const createInput = {
  name: 'Cadastro',
  connectionId: 'conn-1',
  category: 'OTHER' as const,
  preset: 'SIGN_UP' as const,
}

beforeEach(() => {
  vi.resetAllMocks()
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
})

describe('WhatsAppFlowService authorization', () => {
  it('lets any member read but only admins change', async () => {
    asRole('MEMBER')
    flowRepo.listByWorkspace.mockResolvedValue(ok([]))
    responseRepo.countsByFlow.mockResolvedValue(ok([]))
    expectOk(await WhatsAppFlowService.list('u', 'ws'))

    expectErr(
      await WhatsAppFlowService.create('u', 'ws', createInput),
      'FORBIDDEN',
    )
    expectErr(
      await WhatsAppFlowService.update('u', 'ws', 'f', { name: 'x' }),
      'FORBIDDEN',
    )
    expectErr(await WhatsAppFlowService.remove('u', 'ws', 'f'), 'FORBIDDEN')
    expectErr(
      await WhatsAppFlowService.publish('u', 'ws', 'f', { publish: true }),
      'FORBIDDEN',
    )
    expectErr(await WhatsAppFlowService.deprecate('u', 'ws', 'f'), 'FORBIDDEN')
    expectErr(await WhatsAppFlowService.preview('u', 'ws', 'f'), 'FORBIDDEN')
    expectErr(
      await WhatsAppFlowService.createTemplate('u', 'ws', 'f', {
        name: 'n',
        language: 'pt_BR',
        category: 'UTILITY',
        body: 'b',
        buttonText: 'x',
      }),
      'FORBIDDEN',
    )
  })

  it('refuses non-members everywhere', async () => {
    membershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
    expectErr(await WhatsAppFlowService.list('u', 'ws'), 'FORBIDDEN')
    expectErr(await WhatsAppFlowService.get('u', 'ws', 'f'), 'FORBIDDEN')
    expectErr(await WhatsAppFlowService.metaJson('u', 'ws', 'f'), 'FORBIDDEN')
    expectErr(
      await WhatsAppFlowService.listResponses('u', 'ws', 'f', { limit: 10 }),
      'FORBIDDEN',
    )
    expectErr(
      await WhatsAppFlowService.send('u', 'ws', 'f', { conversationId: 'c' }),
      'FORBIDDEN',
    )
  })

  it('is hidden when the Comunicação module is off', async () => {
    asRole('ADMIN')
    moduleAccess.isEnabled.mockResolvedValue(ok(false))
    expectErr(await WhatsAppFlowService.list('u', 'ws'), 'MODULE_DISABLED')
  })
})

describe('list() and get()', () => {
  beforeEach(() => asRole('MEMBER'))

  it('adds sent and completed counters per flow', async () => {
    const a = createFakeFlow()
    const b = createFakeFlow()
    flowRepo.listByWorkspace.mockResolvedValue(ok([a, b]))
    responseRepo.countsByFlow.mockResolvedValue(
      ok([
        { flowId: a.id, status: 'SENT', count: 2 },
        { flowId: a.id, status: 'COMPLETED', count: 3 },
        { flowId: 'other', status: 'COMPLETED', count: 9 },
      ]),
    )
    const items = expectOk(await WhatsAppFlowService.list('u', 'ws'))
    expect(items[0]).toMatchObject({ sent: 5, completed: 3 })
    expect(items[1]).toMatchObject({ sent: 0, completed: 0 })
  })

  it('propagates database errors on list', async () => {
    flowRepo.listByWorkspace.mockResolvedValue(dbErr())
    expectErr(await WhatsAppFlowService.list('u', 'ws'), 'DATABASE_ERROR')
    flowRepo.listByWorkspace.mockResolvedValue(ok([]))
    responseRepo.countsByFlow.mockResolvedValue(dbErr())
    expectErr(await WhatsAppFlowService.list('u', 'ws'), 'DATABASE_ERROR')
  })

  it('returns one flow, 404 for another workspace, errors through', async () => {
    flowRepo.findById.mockResolvedValue(ok(createFakeFlow({ name: 'X' })))
    expect(expectOk(await WhatsAppFlowService.get('u', 'ws', 'f')).name).toBe(
      'X',
    )
    flowRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppFlowService.get('u', 'ws', 'f'),
      'WHATSAPP_FLOW_NOT_FOUND',
    )
    flowRepo.findById.mockResolvedValue(dbErr())
    expectErr(await WhatsAppFlowService.get('u', 'ws', 'f'), 'DATABASE_ERROR')
  })
})

describe('create()', () => {
  beforeEach(() => {
    asRole('ADMIN')
    connectionRepo.findById.mockResolvedValue(ok(metaConnection()))
    flowRepo.count.mockResolvedValue(ok(0))
    flowRepo.create.mockImplementation(async (data) =>
      ok(createFakeFlow({ ...data, definition: data.definition as never })),
    )
  })

  it('creates a draft from the chosen preset', async () => {
    const dto = expectOk(
      await WhatsAppFlowService.create('u', 'ws', createInput),
    )
    expect(dto.status).toBe('DRAFT')
    expect(dto.crmAction).toBe('LEAD')
    expect(dto.definition.screens).toHaveLength(2)
    expect(flowRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws',
        createdByUserId: 'u',
        category: 'SIGN_UP',
        sourceCrmFormId: null,
      }),
    )
  })

  it('keeps the category the user picked over the preset one', async () => {
    const dto = expectOk(
      await WhatsAppFlowService.create('u', 'ws', {
        ...createInput,
        category: 'SURVEY',
      }),
    )
    expect(dto.category).toBe('SURVEY')
  })

  it('refuses a missing connection and a Z-API one', async () => {
    connectionRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppFlowService.create('u', 'ws', createInput),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
    connectionRepo.findById.mockResolvedValue(
      ok(createFakeWhatsAppConnection({ provider: 'ZAPI' })),
    )
    expectErr(
      await WhatsAppFlowService.create('u', 'ws', createInput),
      'BAD_REQUEST',
    )
    connectionRepo.findById.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppFlowService.create('u', 'ws', createInput),
      'DATABASE_ERROR',
    )
  })

  it('stops at the per-workspace limit', async () => {
    flowRepo.count.mockResolvedValue(ok(50))
    expectErr(
      await WhatsAppFlowService.create('u', 'ws', createInput),
      'WHATSAPP_FLOW_LIMIT_REACHED',
    )
    flowRepo.count.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppFlowService.create('u', 'ws', createInput),
      'DATABASE_ERROR',
    )
  })

  it('reports a failed insert', async () => {
    flowRepo.create.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppFlowService.create('u', 'ws', createInput),
      'DATABASE_ERROR',
    )
  })

  describe('from a CRM form', () => {
    const crmInput = { ...createInput, crmFormId: 'form-1' }
    const crmFields = [
      {
        key: 'nome',
        label: 'Nome',
        type: 'text',
        required: true,
        mapping: { target: 'lead', attribute: 'name' },
      },
      {
        key: 'email',
        label: 'E-mail',
        type: 'email',
        required: true,
        mapping: { target: 'lead', attribute: 'email' },
      },
    ]

    it('copies fields, mapping and action', async () => {
      crmFormRepo.findById.mockResolvedValue(
        ok(createFakeCrmForm({ fields: crmFields, action: 'LEAD' })),
      )
      const dto = expectOk(
        await WhatsAppFlowService.create('u', 'ws', crmInput),
      )
      expect(dto.sourceCrmFormId).toBe('form-1')
      expect(dto.crmAction).toBe('LEAD')
      expect(dto.definition.screens[0].fields.map((f) => f.key)).toEqual([
        'nome',
        'email',
      ])
      expect(dto.category).toBe('OTHER')
    })

    it('starts blank when the form has no fields', async () => {
      crmFormRepo.findById.mockResolvedValue(
        ok(createFakeCrmForm({ fields: [] })),
      )
      const dto = expectOk(
        await WhatsAppFlowService.create('u', 'ws', crmInput),
      )
      expect(dto.definition.screens[0].fields[0].key).toBe('nome')
      expect(dto.crmAction).toBe('NONE')
    })

    it('treats a malformed fields column as empty', async () => {
      crmFormRepo.findById.mockResolvedValue(
        ok(createFakeCrmForm({ fields: 'oops' as never })),
      )
      expectOk(await WhatsAppFlowService.create('u', 'ws', crmInput))
    })

    it('explains fields Flows cannot carry', async () => {
      const options = Array.from({ length: 25 }, (_, i) => ({
        label: `O${i}`,
        value: `o${i}`,
      }))
      crmFormRepo.findById.mockResolvedValue(
        ok(
          createFakeCrmForm({
            fields: [
              {
                key: 'cidade',
                label: 'Cidade',
                type: 'select',
                options,
                mapping: { target: 'lead', attribute: 'source' },
              },
            ],
          }),
        ),
      )
      expectErr(
        await WhatsAppFlowService.create('u', 'ws', crmInput),
        'WHATSAPP_FLOW_INVALID',
      )
    })

    it('needs the CRM module and an existing form', async () => {
      moduleAccess.isEnabled.mockImplementation(async (_ws, module) =>
        ok(module !== 'CRM'),
      )
      expectErr(
        await WhatsAppFlowService.create('u', 'ws', crmInput),
        'MODULE_DISABLED',
      )
      moduleAccess.isEnabled.mockResolvedValue(ok(true))
      crmFormRepo.findById.mockResolvedValue(err(notFound('CrmForm')))
      expectErr(
        await WhatsAppFlowService.create('u', 'ws', crmInput),
        'RESOURCE_NOT_FOUND',
      )
    })
  })
})

describe('update()', () => {
  const lead = flowFromPreset('SIGN_UP').definition
  const unmapped: FlowDefinition = flowFromPreset('SURVEY').definition

  beforeEach(() => {
    asRole('ADMIN')
    flowRepo.findById.mockResolvedValue(ok(createFakeFlow()))
    flowRepo.update.mockImplementation(async (_id, data) =>
      ok(createFakeFlow({ ...(data as object) })),
    )
  })

  it('saves the fields and the definition', async () => {
    const dto = expectOk(
      await WhatsAppFlowService.update('u', 'ws', 'f', {
        name: 'Novo',
        definition: lead,
      }),
    )
    expect(dto.name).toBe('Novo')
    expect(flowRepo.update).toHaveBeenCalledWith(
      'f',
      expect.objectContaining({ name: 'Novo', definition: expect.anything() }),
    )
  })

  it('saves only the plain fields without touching the definition', async () => {
    expectOk(await WhatsAppFlowService.update('u', 'ws', 'f', { name: 'Novo' }))
    expect(flowRepo.update).toHaveBeenCalledWith('f', { name: 'Novo' })
  })

  it('refuses a CRM action the mapping cannot feed', async () => {
    expectErr(
      await WhatsAppFlowService.update('u', 'ws', 'f', {
        definition: unmapped,
        crmAction: 'LEAD',
      }),
      'WHATSAPP_FLOW_INVALID',
    )
    expectErr(
      await WhatsAppFlowService.update('u', 'ws', 'f', {
        crmAction: 'COMPANY',
      }),
      'WHATSAPP_FLOW_INVALID',
    )
  })

  it('does not nag about an old inconsistency when only the name changes', async () => {
    flowRepo.findById.mockResolvedValue(
      ok(
        createFakeFlow({
          definition: unmapped as never,
          crmAction: 'LEAD',
        }),
      ),
    )
    expectOk(await WhatsAppFlowService.update('u', 'ws', 'f', { name: 'Ok' }))
  })

  it('is not found, locked when deprecated, and surfaces database errors', async () => {
    flowRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppFlowService.update('u', 'ws', 'f', { name: 'x' }),
      'WHATSAPP_FLOW_NOT_FOUND',
    )
    flowRepo.findById.mockResolvedValue(
      ok(createFakeFlow({ status: 'DEPRECATED' })),
    )
    expectErr(
      await WhatsAppFlowService.update('u', 'ws', 'f', { name: 'x' }),
      'WHATSAPP_FLOW_INVALID',
    )
    flowRepo.findById.mockResolvedValue(ok(createFakeFlow()))
    flowRepo.update.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppFlowService.update('u', 'ws', 'f', { name: 'x' }),
      'DATABASE_ERROR',
    )
  })
})

describe('remove()', () => {
  beforeEach(() => {
    asRole('ADMIN')
    flowRepo.findById.mockResolvedValue(ok(createFakeFlow()))
    responseRepo.countByFlow.mockResolvedValue(ok(0))
    flowRepo.delete.mockResolvedValue(ok(undefined))
  })

  it('deletes a flow that was never sent', async () => {
    expectOk(await WhatsAppFlowService.remove('u', 'ws', 'f'))
    expect(flowRepo.delete).toHaveBeenCalledWith('f')
    expect(metaDelete).not.toHaveBeenCalled()
  })

  it('refuses to erase collected answers', async () => {
    responseRepo.countByFlow.mockResolvedValue(ok(3))
    expectErr(
      await WhatsAppFlowService.remove('u', 'ws', 'f'),
      'VALIDATION_ERROR',
    )
    expect(flowRepo.delete).not.toHaveBeenCalled()
  })

  it('also removes the draft copy at Meta, never blocking on it', async () => {
    flowRepo.findById.mockResolvedValue(
      ok(createFakeFlow({ metaFlowId: 'm1', metaStatus: 'DRAFT' })),
    )
    connectionRepo.findById.mockResolvedValue(ok(metaConnection()))
    metaDelete.mockResolvedValue(undefined)
    expectOk(await WhatsAppFlowService.remove('u', 'ws', 'f'))
    expect(metaDelete).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'access-token' }),
      'm1',
    )

    metaDelete.mockRejectedValue(new Error('meta down'))
    expectOk(await WhatsAppFlowService.remove('u', 'ws', 'f'))
  })

  it('still deletes when the connection or its token is gone', async () => {
    flowRepo.findById.mockResolvedValue(
      ok(createFakeFlow({ metaFlowId: 'm1', metaStatus: 'DRAFT' })),
    )
    connectionRepo.findById.mockResolvedValue(ok(null))
    expectOk(await WhatsAppFlowService.remove('u', 'ws', 'f'))
    connectionRepo.findById.mockResolvedValue(
      ok(metaConnection({ encryptedMetaAccessToken: null })),
    )
    expectOk(await WhatsAppFlowService.remove('u', 'ws', 'f'))
    expect(metaDelete).not.toHaveBeenCalled()
  })

  it('propagates errors', async () => {
    flowRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppFlowService.remove('u', 'ws', 'f'),
      'WHATSAPP_FLOW_NOT_FOUND',
    )
    flowRepo.findById.mockResolvedValue(ok(createFakeFlow()))
    responseRepo.countByFlow.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppFlowService.remove('u', 'ws', 'f'),
      'DATABASE_ERROR',
    )
    responseRepo.countByFlow.mockResolvedValue(ok(0))
    flowRepo.delete.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppFlowService.remove('u', 'ws', 'f'),
      'DATABASE_ERROR',
    )
  })
})

describe('metaJson()', () => {
  it('returns the generated Flow JSON', async () => {
    asRole('MEMBER')
    flowRepo.findById.mockResolvedValue(ok(createFakeFlow()))
    const dto = expectOk(await WhatsAppFlowService.metaJson('u', 'ws', 'f'))
    expect(dto.json.version).toBe('7.2')
    flowRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppFlowService.metaJson('u', 'ws', 'f'),
      'WHATSAPP_FLOW_NOT_FOUND',
    )
  })
})

describe('publish()', () => {
  beforeEach(() => {
    asRole('ADMIN')
    flowRepo.findById.mockResolvedValue(ok(createFakeFlow()))
    connectionRepo.findById.mockResolvedValue(ok(metaConnection()))
    flowRepo.update.mockImplementation(async (_id, data) =>
      ok(
        createFakeFlow({
          ...(data as object),
          definition: createFakeFlow().definition,
        }),
      ),
    )
    metaCreate.mockResolvedValue({ id: 'meta-new' })
    metaUpload.mockResolvedValue(undefined)
    metaPublish.mockResolvedValue(undefined)
  })

  it('creates the Meta flow, publishes it and records the version', async () => {
    const result = expectOk(
      await WhatsAppFlowService.publish('u', 'ws', 'f', { publish: true }),
    )
    expect(result.published).toBe(true)
    expect(metaCreate).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'access-token' }),
      expect.objectContaining({ wabaId: 'waba-1', categories: ['SIGN_UP'] }),
    )
    expect(metaPublish).toHaveBeenCalledWith(expect.anything(), 'meta-new')
    expect(flowRepo.update).toHaveBeenLastCalledWith(
      'f',
      expect.objectContaining({
        metaFlowId: 'meta-new',
        metaStatus: 'PUBLISHED',
        status: 'PUBLISHED',
        publishError: null,
        publishedVersion: { increment: 1 },
      }),
    )
  })

  it('only uploads a draft when asked not to publish', async () => {
    const result = expectOk(
      await WhatsAppFlowService.publish('u', 'ws', 'f', { publish: false }),
    )
    expect(result.published).toBe(false)
    expect(metaPublish).not.toHaveBeenCalled()
    expect(flowRepo.update).toHaveBeenLastCalledWith(
      'f',
      expect.objectContaining({ metaStatus: 'DRAFT', status: 'DRAFT' }),
    )
  })

  it('updates in place a flow that is still a draft at Meta', async () => {
    flowRepo.findById.mockResolvedValue(
      ok(createFakeFlow({ metaFlowId: 'meta-1', metaStatus: 'DRAFT' })),
    )
    expectOk(
      await WhatsAppFlowService.publish('u', 'ws', 'f', { publish: true }),
    )
    expect(metaCreate).not.toHaveBeenCalled()
    expect(metaUpload).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ flowId: 'meta-1' }),
    )
  })

  it('creates a new Meta flow when the previous one is already live', async () => {
    flowRepo.findById.mockResolvedValue(ok(createFakePublishedFlow()))
    expectOk(
      await WhatsAppFlowService.publish('u', 'ws', 'f', { publish: true }),
    )
    expect(metaCreate).toHaveBeenCalled()
    expect(metaUpload).not.toHaveBeenCalled()
  })

  it('stores Meta’s refusal and keeps a freshly created Meta id', async () => {
    metaPublish.mockRejectedValue(new MetaFlowError('Tela sem título'))
    const error = expectErr(
      await WhatsAppFlowService.publish('u', 'ws', 'f', { publish: true }),
      'WHATSAPP_FLOW_META_REJECTED',
    )
    expect(error.message).toBe('Tela sem título')
    expect(flowRepo.update).toHaveBeenCalledWith(
      'f',
      expect.objectContaining({
        publishError: 'Tela sem título',
        metaFlowId: 'meta-new',
        metaStatus: 'DRAFT',
      }),
    )
  })

  it('stores the refusal of an in-place upload without touching the Meta id', async () => {
    flowRepo.findById.mockResolvedValue(
      ok(createFakeFlow({ metaFlowId: 'meta-1', metaStatus: 'DRAFT' })),
    )
    metaUpload.mockRejectedValue('not an error object')
    expectErr(
      await WhatsAppFlowService.publish('u', 'ws', 'f', { publish: false }),
      'WHATSAPP_FLOW_META_REJECTED',
    )
    const data = flowRepo.update.mock.calls[0][1] as Record<string, unknown>
    expect(data.metaFlowId).toBeUndefined()
    expect(data.publishError).toBe('A Meta recusou o formulário')
  })

  it('validates before calling Meta', async () => {
    flowRepo.findById.mockResolvedValue(
      ok(createFakeFlow({ status: 'DEPRECATED' })),
    )
    expectErr(
      await WhatsAppFlowService.publish('u', 'ws', 'f', { publish: true }),
      'WHATSAPP_FLOW_INVALID',
    )
    flowRepo.findById.mockResolvedValue(
      ok(createFakeFlow({ definition: { screens: [] } as never })),
    )
    expectErr(
      await WhatsAppFlowService.publish('u', 'ws', 'f', { publish: true }),
      'WHATSAPP_FLOW_INVALID',
    )
    flowRepo.findById.mockResolvedValue(
      ok(
        createFakeFlow({
          definition: flowFromPreset('SURVEY').definition as never,
          crmAction: 'LEAD',
        }),
      ),
    )
    expectErr(
      await WhatsAppFlowService.publish('u', 'ws', 'f', { publish: true }),
      'WHATSAPP_FLOW_INVALID',
    )
    expect(metaCreate).not.toHaveBeenCalled()
  })

  it('needs a Meta connection with credentials', async () => {
    connectionRepo.findById.mockResolvedValue(
      ok(metaConnection({ encryptedMetaAccessToken: null })),
    )
    expectErr(
      await WhatsAppFlowService.publish('u', 'ws', 'f', { publish: true }),
      'BAD_REQUEST',
    )
    connectionRepo.findById.mockResolvedValue(
      ok(metaConnection({ metaWabaId: null })),
    )
    expectErr(
      await WhatsAppFlowService.publish('u', 'ws', 'f', { publish: true }),
      'BAD_REQUEST',
    )
    connectionRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppFlowService.publish('u', 'ws', 'f', { publish: true }),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
  })

  it('propagates lookup and save errors', async () => {
    flowRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppFlowService.publish('u', 'ws', 'f', { publish: true }),
      'WHATSAPP_FLOW_NOT_FOUND',
    )
    flowRepo.findById.mockResolvedValue(ok(createFakeFlow()))
    flowRepo.update.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppFlowService.publish('u', 'ws', 'f', { publish: true }),
      'DATABASE_ERROR',
    )
  })
})

describe('deprecate()', () => {
  beforeEach(() => {
    asRole('ADMIN')
    connectionRepo.findById.mockResolvedValue(ok(metaConnection()))
    flowRepo.update.mockImplementation(async (_id, data) =>
      ok(createFakeFlow({ ...(data as object) })),
    )
  })

  it('retires a published flow at Meta and locally', async () => {
    flowRepo.findById.mockResolvedValue(ok(createFakePublishedFlow()))
    const dto = expectOk(await WhatsAppFlowService.deprecate('u', 'ws', 'f'))
    expect(metaDeprecate).toHaveBeenCalledWith(expect.anything(), 'meta-flow-1')
    expect(dto.status).toBe('DEPRECATED')
    expect(flowRepo.update).toHaveBeenCalledWith(
      'f',
      expect.objectContaining({ metaStatus: 'DEPRECATED' }),
    )
  })

  it('does not call Meta for a flow that never went live', async () => {
    flowRepo.findById.mockResolvedValue(ok(createFakeFlow()))
    expectOk(await WhatsAppFlowService.deprecate('u', 'ws', 'f'))
    expect(metaDeprecate).not.toHaveBeenCalled()
    expect(flowRepo.update).toHaveBeenCalledWith(
      'f',
      expect.objectContaining({ metaStatus: null }),
    )
  })

  it('is idempotent', async () => {
    flowRepo.findById.mockResolvedValue(
      ok(createFakeFlow({ status: 'DEPRECATED' })),
    )
    expect(
      expectOk(await WhatsAppFlowService.deprecate('u', 'ws', 'f')).status,
    ).toBe('DEPRECATED')
    expect(flowRepo.update).not.toHaveBeenCalled()
  })

  it('reports Meta’s refusal and other errors', async () => {
    flowRepo.findById.mockResolvedValue(ok(createFakePublishedFlow()))
    metaDeprecate.mockRejectedValue(new Error('recusado'))
    expectErr(
      await WhatsAppFlowService.deprecate('u', 'ws', 'f'),
      'WHATSAPP_FLOW_META_REJECTED',
    )
    metaDeprecate.mockRejectedValue('x')
    expectErr(
      await WhatsAppFlowService.deprecate('u', 'ws', 'f'),
      'WHATSAPP_FLOW_META_REJECTED',
    )
    connectionRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppFlowService.deprecate('u', 'ws', 'f'),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
    connectionRepo.findById.mockResolvedValue(
      ok(metaConnection({ encryptedMetaAccessToken: null })),
    )
    expectErr(
      await WhatsAppFlowService.deprecate('u', 'ws', 'f'),
      'BAD_REQUEST',
    )
    flowRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppFlowService.deprecate('u', 'ws', 'f'),
      'WHATSAPP_FLOW_NOT_FOUND',
    )
    flowRepo.findById.mockResolvedValue(ok(createFakeFlow()))
    flowRepo.update.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppFlowService.deprecate('u', 'ws', 'f'),
      'DATABASE_ERROR',
    )
  })
})

describe('preview()', () => {
  beforeEach(() => {
    asRole('ADMIN')
    connectionRepo.findById.mockResolvedValue(ok(metaConnection()))
  })

  it('returns Meta’s preview link', async () => {
    flowRepo.findById.mockResolvedValue(ok(createFakePublishedFlow()))
    metaGet.mockResolvedValue({
      id: 'm',
      status: 'DRAFT',
      previewUrl: 'https://p',
    })
    expect(expectOk(await WhatsAppFlowService.preview('u', 'ws', 'f'))).toEqual(
      {
        previewUrl: 'https://p',
        status: 'DRAFT',
      },
    )
  })

  it('needs the flow to be at Meta first', async () => {
    flowRepo.findById.mockResolvedValue(ok(createFakeFlow()))
    expectErr(
      await WhatsAppFlowService.preview('u', 'ws', 'f'),
      'WHATSAPP_FLOW_NOT_SENDABLE',
    )
  })

  it('reports Meta failures and lookup errors', async () => {
    flowRepo.findById.mockResolvedValue(ok(createFakePublishedFlow()))
    metaGet.mockRejectedValue(new Error('down'))
    expectErr(
      await WhatsAppFlowService.preview('u', 'ws', 'f'),
      'WHATSAPP_FLOW_META_REJECTED',
    )
    metaGet.mockRejectedValue('x')
    expectErr(
      await WhatsAppFlowService.preview('u', 'ws', 'f'),
      'WHATSAPP_FLOW_META_REJECTED',
    )
    connectionRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppFlowService.preview('u', 'ws', 'f'),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
    connectionRepo.findById.mockResolvedValue(
      ok(metaConnection({ metaWabaId: null })),
    )
    expectErr(await WhatsAppFlowService.preview('u', 'ws', 'f'), 'BAD_REQUEST')
    flowRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppFlowService.preview('u', 'ws', 'f'),
      'WHATSAPP_FLOW_NOT_FOUND',
    )
  })
})

describe('createTemplate()', () => {
  const input = {
    name: 'cadastro_cliente',
    language: 'pt_BR',
    category: 'UTILITY' as const,
    body: 'Faça seu cadastro',
    buttonText: 'Preencher',
  }

  beforeEach(() => {
    asRole('ADMIN')
    flowRepo.findById.mockResolvedValue(ok(createFakePublishedFlow()))
    connectionRepo.findById.mockResolvedValue(ok(metaConnection()))
    metaTemplate.mockResolvedValue({
      name: input.name,
      language: 'pt_BR',
      category: 'UTILITY',
      status: 'PENDING',
      components: [],
    })
    templateRepo.upsertSynced.mockImplementation(async (data) =>
      ok(
        createFakeWhatsAppTemplate({
          name: data.name,
          status: data.status,
          components: data.components as never,
        }),
      ),
    )
  })

  it('submits a BODY + FLOW button template and saves it as pending', async () => {
    const dto = expectOk(
      await WhatsAppFlowService.createTemplate('u', 'ws', 'f', input),
    )
    expect(dto.status).toBe('PENDING')
    const call = metaTemplate.mock.calls[0][0]
    expect(call.components).toEqual([
      { type: 'BODY', text: 'Faça seu cadastro' },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'FLOW',
            text: 'Preencher',
            flow_id: 'meta-flow-1',
            flow_action: 'navigate',
            navigate_screen: 'SCREEN_A',
          },
        ],
      },
    ])
    expect(templateRepo.upsertSynced).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: expect.any(String),
        status: 'PENDING',
      }),
    )
  })

  it('keeps an already approved template approved', async () => {
    metaTemplate.mockResolvedValue({
      name: input.name,
      language: 'pt_BR',
      category: 'UTILITY',
      status: 'APPROVED',
      components: [],
    })
    expectOk(await WhatsAppFlowService.createTemplate('u', 'ws', 'f', input))
    expect(templateRepo.upsertSynced).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'APPROVED' }),
    )
  })

  it('needs a published flow', async () => {
    flowRepo.findById.mockResolvedValue(ok(createFakeFlow()))
    expectErr(
      await WhatsAppFlowService.createTemplate('u', 'ws', 'f', input),
      'WHATSAPP_FLOW_NOT_SENDABLE',
    )
  })

  it('reports Meta’s refusal and save errors', async () => {
    metaTemplate.mockRejectedValue(new Error('nome repetido'))
    expectErr(
      await WhatsAppFlowService.createTemplate('u', 'ws', 'f', input),
      'WHATSAPP_FLOW_META_REJECTED',
    )
    metaTemplate.mockRejectedValue('x')
    expectErr(
      await WhatsAppFlowService.createTemplate('u', 'ws', 'f', input),
      'WHATSAPP_FLOW_META_REJECTED',
    )
    metaTemplate.mockResolvedValue({
      name: 'n',
      language: 'pt_BR',
      category: 'UTILITY',
      status: 'PENDING',
      components: [],
    })
    templateRepo.upsertSynced.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppFlowService.createTemplate('u', 'ws', 'f', input),
      'DATABASE_ERROR',
    )
    connectionRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppFlowService.createTemplate('u', 'ws', 'f', input),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
    connectionRepo.findById.mockResolvedValue(
      ok(metaConnection({ metaWabaId: null })),
    )
    expectErr(
      await WhatsAppFlowService.createTemplate('u', 'ws', 'f', input),
      'BAD_REQUEST',
    )
    flowRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppFlowService.createTemplate('u', 'ws', 'f', input),
      'WHATSAPP_FLOW_NOT_FOUND',
    )
  })
})

describe('send()', () => {
  const sentMessage = {
    message: { id: 'msg-1' } as never,
    contactId: 'contact-1',
  }

  beforeEach(() => {
    asRole('MEMBER')
    flowRepo.findById.mockResolvedValue(ok(createFakePublishedFlow()))
    messages.sendFlow.mockResolvedValue(ok(sentMessage))
    responseRepo.create.mockImplementation(async (data) =>
      ok(createFakeFlowResponse({ ...data })),
    )
  })

  it('sends the interactive message and records the pending answer', async () => {
    const result = expectOk(
      await WhatsAppFlowService.send('u', 'ws', 'f', {
        conversationId: 'conv-1',
      }),
    )
    expect(result.messageId).toBe('msg-1')
    const [, , conversationId, input] = messages.sendFlow.mock.calls[0]
    expect(conversationId).toBe('conv-1')
    expect(input).toMatchObject({
      kind: 'INTERACTIVE',
      flowId: 'meta-flow-1',
      screen: 'SCREEN_A',
      draft: false,
      ctaLabel: 'Cadastrar',
    })
    expect(input.flowToken).toMatch(/^stlf\./)
    expect(responseRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'contact-1',
        conversationId: 'conv-1',
        flowToken: input.flowToken,
        sentByUserId: 'u',
        messageId: 'msg-1',
      }),
    )
  })

  it('lets the agent override the text and the button', async () => {
    expectOk(
      await WhatsAppFlowService.send('u', 'ws', 'f', {
        conversationId: 'c',
        bodyText: 'Oi!',
        ctaLabel: 'Vamos',
      }),
    )
    expect(messages.sendFlow.mock.calls[0][3]).toMatchObject({
      bodyText: 'Oi!',
      ctaLabel: 'Vamos',
    })
  })

  it('marks a flow that is only a Meta draft as draft mode', async () => {
    flowRepo.findById.mockResolvedValue(
      ok(createFakeFlow({ metaFlowId: 'm', metaStatus: 'DRAFT' })),
    )
    expectOk(
      await WhatsAppFlowService.send('u', 'ws', 'f', { conversationId: 'c' }),
    )
    expect(messages.sendFlow.mock.calls[0][3]).toMatchObject({ draft: true })
  })

  it('sends through a template when asked', async () => {
    expectOk(
      await WhatsAppFlowService.send('u', 'ws', 'f', {
        conversationId: 'c',
        templateName: 'cadastro_cliente',
        language: 'pt_BR',
      }),
    )
    expect(messages.sendFlow.mock.calls[0][3]).toMatchObject({
      kind: 'TEMPLATE',
      templateName: 'cadastro_cliente',
      language: 'pt_BR',
    })
  })

  it('refuses a deprecated flow or one that is not at Meta yet', async () => {
    flowRepo.findById.mockResolvedValue(
      ok(createFakePublishedFlow({ status: 'DEPRECATED' })),
    )
    expectErr(
      await WhatsAppFlowService.send('u', 'ws', 'f', { conversationId: 'c' }),
      'WHATSAPP_FLOW_NOT_SENDABLE',
    )
    flowRepo.findById.mockResolvedValue(ok(createFakeFlow()))
    expectErr(
      await WhatsAppFlowService.send('u', 'ws', 'f', { conversationId: 'c' }),
      'WHATSAPP_FLOW_NOT_SENDABLE',
    )
    flowRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppFlowService.send('u', 'ws', 'f', { conversationId: 'c' }),
      'WHATSAPP_FLOW_NOT_FOUND',
    )
    expect(messages.sendFlow).not.toHaveBeenCalled()
  })

  it('does not record anything when the message could not be sent', async () => {
    messages.sendFlow.mockResolvedValue(
      err({ code: 'WHATSAPP_PROVIDER_ERROR' as const, message: 'x' }),
    )
    expectErr(
      await WhatsAppFlowService.send('u', 'ws', 'f', { conversationId: 'c' }),
      'WHATSAPP_PROVIDER_ERROR',
    )
    expect(responseRepo.create).not.toHaveBeenCalled()
  })

  it('reports a failed record after the message left', async () => {
    responseRepo.create.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppFlowService.send('u', 'ws', 'f', { conversationId: 'c' }),
      'DATABASE_ERROR',
    )
  })
})

describe('listResponses()', () => {
  beforeEach(() => {
    asRole('MEMBER')
    flowRepo.findById.mockResolvedValue(ok(createFakeFlow()))
  })

  const row = (id: string) => ({
    ...createFakeFlowResponse({ id }),
    contact: { name: 'Maria', waId: '5511' },
  })

  it('returns a page and the cursor of the next one', async () => {
    responseRepo.listByFlow.mockResolvedValue(
      ok([row('a'), row('b'), row('c')]),
    )
    const page = expectOk(
      await WhatsAppFlowService.listResponses('u', 'ws', 'f', { limit: 2 }),
    )
    expect(page.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(page.nextCursor).toBe('b')
  })

  it('has no cursor on the last page', async () => {
    responseRepo.listByFlow.mockResolvedValue(ok([row('a')]))
    const page = expectOk(
      await WhatsAppFlowService.listResponses('u', 'ws', 'f', { limit: 2 }),
    )
    expect(page.nextCursor).toBeNull()
    responseRepo.listByFlow.mockResolvedValue(ok([]))
    expect(
      expectOk(
        await WhatsAppFlowService.listResponses('u', 'ws', 'f', { limit: 2 }),
      ).items,
    ).toEqual([])
  })

  it('propagates errors', async () => {
    flowRepo.findById.mockResolvedValue(ok(null))
    expectErr(
      await WhatsAppFlowService.listResponses('u', 'ws', 'f', { limit: 2 }),
      'WHATSAPP_FLOW_NOT_FOUND',
    )
    flowRepo.findById.mockResolvedValue(ok(createFakeFlow()))
    responseRepo.listByFlow.mockResolvedValue(dbErr())
    expectErr(
      await WhatsAppFlowService.listResponses('u', 'ws', 'f', { limit: 2 }),
      'DATABASE_ERROR',
    )
  })
})
