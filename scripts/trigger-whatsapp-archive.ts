import { prisma } from '@/src/lib/prisma'
import { closeQueues } from '@/src/lib/queue/queues'
import { WhatsAppArchiveService } from '@/src/services/whatsapp-archive.service'

/**
 * Queues a WhatsApp archive package (ADR 0052) for one workspace, by id or
 * slug. `--weekly` (default) = the previous week; `--full` = all history up
 * to the end of the previous month. The archive must be on for the
 * workspace (admin panel). The worker builds it asynchronously — follow the
 * `whatsapp_archives` table or the worker logs.
 *
 *   pnpm archive:whatsapp <workspaceIdOrSlug> [--weekly|--full]
 */
async function main() {
  const args = process.argv.slice(2)
  const identifier = args.find((arg) => !arg.startsWith('--'))
  const full = args.includes('--full')
  if (!identifier || (full && args.includes('--weekly'))) {
    console.error(
      'Uso: pnpm archive:whatsapp <workspaceIdOuSlug> [--weekly|--full]',
    )
    process.exitCode = 1
    return
  }

  const workspace = await prisma.workspace.findFirst({
    where: { OR: [{ id: identifier }, { slug: identifier }] },
    select: { id: true, name: true, slug: true },
  })
  if (!workspace) {
    console.error(`Workspace "${identifier}" não encontrado.`)
    process.exitCode = 1
    return
  }

  const kind = full ? 'MONTHLY_FULL' : 'WEEKLY'
  const result = await WhatsAppArchiveService.request({
    workspaceId: workspace.id,
    kind,
    triggeredById: null,
    source: 'script',
  })
  if (!result.ok) {
    console.error(`Não foi possível enfileirar: ${result.error.message}`)
    process.exitCode = 1
    return
  }

  console.log(
    `Pacote ${full ? 'completo' : 'semanal'} enfileirado para "${workspace.name}" ` +
      `(${workspace.slug}): ${result.value.archive.id}. Acompanhe na tabela ` +
      '`whatsapp_archives` ou nos logs do worker.',
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    await closeQueues()
  })
