import { describe, expect, it, vi } from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import { createFakeWhatsAppConnection } from '@/src/__tests__/factories/whatsapp-connection.factory'
import { createFakeWhatsAppContact } from '@/src/__tests__/factories/whatsapp-contact.factory'
import { createFakeWhatsAppGroupWithParticipants } from '@/src/__tests__/factories/whatsapp-group.factory'
import { createFakeWhatsAppGroupMessage } from '@/src/__tests__/factories/whatsapp-group-message.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import type { AppError } from '@/src/errors/app-error'
import { err, ok, type Result } from '@/src/lib/result'

// Business hours: open unless a test says otherwise.
vi.mock('@/src/services/whatsapp-business-hours.service', () => ({
  WhatsAppBusinessHoursService: {
    assertOpen: vi.fn(async () => ({ ok: true, value: undefined })),
    check: vi.fn(async () => ({
      ok: true,
      value: { open: true, nextOpeningAt: null, hours: {} },
    })),
  },
}))
vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-connection.repository')
vi.mock('@/src/repositories/whatsapp-contact.repository')
vi.mock('@/src/repositories/whatsapp-group.repository')
vi.mock('@/src/repositories/whatsapp-group-message.repository')
vi.mock('@/lib/axiom/audit', () => ({ auditMutation: vi.fn() }))
vi.mock('@/src/lib/crypto', () => ({
  decryptConnectionSecret: vi.fn(async (envelope: string) =>
    envelope.replace(/^enc:/, ''),
  ),
}))
vi.mock('@/src/lib/rate-limit', () => ({
  consume: vi.fn(async () => ({ ok: true, value: undefined })),
  whatsappSendLimiter: { __mock: 'whatsappSendLimiter' },
}))
vi.mock('@/src/lib/whatsapp/send', () => ({
  WhatsAppSend: { text: vi.fn() },
}))
vi.mock('@/src/lib/whatsapp/zapi-groups', () => ({
  createZapiGroup: vi.fn(),
  updateZapiGroupName: vi.fn(async () => undefined),
  updateZapiGroupPhoto: vi.fn(async () => undefined),
  updateZapiGroupDescription: vi.fn(async () => undefined),
  addZapiGroupParticipants: vi.fn(async () => undefined),
  removeZapiGroupParticipants: vi.fn(async () => undefined),
  setZapiGroupAdmin: vi.fn(async () => undefined),
  leaveZapiGroup: vi.fn(async () => undefined),
  getZapiGroupMetadata: vi.fn(),
  getZapiGroupInviteLink: vi.fn(),
}))

import { decryptConnectionSecret } from '@/src/lib/crypto'
import { consume } from '@/src/lib/rate-limit'
import { WhatsAppSend } from '@/src/lib/whatsapp/send'
import {
  addZapiGroupParticipants,
  createZapiGroup,
  getZapiGroupInviteLink,
  getZapiGroupMetadata,
  leaveZapiGroup,
  removeZapiGroupParticipants,
  setZapiGroupAdmin,
  updateZapiGroupDescription,
  updateZapiGroupName,
  updateZapiGroupPhoto,
} from '@/src/lib/whatsapp/zapi-groups'
import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppConnectionRepository } from '@/src/repositories/whatsapp-connection.repository'
import { WhatsAppContactRepository } from '@/src/repositories/whatsapp-contact.repository'
import { WhatsAppGroupRepository } from '@/src/repositories/whatsapp-group.repository'
import { WhatsAppGroupMessageRepository } from '@/src/repositories/whatsapp-group-message.repository'
import { WhatsAppGroupService } from '../whatsapp-group.service'

const mockedMembershipRepo = vi.mocked(MembershipRepository)
const mockedConnectionRepo = vi.mocked(WhatsAppConnectionRepository)
const mockedContactRepo = vi.mocked(WhatsAppContactRepository)
const mockedGroupRepo = vi.mocked(WhatsAppGroupRepository)
const mockedGroupMessageRepo = vi.mocked(WhatsAppGroupMessageRepository)

