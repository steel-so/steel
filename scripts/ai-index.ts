import { prisma } from '@/src/lib/prisma'
import { AiKnowledgeChunkRepository } from '@/src/repositories/ai-knowledge-chunk.repository'
import { AiKnowledgeIndexService } from '@/src/services/ai-knowledge-index.service'

/**
 * Builds the Steel AI knowledge index (`ai_knowledge_chunks` + embeddings,
 * ADR 0037) inline — no worker needed. With no argument, every workspace
 * with Steel AI on; with an id or slug, just that one. It first turns the
 * pgvector sidecar on if the extension is installed. Safe to run any time:
 * it upserts, drops only stale chunks and re-embeds only changed text.
 *
 *   pnpm ai:index [workspaceIdOrSlug]
 */
async function main() {
  const identifier = process.argv[2]
  const startedAt = Date.now()

  if (!identifier) {
    const result = await AiKnowledgeIndexService.reindexAll()
    if (!result.ok) throw new Error(result.error.message)
    const v = result.value
    console.log(
      `Knowledge index rebuilt: ${v.workspaces} workspace(s), ${v.indexed} ` +
        `source(s), ${v.removed} removed, ${v.embedded} chunk(s) embedded, ` +
        `${v.failed} failed, vector index ${v.vectorIndexReady ? 'on' : 'off'} ` +
        `— ${Date.now() - startedAt} ms`,
    )
    if (v.failed > 0) process.exitCode = 1
    return
  }

  const workspace = await prisma.workspace.findFirst({
    where: { OR: [{ id: identifier }, { slug: identifier }] },
    select: { id: true, slug: true },
  })
  if (!workspace) {
    console.error(`Workspace "${identifier}" not found.`)
    process.exitCode = 1
    return
  }

  const vector = await AiKnowledgeChunkRepository.enableVector()
  const result = await AiKnowledgeIndexService.reindexWorkspace(workspace.id)
  if (!result.ok) throw new Error(result.error.message)
  const v = result.value
  console.log(
    v.purged
      ? `Steel AI is off in ${workspace.slug}: its knowledge index was purged.`
      : `Knowledge index rebuilt for ${workspace.slug}: ${v.indexed} source(s), ` +
          `${v.removed} removed, ${v.embedded} chunk(s) embedded, vector index ` +
          `${vector.ok && vector.value ? 'on' : 'off'} — ${Date.now() - startedAt} ms`,
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
