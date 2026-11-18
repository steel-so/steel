import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest'
import { createFakeMembership } from '@/src/__tests__/factories/membership.factory'
import {
  createFakeWaDashboardAdReferral,
  createFakeWaDashboardAdSpend,
  createFakeWaDashboardAppointment,
  createFakeWaDashboardBoletoCharge,
  createFakeWaDashboardCall,
  createFakeWaDashboardChatbotSession,
  createFakeWaDashboardContact,
  createFakeWaDashboardFlowResponse,
  createFakeWaDashboardPixCharge,
} from '@/src/__tests__/factories/whatsapp-dashboard-channels.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/src/repositories/membership.repository')
vi.mock('@/src/repositories/whatsapp-dashboard-source.repository')
vi.mock('@/src/repositories/whatsapp-dashboard-channels.repository')
vi.mock('@/lib/axiom/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { MembershipRepository } from '@/src/repositories/membership.repository'
import { WhatsAppDashboardChannelsRepository } from '@/src/repositories/whatsapp-dashboard-channels.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import {
  WA_DASHBOARD_ROW_LIMITS,
  type WaDashboardSource,
} from '@/src/schemas/whatsapp-dashboard.schema'
import { WhatsAppDashboardSourceService } from '../whatsapp-dashboard-source.service'

const repo = vi.mocked(WhatsAppDashboardChannelsRepository)
const membership = vi.mocked(MembershipRepository)
const moduleAccess = vi.mocked(WorkspaceModuleAccessRepository)
const WS = 'ws1'
const NOW = new Date('2026-11-18T12:00:00.000Z')
const SINCE_MS = NOW.getTime() - 400 * 86_400_000

type RepoMethod = keyof typeof WhatsAppDashboardChannelsRepository

/** The methods share the arguments but not the payload: read them loosely. */
function mockOf(method: RepoMethod): Mock {
  return repo[method] as unknown as Mock
}

/** Source, the repository method behind it and the row it must answer. */
const CASES: Array<{
  source: WaDashboardSource
  method: RepoMethod
  arrange: () => void
  expected: Record<string, unknown>
}> = [
  {
    source: 'whatsapp-calls',
    method: 'calls',
    arrange: () =>
      repo.calls.mockResolvedValue(ok([createFakeWaDashboardCall()])),
    expected: { status: 'Atendida', attendant: 'Ana', answeredPct: 100 },
  },
  {
    source: 'whatsapp-charges',
    method: 'chargeData',
    arrange: () =>
      repo.chargeData.mockResolvedValue(
        ok({
          // Deadline one hour before `NOW`: the loader reads the clock.
          pixCharges: [
            createFakeWaDashboardPixCharge({
              expiresAt: new Date(NOW.getTime() - 3_600_000),
            }),
          ],
          boletoCharges: [],
          users: [],
        }),
      ),
    expected: { method: 'Pix', status: 'Vencido', amount: 150.5 },
  },
  {
    source: 'whatsapp-appointments',
    method: 'appointments',
    arrange: () =>
      repo.appointments.mockResolvedValue(
        ok([createFakeWaDashboardAppointment()]),
      ),
    expected: { service: 'Consulta', isUpcoming: true },
  },
  {
    source: 'whatsapp-chatbot-sessions',
    method: 'chatbotSessions',
    arrange: () =>
      repo.chatbotSessions.mockResolvedValue(
        ok([createFakeWaDashboardChatbotSession()]),
      ),
    expected: { chatbot: 'Triagem', status: 'Concluído' },
  },
  {
    source: 'whatsapp-flow-responses',
    method: 'flowResponseData',
    arrange: () =>
      repo.flowResponseData.mockResolvedValue(
        ok({ responses: [createFakeWaDashboardFlowResponse()], users: [] }),
      ),
    expected: { flow: 'Cadastro de clientes', status: 'Aguardando resposta' },
  },
  {
    source: 'whatsapp-ad-referrals',
    method: 'adReferralData',
    arrange: () =>
      repo.adReferralData.mockResolvedValue(
        ok({
          referrals: [createFakeWaDashboardAdReferral()],
          conversations: [],
        }),
      ),
    expected: { sourceType: 'Anúncio', ad: 'Portabilidade sem taxa' },
  },
  {
    source: 'whatsapp-ad-spends',
    method: 'adSpends',
    arrange: () =>
      repo.adSpends.mockResolvedValue(ok([createFakeWaDashboardAdSpend()])),
    expected: { ad: 'Campanha de novembro', amount: 1000 },
  },
  {
    source: 'whatsapp-contacts',
    method: 'contacts',
    arrange: () =>
      repo.contacts.mockResolvedValue(ok([createFakeWaDashboardContact()])),
    expected: { hasWhatsapp: 'Não verificado', isBlocked: false },
  },
]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  membership.findByUserAndWorkspace.mockResolvedValue(
    ok(createFakeMembership({ role: 'VIEWER' })),
  )
  moduleAccess.isEnabled.mockResolvedValue(ok(true))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('WhatsAppDashboardSourceService.rows (channel sources)', () => {
  it.each(CASES)(
    'should map the rows of $source over the history window',
    async ({ source, method, arrange, expected }) => {
      arrange()

      const rows = expectOk(
        await WhatsAppDashboardSourceService.rows('u1', WS, source, NOW),
      )

      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject(expected)
      expect(mockOf(method)).toHaveBeenCalledTimes(1)
      const [workspaceId, since, limit] = mockOf(method).mock.calls[0]
      expect(workspaceId).toBe(WS)
      expect((since as Date).getTime()).toBe(SINCE_MS)
      expect(limit).toBe(WA_DASHBOARD_ROW_LIMITS[source])
    },
  )

  it.each(CASES)(
    'should propagate a repository failure of $source',
    async ({ source, method }) => {
      mockOf(method).mockResolvedValue(err(databaseError('boom')))

      expectErr(
        await WhatsAppDashboardSourceService.rows('u1', WS, source, NOW),
        'DATABASE_ERROR',
      )
    },
  )

  it('should refuse when the module is disabled', async () => {
    moduleAccess.isEnabled.mockResolvedValue(ok(false))

    expectErr(
      await WhatsAppDashboardSourceService.rows('u1', WS, 'whatsapp-contacts'),
      'MODULE_DISABLED',
    )
    expect(repo.contacts).not.toHaveBeenCalled()
  })

  it('should cut the merged charges at the row limit', async () => {
    const limit = WA_DASHBOARD_ROW_LIMITS['whatsapp-charges']
    const pix = createFakeWaDashboardPixCharge()
    const boleto = createFakeWaDashboardBoletoCharge()
    repo.chargeData.mockResolvedValue(
      ok({
        pixCharges: Array.from({ length: limit }, () => pix),
        boletoCharges: [boleto],
        users: [],
      }),
    )

    const rows = expectOk(
      await WhatsAppDashboardSourceService.rows('u1', WS, 'whatsapp-charges'),
    )

    expect(rows).toHaveLength(limit)
  })
})