const DB_ERROR: AppError = { code: 'DATABASE_ERROR', message: 'db down' }

type Call = () => Promise<Result<unknown>>

function asAdmin() {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'ADMIN' })),
  )
}

function asNonMember() {
  mockedMembershipRepo.findByUserAndWorkspace.mockResolvedValue(ok(null))
}

function arrangeConnection(
  overrides: Parameters<typeof createFakeWhatsAppConnection>[0] = {},
) {
  mockedConnectionRepo.findById.mockResolvedValue(
    ok(
      createFakeWhatsAppConnection({
        id: 'conn1',
        workspaceId: 'ws1',
        provider: 'ZAPI',
        zapiInstanceId: 'instance-1',
        encryptedZapiToken: 'enc:token',
        encryptedZapiClientToken: null,
        ...overrides,
      }),
    ),
  )
}

function group() {
  return createFakeWhatsAppGroupWithParticipants({
    id: 'g1',
    workspaceId: 'ws1',
    connectionId: 'conn1',
  })
}

function arrangeGroup() {
  asAdmin()
  arrangeConnection()
  mockedGroupRepo.findById.mockResolvedValue(ok(group()))
  mockedGroupRepo.update.mockResolvedValue(ok(group()))
  mockedGroupRepo.replaceParticipants.mockResolvedValue(ok(undefined))
  mockedContactRepo.findManyByWaIds.mockResolvedValue(ok([]))
  vi.mocked(getZapiGroupMetadata).mockResolvedValue({
    phone: '120363000000000000@g.us',
    subject: 'Time de Suporte',
    participants: [{ phone: '5511988887777', isAdmin: false }],
  } as never)
}

const createDto = {
  connectionId: 'conn1',
  name: 'Time de Suporte',
  participantWaIds: ['5511988887777', '5511911112222'],
}

describe('WhatsAppGroupService — Z-API connection resolution', () => {
  it('should propagate a connection lookup failure', async () => {
    asAdmin()
    mockedConnectionRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppGroupService.create('u1', 'ws1', createDto),
      'DATABASE_ERROR',
    )
  })

  it('should return WHATSAPP_CONNECTION_NOT_FOUND for an unknown connection', async () => {
    asAdmin()
    mockedConnectionRepo.findById.mockResolvedValue(ok(null))

    expectErr(
      await WhatsAppGroupService.create('u1', 'ws1', createDto),
      'WHATSAPP_CONNECTION_NOT_FOUND',
    )
  })

  it.each([
    ['instance id', { zapiInstanceId: null }],
    ['token', { encryptedZapiToken: null }],
  ])(
    'should reject a Z-API connection without %s',
    async (_label, overrides) => {
      asAdmin()
      arrangeConnection(overrides)

      expectErr(
        await WhatsAppGroupService.create('u1', 'ws1', createDto),
        'WHATSAPP_GROUP_PROVIDER_UNSUPPORTED',
      )
      expect(createZapiGroup).not.toHaveBeenCalled()
    },
  )

  it('should decrypt the client token when the connection has one', async () => {
    arrangeGroup()
    arrangeConnection({ encryptedZapiClientToken: 'enc:client' })
    vi.mocked(getZapiGroupInviteLink).mockResolvedValue(
      'https://chat.whatsapp.com/xyz',
    )

    expectOk(await WhatsAppGroupService.getInviteLink('u1', 'ws1', 'g1'))

    expect(decryptConnectionSecret).toHaveBeenCalledWith('enc:client')
    expect(getZapiGroupInviteLink).toHaveBeenCalledWith(
      { instanceId: 'instance-1', token: 'token', clientToken: 'client' },
      { groupJid: '120363000000000000@g.us' },
    )
  })
})

