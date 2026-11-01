import type { CrmForm, CrmFormSubmission } from '@prisma/client'
import type {
  CrmFormDTO,
  CrmFormFieldDefinition,
  CrmFormPhase,
  CrmFormPublicDTO,
  CrmFormSubmissionDTO,
} from '@/types/crm-form'

export function toCrmFormDTO(form: CrmForm): CrmFormDTO {
  return {
    id: form.id,
    name: form.name,
    description: form.description,
    status: form.status,
    publicToken: form.publicToken,
    action: form.action,
    fields: form.fields as unknown as CrmFormFieldDefinition[],
    phases: form.phases as unknown as CrmFormPhase[],
    successMessage: form.successMessage,
    redirectUrl: form.redirectUrl,
    submissionCount: form.submissionCount,
    newsletterId: form.newsletterId,
    workspaceId: form.workspaceId,
    createdById: form.createdById,
    updatedById: form.updatedById,
    position: form.position,
    publishedAt: form.publishedAt ? form.publishedAt.toISOString() : null,
    createdAt: form.createdAt.toISOString(),
    updatedAt: form.updatedAt.toISOString(),
  }
}

export function toCrmFormPublicDTO(
  form: CrmForm,
  newsletter?: { name: string; consentText: string } | null,
): CrmFormPublicDTO {
  return {
    id: form.id,
    name: form.name,
    description: form.description,
    fields: form.fields as unknown as CrmFormFieldDefinition[],
    phases: form.phases as unknown as CrmFormPhase[],
    successMessage: form.successMessage,
    redirectUrl: form.redirectUrl,
    ...(newsletter !== undefined && { newsletter }),
  }
}

export function toCrmFormSubmissionDTO(
  submission: CrmFormSubmission,
): CrmFormSubmissionDTO {
  return {
    id: submission.id,
    formId: submission.formId,
    values: submission.values as Record<string, string | boolean>,
    action: submission.action,
    createdPersonId: submission.createdPersonId,
    createdCompanyId: submission.createdCompanyId,
    createdLeadId: submission.createdLeadId,
    referrer: submission.referrer,
    createdAt: submission.createdAt.toISOString(),
  }
}
