import { createId } from '@paralleldrive/cuid2'
import type {
  Prisma,
  SdIntegrationLink,
  WorkspaceIntegration,
} from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

/**
 * Factories of the integrations: the workspace-level connections (Slack,
 * GitHub, GitLab — ADR 0024) and the ServiceDesk ticket links. The
 * `encryptedToken` is any text: tests that decrypt double `@/src/lib/crypto`,
 * so the envelope does not need to be real.
 */

const fixed = () => new Date('2026-10-02T12:00:00.000Z')

export function createFakeWorkspaceIntegration(
  overrides?: Partial<WorkspaceIntegration>,
): WorkspaceIntegration {
  return {
    id: 'int-slack-1',
    workspaceId: 'ws1',
    kind: 'SLACK',
    status: 'ACTIVE',
    statusError: null,
    externalId: 'T0001',
    externalName: 'Stratus',
    baseUrl: null,
    encryptedToken: 'enc:xoxb-token',
    encryptedSigningSecret: null,
    config: {},
    lastEventAt: null,
    lastEventType: null,
    lastCheckedAt: null,
    createdById: 'u1',
    createdAt: fixed(),
    updatedAt: fixed(),
    deletedAt: null,
    ...overrides,
  }
}

/** Slack connection (kept under the historical name). */
export const createFakeSdIntegration = createFakeWorkspaceIntegration

export function createFakeSdGithubIntegration(
  overrides?: Partial<WorkspaceIntegration>,
): WorkspaceIntegration {
  return createFakeWorkspaceIntegration({
    id: 'int-gh-1',
    kind: 'GITHUB',
    externalId: 'steel-so/steel',
    externalName: 'steel-so/steel',
    encryptedToken: 'enc:github_pat',
    encryptedSigningSecret: 'enc:hook-secret',
    config: {
      servicedesk: { suggestPhaseOnClose: true, allowIssueFromTicket: true },
    },
    ...overrides,
  })
}

export function createFakeGitlabIntegration(
  overrides?: Partial<WorkspaceIntegration>,
): WorkspaceIntegration {
  return createFakeWorkspaceIntegration({
    id: 'int-gl-1',
    kind: 'GITLAB',
    externalId: 'stratus/steel',
    externalName: 'stratus/steel',
    baseUrl: 'https://gitlab.com',
    encryptedToken: 'enc:gitlab-token',
    encryptedSigningSecret: 'enc:gl-hook-secret',
    config: {
      servicedesk: { suggestPhaseOnClose: true, allowIssueFromTicket: true },
    },
    ...overrides,
  })
}

export function createFakeSdIntegrationLink(
  overrides?: Partial<SdIntegrationLink>,
): SdIntegrationLink {
  return {
    id: 'link-1',
    workspaceId: 'ws1',
    integrationId: 'int-gh-1',
    ticketId: 't1',
    kind: 'GITHUB_ISSUE',
    externalKey: 'steel-so/steel#42',
    externalUrl: 'https://github.com/steel-so/steel/issues/42',
    externalState: 'open',
    meta: { title: 'Fila de e-mail travando' },
    createdById: 'u1',
    createdAt: fixed(),
    updatedAt: fixed(),
    ...overrides,
  }
}

export async function seedWorkspaceIntegration(
  workspaceId: string,
  createdById: string,
  overrides?: Partial<Prisma.WorkspaceIntegrationUncheckedCreateInput>,
) {
  return prisma.workspaceIntegration.create({
    data: {
      workspaceId,
      createdById,
      kind: 'SLACK',
      externalId: `T-${createId()}`,
      externalName: 'Stratus',
      encryptedToken: 'enc:xoxb-token',
      config: {},
      ...overrides,
    },
  })
}

/** Historical name used by the ServiceDesk tests. */
export const seedSdIntegration = seedWorkspaceIntegration

export async function seedSdIntegrationLink(
  workspaceId: string,
  integrationId: string,
  ticketId: string,
  overrides?: Partial<Prisma.SdIntegrationLinkUncheckedCreateInput>,
) {
  return prisma.sdIntegrationLink.create({
    data: {
      workspaceId,
      integrationId,
      ticketId,
      kind: 'GITHUB_ISSUE',
      externalKey: `owner/repo#${Math.floor(Math.random() * 100000)}`,
      externalState: 'open',
      ...overrides,
    },
  })
}
