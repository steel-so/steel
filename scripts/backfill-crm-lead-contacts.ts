import { prisma } from '@/src/lib/prisma'
import { syncLeadContacts } from '@/src/services/crm-lead-contact-sync'

/**
 * Cria, como contatos do WhatsApp ("Lead do CRM"), os telefones dos leads que
 * já existiam nos workspaces com CRM e Comunicação habilitados. Os leads
 * novos entram sozinhos. Idempotente — seguro rodar mais de uma vez.
 *
 *   pnpm seed:crm-lead-contacts
 */
async function main() {
  const crm = await prisma.workspaceModuleAccess.findMany({
    where: { module: 'CRM', enabled: true },
    select: { workspaceId: true },
  })
  const comm = new Set(
    (
      await prisma.workspaceModuleAccess.findMany({
        where: { module: 'COMMUNICATION', enabled: true },
        select: { workspaceId: true },
      })
    ).map((grant) => grant.workspaceId),
  )
  const workspaces = crm.filter((grant) => comm.has(grant.workspaceId))
  console.log(`${workspaces.length} workspace(s) com CRM e Comunicação.`)

  for (const { workspaceId } of workspaces) {
    const leads = await prisma.crmLead.findMany({
      where: { workspaceId, deletedAt: null, phones: { isEmpty: false } },
      select: { name: true, phones: true },
    })
    for (const lead of leads) {
      await syncLeadContacts(workspaceId, lead.name, lead.phones)
    }
    console.log(`✓ ${workspaceId}: ${leads.length} lead(s) com telefone`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
