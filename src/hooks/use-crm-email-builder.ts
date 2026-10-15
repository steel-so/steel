import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CrmEmailBrandInput,
  EmailBuilderContact,
  EmailBuilderDocument,
  EmailBuilderLayoutId,
  EmailCanvasDocument,
} from '@/src/schemas/crm-email-builder.schema'
import type {
  CrmEmailBrandDTO,
  CrmEmailLinkTargetsDTO,
  CrmEmailRenderDTO,
  CrmEmailTemplateDTO,
  CrmEmailTestSendDTO,
} from '@/types/crm-email-marketing'
import { apiFetch } from './_fetch'

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const emailTemplateKey = (workspaceId: string, templateId: string) =>
  ['crm-email-template', workspaceId, templateId] as const
const brandKey = (workspaceId: string) =>
  ['crm-email-brand', workspaceId] as const
const linksKey = (workspaceId: string) =>
  ['crm-email-builder-links', workspaceId] as const

export function useCrmEmailTemplate(workspaceId: string, templateId: string) {
  return useQuery({
    queryKey: emailTemplateKey(workspaceId, templateId),
    queryFn: () =>
      apiFetch<CrmEmailTemplateDTO>(
        `/api/workspaces/${workspaceId}/crm/email-templates/${templateId}`,
        undefined,
        'Erro ao carregar o template',
      ),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** Starts a BUILDER template from a gallery layout or a v2 document. */
export function useCreateCrmEmailBuilderTemplate(workspaceId: string) {
  return useMutation({
    mutationFn: (data: {
      name: string
      subject: string
      /** A gallery layout (v1, or v2 with `builderVersion: 2`)… */
      builderLayout?: EmailBuilderLayoutId
      builderVersion?: 1 | 2
      /** …or a ready Steel Canvas document (blank starter). */
      builderDocument?: EmailCanvasDocument
    }) =>
      apiFetch<CrmEmailTemplateDTO>(
        `/api/workspaces/${workspaceId}/crm/email-templates`,
        json('POST', data),
        'Erro ao criar o template',
      ),
  })
}

export type SaveCrmEmailTemplateInput = {
  name?: string
  subject?: string
  builderDocument?: EmailBuilderDocument | EmailCanvasDocument
}

/** PATCH of a builder template (document, subject, name). A plain call for
 * editors that must not re-render on mutation state (the canvas editor). */
export function saveCrmEmailTemplate(
  workspaceId: string,
  templateId: string,
  data: SaveCrmEmailTemplateInput,
) {
  return apiFetch<CrmEmailTemplateDTO>(
    `/api/workspaces/${workspaceId}/crm/email-templates/${templateId}`,
    json('PATCH', data),
    'Erro ao salvar o template',
  )
}

/** Autosave of the editor (document, subject, name). */
export function useSaveCrmEmailBuilderTemplate(
  workspaceId: string,
  templateId: string,
) {
  return useMutation({
    mutationFn: (data: SaveCrmEmailTemplateInput) =>
      saveCrmEmailTemplate(workspaceId, templateId, data),
  })
}

export function useCrmEmailBrand(workspaceId: string) {
  return useQuery({
    queryKey: brandKey(workspaceId),
    queryFn: () =>
      apiFetch<CrmEmailBrandDTO>(
        `/api/workspaces/${workspaceId}/crm/email-brand`,
        undefined,
        'Erro ao carregar a marca',
      ),
    staleTime: 60 * 1000,
  })
}

export function useSaveCrmEmailBrand(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CrmEmailBrandInput) =>
      apiFetch<CrmEmailBrandDTO>(
        `/api/workspaces/${workspaceId}/crm/email-brand`,
        json('PUT', data),
        'Erro ao salvar a marca',
      ),
    onSuccess: (brand) => {
      queryClient.setQueryData(brandKey(workspaceId), brand)
    },
  })
}

export function useCrmEmailLinkTargets(workspaceId: string) {
  return useQuery({
    queryKey: linksKey(workspaceId),
    queryFn: () =>
      apiFetch<CrmEmailLinkTargetsDTO>(
        `/api/workspaces/${workspaceId}/crm/email-builder/links`,
        undefined,
        'Erro ao carregar landing pages e formulários',
      ),
    staleTime: 60 * 1000,
  })
}

export function useSendCrmEmailTest(workspaceId: string, templateId: string) {
  return useMutation({
    mutationFn: (data: { personId?: string; sample?: EmailBuilderContact }) =>
      apiFetch<CrmEmailTestSendDTO>(
        `/api/workspaces/${workspaceId}/crm/email-templates/${templateId}/test-send`,
        json('POST', data),
        'Erro ao enviar o teste',
      ),
  })
}

export function renderCrmEmailTemplate(
  workspaceId: string,
  templateId: string,
  data: { personId?: string; campaignLink?: string },
) {
  return apiFetch<CrmEmailRenderDTO>(
    `/api/workspaces/${workspaceId}/crm/email-templates/${templateId}/render`,
    json('POST', data),
    'Erro ao gerar a pré-visualização',
  )
}

/** Uploads an image (raw body) and returns its public URL. */
export function uploadCrmEmailImage(workspaceId: string, file: File) {
  return apiFetch<{ url: string }>(
    `/api/workspaces/${workspaceId}/crm/email-builder/images`,
    {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    },
    'Erro ao enviar a imagem',
  )
}
