import { afterEach, vi } from 'vitest'
import { ok } from '@/src/lib/result'

// Services de módulo (CRM, Comunicação) passam por `assertModuleMember`, que
// consulta se o módulo está habilitado. Nos testes unitários o padrão é
// "habilitado" — testes que exercitam o bloqueio sobrescrevem `isEnabled`
// (ou re-mockam o módulo no próprio arquivo).
vi.mock('@/src/repositories/workspace-module-access.repository', () => ({
  WorkspaceModuleAccessRepository: {
    listByWorkspace: vi.fn(async () => ok([])),
    upsert: vi.fn(),
    isEnabled: vi.fn(async () => ok(true)),
  },
}))

// Trilha do painel admin (`recordAdminAction`): nos unitários, gravar a
// linha é no-op; testes que verificam a trilha mockam `@/src/lib/admin-audit`.
vi.mock('@/src/repositories/admin-audit-log.repository', () => ({
  AdminAuditLogRepository: {
    create: vi.fn(async () => ok({})),
    listRecent: vi.fn(async () => ok([])),
    listByTarget: vi.fn(async () => ok([])),
  },
}))

// Search index hooks (`indexSearchDocument`, fire-and-forget after writes):
// no-op in unit tests; `search-index-hooks.test.ts` un-mocks the module.
vi.mock('@/src/lib/search/index-hooks', () => ({
  indexSearchDocument: vi.fn(async () => undefined),
  removeSearchDocument: vi.fn(async () => undefined),
}))

// Equipes (Comunicação): the conversation visibility reads the team snapshot
// through Redis. Unit default = cache miss + a workspace without teams;
// `whatsapp-team*.test.ts` drive these mocks to exercise the rule.
vi.mock('@/src/cache/whatsapp-team.cache', () => ({
  WhatsAppTeamSnapshotCache: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    invalidate: vi.fn(async () => undefined),
  },
}))
vi.mock('@/src/repositories/whatsapp-team.repository', () => ({
  WhatsAppTeamRepository: {
    listByWorkspace: vi.fn(async () => ok([])),
    findById: vi.fn(async () => ok(null)),
    listMembershipSnapshot: vi.fn(async () => ok([])),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(async () => ok(undefined)),
  },
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})
