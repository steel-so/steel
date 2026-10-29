import { auditMutation } from '@/lib/axiom/audit'
import { logger } from '@/lib/axiom/logger'
import { err, ok, type Result } from '@/src/lib/result'
import { CrmCnpjRunRepository } from '@/src/repositories/crm-cnpj-run.repository'
import { enrichCompany } from './crm-cnpj-enrichment.service'

/**
 * Worker side of the bulk CNPJ enrichment. Walks the workspace's companies
 * that have a CNPJ in id order, one provider call at a time (the public
 * BrasilAPI is rate limited per IP), and writes the counters after every
 * page so the UI can show progress.
 */

const PAGE_SIZE = 25
/** Pause between provider calls to stay under the public rate limit. */
const CALL_GAP_MS = 400
const RATE_LIMIT_BACKOFF_MS = 30_000
const MAX_RATE_LIMIT_RETRIES = 3

type RunSummary = {
  status: 'COMPLETED' | 'FAILED'
  processed: number
  enriched: number
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

export const CrmCnpjEnrichmentRunner = {
  async run(
    runId: string,
    sleep: (ms: number) => Promise<void> = defaultSleep,
  ): Promise<Result<RunSummary>> {
    const found = await CrmCnpjRunRepository.findByIdForWorker(runId)
    if (!found.ok) return found
    const run = found.value
    // A finished run is never replayed (a duplicated job is a no-op).
    if (run.status === 'COMPLETED' || run.status === 'FAILED') {
      return ok({
        status: run.status,
        processed: run.processed,
        enriched: run.enriched,
      })
    }

    const started = await CrmCnpjRunRepository.update(run.id, {
      status: 'RUNNING',
      startedAt: new Date(),
      processed: 0,
      enriched: 0,
      notFound: 0,
      invalid: 0,
      failed: 0,
      error: null,
    })
    if (!started.ok) return started

    const counts = {
      processed: 0,
      enriched: 0,
      notFound: 0,
      invalid: 0,
      failed: 0,
    }
    let afterId: string | undefined

    for (;;) {
      const page = await CrmCnpjRunRepository.listTargets(run.workspaceId, {
        onlyMissing: run.onlyMissing,
        afterId,
        take: PAGE_SIZE,
      })
      if (!page.ok) {
        await CrmCnpjRunRepository.update(run.id, {
          ...counts,
          status: 'FAILED',
          error: 'Falha ao ler as empresas do workspace',
          finishedAt: new Date(),
        })
        return page
      }
      if (page.value.length === 0) break

      for (const company of page.value) {
        let attempt = 0
        for (;;) {
          const result = await enrichCompany({
            workspaceId: run.workspaceId,
            actorId: run.createdById,
            company,
            overwrite: run.overwrite,
          })
          if (
            !result.ok &&
            result.error.code === 'CRM_CNPJ_RATE_LIMITED' &&
            attempt < MAX_RATE_LIMIT_RETRIES
          ) {
            attempt += 1
            await sleep(RATE_LIMIT_BACKOFF_MS * attempt)
            continue
          }
          counts.processed += 1
          if (result.ok) counts.enriched += 1
          else if (result.error.code === 'CRM_CNPJ_NOT_FOUND')
            counts.notFound += 1
          else if (result.error.code === 'CRM_CNPJ_INVALID') counts.invalid += 1
          else counts.failed += 1
          break
        }
        await sleep(CALL_GAP_MS)
      }

      afterId = page.value[page.value.length - 1].id
      const progress = await CrmCnpjRunRepository.update(run.id, counts)
      if (!progress.ok) {
        logger.warn('crm.cnpj.run_progress_failed', {
          runId: run.id,
          code: progress.error.code,
        })
      }
    }

    const done = await CrmCnpjRunRepository.update(run.id, {
      ...counts,
      status: 'COMPLETED',
      finishedAt: new Date(),
    })
    if (!done.ok) return err(done.error)

    auditMutation({
      entity: 'crm_cnpj_enrichment',
      action: 'update',
      actorId: run.createdById,
      targetId: run.id,
      meta: {
        ...counts,
        onlyMissing: run.onlyMissing,
        overwrite: run.overwrite,
      },
    })

    return ok({
      status: 'COMPLETED',
      processed: counts.processed,
      enriched: counts.enriched,
    })
  },
}
