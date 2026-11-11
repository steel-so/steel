import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { NO_INDEX } from '@/src/lib/seo/metadata'
import { DocumentLegacyImportService } from '@/src/services/document-legacy-import.service'

export const metadata: Metadata = { title: 'Proposta', robots: NO_INDEX }

/**
 * Old public proposal link → the document link with the same token
 * (ADR 0063). A proposal the migration hasn't reached yet is converted
 * now; `/d/<token>` answers for unknown or unsent links.
 */
export default async function PublicProposalRedirect({
  params,
}: {
  params: Promise<{ shareToken: string }>
}) {
  await connection()
  const { shareToken } = await params
  await DocumentLegacyImportService.ensurePublicToken(shareToken)
  redirect(`/d/${encodeURIComponent(shareToken)}`)
}