describe('WhatsAppGroupService.create() failures', () => {
  function arrangeCreate() {
    asAdmin()
    arrangeConnection()
    vi.mocked(createZapiGroup).mockResolvedValue({
      groupJid: '120363000000000000@g.us',
      phonesNotAdded: [],
      inviteLink: null,
    } as never)
    mockedGroupRepo.create.mockResolvedValue(ok(group()))
    mockedGroupRepo.replaceParticipants.mockResolvedValue(ok(undefined))
    mockedGroupRepo.findById.mockResolvedValue(ok(group()))
    mockedContactRepo.findManyByWaIds.mockResolvedValue(ok([]))
  }

  it('should return FORBIDDEN for a non-member', async () => {
    asNonMember()

    expectErr(
      await WhatsAppGroupService.create('u1', 'ws1', createDto),
      'FORBIDDEN',
    )
  })

  it('should stop when the send rate limit is exhausted', async () => {
    arrangeCreate()
    vi.mocked(consume).mockResolvedValueOnce(
      err({ code: 'RATE_LIMITED', message: 'slow down' }),
    )

    expectErr(
      await WhatsAppGroupService.create('u1', 'ws1', createDto),
      'RATE_LIMITED',
    )
    expect(createZapiGroup).not.toHaveBeenCalled()
  })

  it('should map a provider exception to WHATSAPP_PROVIDER_ERROR with its message', async () => {
    arrangeCreate()
    vi.mocked(createZapiGroup).mockRejectedValue(new Error('Z-API 500'))

    const error = expectErr(
      await WhatsAppGroupService.create('u1', 'ws1', createDto),
      'WHATSAPP_PROVIDER_ERROR',
    )
    expect(error.message).toBe('Z-API 500')
  })

  it('should fall back to a generic message for a non-Error rejection', async () => {
    arrangeCreate()
    vi.mocked(createZapiGroup).mockRejectedValue('boom')

    const error = expectErr(
      await WhatsAppGroupService.create('u1', 'ws1', createDto),
      'WHATSAPP_PROVIDER_ERROR',
    )
    expect(error.message).toBe('Falha ao criar grupo')
  })

  it('should propagate a failure persisting the group', async () => {
    arrangeCreate()
    mockedGroupRepo.create.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppGroupService.create('u1', 'ws1', createDto),
      'DATABASE_ERROR',
    )
  })

  it('should name participants found in the contact book', async () => {
    arrangeCreate()
    mockedContactRepo.findManyByWaIds.mockResolvedValue(
      ok([
        createFakeWhatsAppContact({ waId: '5511988887777', name: 'Maria' }),
        createFakeWhatsAppContact({ waId: '5511911112222', name: null }),
      ]),
    )

    expectOk(await WhatsAppGroupService.create('u1', 'ws1', createDto))

    expect(mockedGroupRepo.replaceParticipants).toHaveBeenCalledWith('g1', [
      { waId: '5511988887777', name: 'Maria', role: 'MEMBER' },
      { waId: '5511911112222', name: undefined, role: 'MEMBER' },
    ])
  })

  it('should still create the group when the contact lookup fails', async () => {
    arrangeCreate()
    mockedContactRepo.findManyByWaIds.mockResolvedValue(err(DB_ERROR))

    expectOk(await WhatsAppGroupService.create('u1', 'ws1', createDto))

    expect(mockedGroupRepo.replaceParticipants).toHaveBeenCalledWith('g1', [
      { waId: '5511988887777', name: undefined, role: 'MEMBER' },
      { waId: '5511911112222', name: undefined, role: 'MEMBER' },
    ])
  })

  it('should propagate a failure reloading the created group', async () => {
    arrangeCreate()
    mockedGroupRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppGroupService.create('u1', 'ws1', createDto),
      'DATABASE_ERROR',
    )
  })

  it('should return WHATSAPP_GROUP_NOT_FOUND when the reload finds nothing', async () => {
    arrangeCreate()
    mockedGroupRepo.findById.mockResolvedValue(ok(null))

    expectErr(
      await WhatsAppGroupService.create('u1', 'ws1', createDto),
      'WHATSAPP_GROUP_NOT_FOUND',
    )
  })
})

