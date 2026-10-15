import { hash } from 'argon2'
import { DATABASE_URL } from '@/lib/env/server'
import { prisma } from '@/src/lib/prisma'
import { generateUniqueUsername } from '@/src/lib/username'
import { WhatsAppTeamService } from '@/src/services/whatsapp-team.service'
import { WorkspaceService } from '@/src/services/workspace.service'
import { WorkspaceModuleAccessService } from '@/src/services/workspace-module-access.service'

/**
 * Fills a LOCAL database with everything needed to open the app and work:
 * verified users (password login, terms accepted, onboarding done), a
 * workspace on the trial plan with the three modules enabled (each module's
 * default seed runs: zap dashboards, CRM pipeline, ServiceDesk ITIL
 * defaults), the wiki on, and a zap team with a leader and an agent.
 * Idempotent: re-running keeps existing rows and fills what is missing.
 *
 *   pnpm seed:dev
 *   pnpm seed:dev --workspace acme --name "Acme" --password 'Outra@senha1'
 *
 * Refuses to run against a non-local database.
 */

function arg(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag)
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback
}

const PASSWORD = arg('--password', 'Steel@dev2026')
const WORKSPACE_SLUG = arg('--workspace', 'demo')
const WORKSPACE_NAME = arg('--name', 'Demo Steel')

// The owner is a platform admin (enabling modules requires it), and platform
// admins must use the Stratus domain. These users only exist locally.
const USERS = [
  {
    key: 'owner',
    email: 'dev.seed@stratustelecom.com.br',
    name: 'Dev Steel',
    role: 'OWNER',
  },
  {
    key: 'admin',
    email: 'admin.seed@stratustelecom.com.br',
    name: 'Ana Admin',
    role: 'ADMIN',
  },
  {
    key: 'leader',
    email: 'lider.seed@stratustelecom.com.br',
    name: 'Lia Líder',
    role: 'MEMBER',
  },
  {
    key: 'agent',
    email: 'agente.seed@stratustelecom.com.br',
    name: 'Beto Agente',
    role: 'MEMBER',
  },
] as const

const MODULES = ['SERVICE_DESK', 'CRM', 'COMMUNICATION'] as const

function assertLocalDatabase() {
  const host = new URL(DATABASE_URL).hostname
  if (!['localhost', '127.0.0.1', '::1', 'steel-db'].includes(host)) {
    console.error(
      `✗ seed:dev only runs against a local database (got ${host}).`,
    )
    process.exit(1)
  }
}

async function upsertUser(input: (typeof USERS)[number], passwordHash: string) {
  const now = new Date()
  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: {},
    create: {
      email: input.email,
      name: input.name,
      username: await generateUniqueUsername(
        input.email,
        async (u) => (await prisma.user.count({ where: { username: u } })) > 0,
      ),
      emailVerified: true,
      acceptedTermsAt: now,
      acceptedPrivacyAt: now,
      onboardingStep: null,
      isPlatformAdmin: input.role === 'OWNER',
    },
  })
  const credential = await prisma.account.findFirst({
    where: { userId: user.id, providerId: 'credential' },
  })
  if (!credential) {
    await prisma.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: 'credential',
        password: passwordHash,
      },
    })
  }
  return user
}

async function main() {
  assertLocalDatabase()
  const passwordHash = await hash(PASSWORD)

  const users = new Map<string, { id: string; email: string }>()
  for (const input of USERS) {
    users.set(input.key, await upsertUser(input, passwordHash))
  }
  const owner = users.get('owner')
  if (!owner) throw new Error('owner not created')

  let workspace = await prisma.workspace.findUnique({
    where: { slug: WORKSPACE_SLUG },
  })
  if (!workspace) {
    const created = await WorkspaceService.create(owner.id, {
      name: WORKSPACE_NAME,
      slug: WORKSPACE_SLUG,
    })
    if (!created.ok) throw new Error(`workspace: ${created.error.code}`)
    workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: created.value.id },
    })
  }
  await prisma.workspace.update({
    where: { id: workspace.id },
    data: { wikiEnabled: true },
  })

  for (const input of USERS) {
    if (input.role === 'OWNER') continue
    const user = users.get(input.key)
    if (!user) continue
    await prisma.membership.upsert({
      where: {
        userId_workspaceId: { userId: user.id, workspaceId: workspace.id },
      },
      update: {},
      create: { userId: user.id, workspaceId: workspace.id, role: input.role },
    })
  }

  for (const module of MODULES) {
    const enabled = await WorkspaceModuleAccessService.isModuleEnabled(
      workspace.id,
      module,
    )
    if (enabled.ok && enabled.value) continue
    const result = await WorkspaceModuleAccessService.setEnabled(
      owner.id,
      workspace.id,
      module,
      true,
    )
    if (!result.ok) throw new Error(`module ${module}: ${result.error.code}`)
  }

  const team = await prisma.whatsAppTeam.findFirst({
    where: { workspaceId: workspace.id, name: 'Suporte' },
  })
  const leader = users.get('leader')
  const agent = users.get('agent')
  if (!team && leader && agent) {
    const created = await WhatsAppTeamService.create(owner.id, workspace.id, {
      name: 'Suporte',
      description: 'Equipe de exemplo do seed:dev',
      members: [
        { userId: leader.id, role: 'LEADER' },
        { userId: agent.id, role: 'AGENT' },
      ],
    })
    if (!created.ok) throw new Error(`team: ${created.error.code}`)
  }

  console.log(`✓ Workspace /${WORKSPACE_SLUG} ready (${MODULES.join(', ')})`)
  console.log(`  Password for every user: ${PASSWORD}`)
  for (const input of USERS) {
    console.log(`  ${input.role.padEnd(6)} ${input.email}`)
  }
}

main()
  .catch((error) => {
    console.error('✗ seed:dev failed:', error)
    process.exitCode = 1
  })
  // Redis/BullMQ clients opened by the services keep the event loop alive.
  .finally(async () => {
    await prisma.$disconnect()
    process.exit()
  })
