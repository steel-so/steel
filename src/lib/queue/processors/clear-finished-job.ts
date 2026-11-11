export interface JobLookup {
  getJob(id: string): Promise<
    | {
        isCompleted(): Promise<boolean>
        isFailed(): Promise<boolean>
        remove(): Promise<void>
      }
    | undefined
  >
}

/**
 * BullMQ ignores `add` while a job with the same id is kept, and finished
 * jobs are kept for a day (completed) or a week (failed). A finished run
 * would then block the next one — e.g. a run that skipped every record
 * because the catalog could not convert yet. Drop it so the fixed id only
 * deduplicates jobs still waiting or running.
 */
export async function clearFinishedJob(
  queue: JobLookup,
  jobId: string,
): Promise<void> {
  const job = await queue.getJob(jobId)
  if (!job) return
  if ((await job.isCompleted()) || (await job.isFailed())) await job.remove()
}