describe('WhatsAppGroupService reads', () => {
  it('list() should propagate a repository failure', async () => {
    asAdmin()
    mockedGroupRepo.listByWorkspace.mockResolvedValue(err(DB_ERROR))

    expectErr(await WhatsAppGroupService.list('u1', 'ws1'), 'DATABASE_ERROR')
  })

  it('get() should return the group DTO', async () => {
    asAdmin()
    mockedGroupRepo.findById.mockResolvedValue(ok(group()))

    expect(expectOk(await WhatsAppGroupService.get('u1', 'ws1', 'g1')).id).toBe(
      'g1',
    )
  })

  it('get() should return FORBIDDEN for a non-member', async () => {
    asNonMember()

    expectErr(await WhatsAppGroupService.get('u1', 'ws1', 'g1'), 'FORBIDDEN')
  })

  it('get() should propagate a repository failure', async () => {
    asAdmin()
    mockedGroupRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppGroupService.get('u1', 'ws1', 'g1'),
      'DATABASE_ERROR',
    )
  })

  it('get() should return WHATSAPP_GROUP_NOT_FOUND when missing', async () => {
    asAdmin()
    mockedGroupRepo.findById.mockResolvedValue(ok(null))

    expectErr(
      await WhatsAppGroupService.get('u1', 'ws1', 'g1'),
      'WHATSAPP_GROUP_NOT_FOUND',
    )
  })

  const listMessages = () =>
    WhatsAppGroupService.listMessages('u1', 'ws1', 'g1', { limit: 20 })

  it('listMessages() should return FORBIDDEN for a non-member', async () => {
    asNonMember()

    expectErr(await listMessages(), 'FORBIDDEN')
  })

  it('listMessages() should propagate a group lookup failure', async () => {
    asAdmin()
    mockedGroupRepo.findById.mockResolvedValue(err(DB_ERROR))

    expectErr(await listMessages(), 'DATABASE_ERROR')
  })

  it('listMessages() should return WHATSAPP_GROUP_NOT_FOUND when missing', async () => {
    asAdmin()
    mockedGroupRepo.findById.mockResolvedValue(ok(null))

    expectErr(await listMessages(), 'WHATSAPP_GROUP_NOT_FOUND')
  })

  it('listMessages() should propagate a message lookup failure', async () => {
    asAdmin()
    mockedGroupRepo.findById.mockResolvedValue(ok(group()))
    mockedGroupMessageRepo.listByGroup.mockResolvedValue(err(DB_ERROR))

    expectErr(await listMessages(), 'DATABASE_ERROR')
  })
})

/** Operações que carregam grupo + credenciais Z-API antes de agir. */
const providerOps: [string, Call, () => unknown][] = [
  [
    'updateInfo',
    () => WhatsAppGroupService.updateInfo('u1', 'ws1', 'g1', { name: 'Novo' }),
    () => updateZapiGroupName,
  ],
  [
    'addParticipants',
    () =>
      WhatsAppGroupService.addParticipants('u1', 'ws1', 'g1', {
        waIds: ['5511988887777'],
      }),
    () => addZapiGroupParticipants,
  ],
  [
    'removeParticipants',
    () =>
      WhatsAppGroupService.removeParticipants('u1', 'ws1', 'g1', {
        waIds: ['5511988887777'],
      }),
    () => removeZapiGroupParticipants,
  ],
  [
    'setAdmin',
    () =>
      WhatsAppGroupService.setAdmin('u1', 'ws1', 'g1', {
        waId: '5511988887777',
        admin: true,
      }),
    () => setZapiGroupAdmin,
  ],
  [
    'getInviteLink',
    () => WhatsAppGroupService.getInviteLink('u1', 'ws1', 'g1'),
    () => getZapiGroupInviteLink,
  ],
  [
    'leave',
    () => WhatsAppGroupService.leave('u1', 'ws1', 'g1'),
    () => leaveZapiGroup,
  ],
]

