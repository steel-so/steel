import { logFields } from '@/lib/axiom/log-fields'
import { logger } from '@/lib/axiom/logger'
import { appError } from '@/src/errors/app-error'
import { SteelAgentsJob } from '@/src/lib/queue/jobs'
import { getSteelAgentsQueue } from '@/src/lib/queue/queues'
import { err, ok, type Result } from '@/src/lib/result'

/**
 * Enqueues the execution (or resumption) of a run. Never throws: a Redis
 * failure comes back as an error — the run stays QUEUED/WAITING and the
 * next decision or a manual retry picks it up.
 */
export async function enqueueSteelAgentRun(
  runId: string,
): Promise<Result<true>> {
  try {
    await getSteelAgentsQueue().add(SteelAgentsJob.Run, { runId })
    return ok(true)
  } catch (cause) {
    logger.error(
      'steel_agents.enqueue_failed',
      logFields(
        {
          component: 'SteelAgents',
          message: cause instanceof Error ? cause.message : String(cause),
        },
        { runId },
      ),
    )
    return err(
      appError(
        'INTERNAL_SERVER_ERROR',
        'Não foi possível agendar a execução do agente agora',
      ),
    )
  }
}

/**
 * Enqueues a persona simulation (worker job `steel-agents/simulate`). Never
 * throws; on a Redis failure the caller marks the simulation FAILED.
 */
export async function enqueueSteelAgentSimulation(
  simulationId: string,
): Promise<Result<true>> {
  try {
    await getSteelAgentsQueue().add(SteelAgentsJob.Simulate, { simulationId })
    return ok(true)
  } catch (cause) {
    logger.error(
      'steel_agents.simulation_enqueue_failed',
      logFields(
        {
          component: 'SteelAgents',
          message: cause instanceof Error ? cause.message : String(cause),
        },
        { simulationId },
      ),
    )
    return err(
      appError(
        'INTERNAL_SERVER_ERROR',
        'Não foi possível agendar a simulação agora',
      ),
    )
  }
}
