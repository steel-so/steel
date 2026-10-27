import { WhatsappArchiveJob } from './jobs'
import { getWhatsappArchiveQueue } from './queues'

/** Queues the build of one WhatsApp archive package (job id = archive id). */
export async function enqueueWhatsappArchiveBuild(
  archiveId: string,
): Promise<void> {
  await getWhatsappArchiveQueue().add(
    WhatsappArchiveJob.Build,
    { archiveId },
    { jobId: `whatsapp-archive-${archiveId}` },
  )
}

/** Queues the off-site copy of a finished package. */
export async function enqueueWhatsappArchiveOffsiteCopy(
  archiveId: string,
): Promise<void> {
  await getWhatsappArchiveQueue().add(
    WhatsappArchiveJob.CopyToOffsite,
    { archiveId },
    { jobId: `whatsapp-archive-offsite-${archiveId}` },
  )
}