describe.each(providerOps)(
  'WhatsAppGroupService.%s() failures',
  (_name, call, providerFn) => {
    it('should return FORBIDDEN for a non-member', async () => {
      asNonMember()

      expectErr(await call(), 'FORBIDDEN')
      expect(mockedGroupRepo.findById).not.toHaveBeenCalled()
    })

    it('should propagate a group lookup failure', async () => {
      arrangeGroup()
      mockedGroupRepo.findById.mockResolvedValue(err(DB_ERROR))

      expectErr(await call(), 'DATABASE_ERROR')
    })

    it('should propagate a connection failure behind the group', async () => {
      arrangeGroup()
      mockedConnectionRepo.findById.mockResolvedValue(ok(null))

      expectErr(await call(), 'WHATSAPP_CONNECTION_NOT_FOUND')
    })

    it('should map a provider exception to WHATSAPP_GROUP_PROVIDER_UNSUPPORTED', async () => {
      arrangeGroup()
      vi.mocked(providerFn() as () => Promise<unknown>).mockRejectedValueOnce(
        new Error('not supported'),
      )

      expectErr(await call(), 'WHATSAPP_GROUP_PROVIDER_UNSUPPORTED')
    })
  },
)

describe('WhatsAppGroupService.updateInfo() branches', () => {
  it('should only push the photo when just the image changes', async () => {
    arrangeGroup()

    expectOk(
      await WhatsAppGroupService.updateInfo('u1', 'ws1', 'g1', {
        imageUrl: 'https://cdn.example.com/g.png',
      }),
    )

    expect(updateZapiGroupName).not.toHaveBeenCalled()
    expect(updateZapiGroupDescription).not.toHaveBeenCalled()
    expect(updateZapiGroupPhoto).toHaveBeenCalledWith(expect.anything(), {
      groupJid: '120363000000000000@g.us',
      imageUrl: 'https://cdn.example.com/g.png',
    })
  })

  it('should propagate a local update failure', async () => {
    arrangeGroup()
    mockedGroupRepo.update.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppGroupService.updateInfo('u1', 'ws1', 'g1', { name: 'X' }),
      'DATABASE_ERROR',
    )
  })

  it('should propagate a failure reloading the group', async () => {
    arrangeGroup()
    mockedGroupRepo.findById
      .mockResolvedValueOnce(ok(group()))
      .mockResolvedValueOnce(err(DB_ERROR))

    expectErr(
      await WhatsAppGroupService.updateInfo('u1', 'ws1', 'g1', { name: 'X' }),
      'DATABASE_ERROR',
    )
  })

  it('should return WHATSAPP_GROUP_NOT_FOUND when the reload finds nothing', async () => {
    arrangeGroup()
    mockedGroupRepo.findById
      .mockResolvedValueOnce(ok(group()))
      .mockResolvedValueOnce(ok(null))

    expectErr(
      await WhatsAppGroupService.updateInfo('u1', 'ws1', 'g1', { name: 'X' }),
      'WHATSAPP_GROUP_NOT_FOUND',
    )
  })
})

