import { logger } from '@/lib/axiom/logger'
import { crmCampaignLinkInvalid } from '@/src/errors'
import {
  isTrackableUrl,
  verifyCadenceClickToken,
  verifyCadenceOpenToken,
} from '@/src/lib/crm-cadence/tracking'
import { err, ok, type Result } from '@/src/lib/result'
import {
  CrmCadenceEnrollmentRepository,
  CrmCadenceRunRepository,
} from '@/src/repositories/crm-cadence.repository'

/**
 * Open pixel and link redirect of the cadence e-mail steps. Both public entry
 * points are best-effort: tracking never breaks the e-mail rendering or the
 * visitor's navigation.
 */

/**
 * Security gateways open every link seconds after delivery. A click this soon
 * after the send is counted but never ends the cadence.
 */
export const CADENCE_SCANNER_WINDOW_MS = 10_000

export const CrmCadenceTrackingService = {
  /** Open pixel. Returns whether an open was recorded. */
  async recordOpen(token: string, now: Date): Promise<Result<boolean>> {
    const runId = verifyCadenceOpenToken(token)
    if (!runId) return ok(false)
    const run = await CrmCadenceRunRepository.findForTracking(runId)
    if (!run.ok) return run
    if (!run.value) return ok(false)
    const recorded = await CrmCadenceRunRepository.recordOpen(runId, now)
    return recorded.ok ? ok(true) : recorded
  },

  /**
   * Click redirect: records the click and, when the cadence is set to stop on
   * click, ends the enrollment. Returns the destination, which is the URL the
   * token was signed for (never an arbitrary one).
   */
  async resolveClick(
    token: string,
    url: string,
    now: Date,
  ): Promise<Result<string>> {
    if (!isTrackableUrl(url)) return err(crmCampaignLinkInvalid())
    const runId = verifyCadenceClickToken(token, url)
    if (!runId) return err(crmCampaignLinkInvalid())

    const run = await CrmCadenceRunRepository.findForTracking(runId)
    if (!run.ok || !run.value) {
      if (!run.ok) logTrackingFailure('lookup', runId, run.error.code)
      // The link was signed by us: the visitor still gets where they wanted.
      return ok(url)
    }
    const recorded = await CrmCadenceRunRepository.recordClick(runId, now)
    if (!recorded.ok) logTrackingFailure('click', runId, recorded.error.code)

    const { cadence, enrollment } = run.value
    const open =
      enrollment.status === 'ACTIVE' || enrollment.status === 'PAUSED'
    const scanner =
      now.getTime() - run.value.createdAt.getTime() < CADENCE_SCANNER_WINDOW_MS
    if (cadence.stopOnClick && open && !scanner) {
      const stopped = await CrmCadenceEnrollmentRepository.finish(
        [run.value.enrollmentId],
        'STOPPED',
        'CLICKED',
        null,
        now,
      )
      if (!stopped.ok) logTrackingFailure('stop', runId, stopped.error.code)
    }
    return ok(url)
  },
}

function logTrackingFailure(step: string, runId: string, reason: string) {
  logger.warn('crm.cadence.tracking_failed', {
    component: 'CrmCadenceTrackingService',
    step,
    runId,
    reason,
  })
}