describe('WhatsAppGroupService participant sync', () => {
  const addParticipants = () =>
    WhatsAppGroupService.addParticipants('u1', 'ws1', 'g1', {
      waIds: ['5511988887777'],
    })

  it('should map admins and names from provider metadata', async () => {
    arrangeGroup()
    vi.mocked(getZapiGroupMetadata).mockResolvedValue({
      phone: '120363000000000000@g.us',
      subject: 'Time',
      participants: [
        { phone: '5511988887777', isAdmin: true },
        { phone: '5511911112222', isAdmin: false },
      ],
    } as never)
    mockedContactRepo.findManyByWaIds.mockResolvedValue(
      ok([createFakeWhatsAppContact({ waId: '5511988887777', name: 'Maria' })]),
    )

    expectOk(await addParticipants())

    expect(mockedGroupRepo.replaceParticipants).toHaveBeenCalledWith('g1', [
      { waId: '5511988887777', name: 'Maria', role: 'ADMIN' },
      { waId: '5511911112222', name: undefined, role: 'MEMBER' },
    ])
  })

  it('should map a metadata exception to WHATSAPP_PROVIDER_ERROR', async () => {
    arrangeGroup()
    vi.mocked(getZapiGroupMetadata).mockRejectedValue(new Error('timeout'))

    const error = expectErr(await addParticipants(), 'WHATSAPP_PROVIDER_ERROR')
    expect(error.message).toBe('timeout')
  })

  it('should use a generic message for a non-Error metadata rejection', async () => {
    arrangeGroup()
    vi.mocked(getZapiGroupMetadata).mockRejectedValue({ status: 500 })

    const error = expectErr(await addParticipants(), 'WHATSAPP_PROVIDER_ERROR')
    expect(error.message).toBe('Falha ao sincronizar participantes do grupo')
  })

  it('should propagate a failure reloading the synced group', async () => {
    arrangeGroup()
    mockedGroupRepo.findById
      .mockResolvedValueOnce(ok(group()))
      .mockResolvedValueOnce(err(DB_ERROR))

    expectErr(await addParticipants(), 'DATABASE_ERROR')
  })

  it('should return WHATSAPP_GROUP_NOT_FOUND when the synced group vanished', async () => {
    arrangeGroup()
    mockedGroupRepo.findById
      .mockResolvedValueOnce(ok(group()))
      .mockResolvedValueOnce(ok(null))

    expectErr(await addParticipants(), 'WHATSAPP_GROUP_NOT_FOUND')
  })
})

describe('WhatsAppGroupService misc failures', () => {
  it('getInviteLink() should fail when the provider has no link', async () => {
    arrangeGroup()
    vi.mocked(getZapiGroupInviteLink).mockResolvedValue(null)

    const error = expectErr(
      await WhatsAppGroupService.getInviteLink('u1', 'ws1', 'g1'),
      'WHATSAPP_PROVIDER_ERROR',
    )
    expect(error.message).toBe('Link de convite indisponível')
    expect(mockedGroupRepo.update).not.toHaveBeenCalled()
  })

  it('leave() should propagate the archive failure', async () => {
    arrangeGroup()
    mockedGroupRepo.update.mockResolvedValue(err(DB_ERROR))

    expectErr(
      await WhatsAppGroupService.leave('u1', 'ws1', 'g1'),
      'DATABASE_ERROR',
    )
  })

  const sendText = () =>
    WhatsAppGroupService.sendText('u1', 'ws1', 'g1', { text: 'Olá' })

  it('sendText() should return FORBIDDEN for a non-member', async () => {
    asNonMember()

    expectErr(await sendText(), 'FORBIDDEN')
  })

  it('sendText() should propagate a send failure without persisting', async () => {
    arrangeGroup()
    vi.mocked(WhatsAppSend.text).mockResolvedValue(
      err({ code: 'WHATSAPP_PROVIDER_ERROR', message: 'offline' }),
    )

    expectErr(await sendText(), 'WHATSAPP_PROVIDER_ERROR')
    expect(mockedGroupMessageRepo.create).not.toHaveBeenCalled()
  })

  it('sendText() should propagate a failure persisting the message', async () => {
    arrangeGroup()
    vi.mocked(WhatsAppSend.text).mockResolvedValue(
      ok({ providerMessageId: 'pm1' }) as never,
    )
    mockedGroupMessageRepo.create.mockResolvedValue(err(DB_ERROR))

    expectErr(await sendText(), 'DATABASE_ERROR')
    expect(mockedGroupRepo.update).not.toHaveBeenCalled()
  })

  it('sendText() should persist and stamp the group on success', async () => {
    arrangeGroup()
    vi.mocked(WhatsAppSend.text).mockResolvedValue(
      ok({ providerMessageId: 'pm1' }) as never,
    )
    mockedGroupMessageRepo.create.mockResolvedValue(
      ok(createFakeWhatsAppGroupMessage({ id: 'gm1', groupId: 'g1' })),
    )

    expect(expectOk(await sendText()).id).toBe('gm1')
    expect(mockedGroupRepo.update).toHaveBeenCalledWith('g1', {
      lastMessageAt: expect.any(Date),
    })
  })
})
