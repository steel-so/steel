import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  TriggerWhatsAppArchiveDTO,
  UpdateWhatsAppArchiveSettingsDTO,
} from '@/src/schemas/whatsapp-archive.schema'
import type {
  WhatsAppArchiveDTO,
  WhatsAppArchiveOverviewDTO,
  WhatsAppArchiveSettingsDTO,
} from '@/types/whatsapp-archive'
import { apiFetch, apiFetchJson } from './_fetch'

/** WhatsApp archive for banks (ADR 0052): workspace view and admin panel. */

export const whatsappArchiveKey = (workspaceId: string) =>
  ['whatsapp-archive', workspaceId] as const

export const adminWhatsappArchiveKey = (workspaceId: string) =>
  ['admin', 'whatsapp-archive', workspaceId] as const

/** Poll while a package is queued or being built, so it shows up ready. */
export const WHATSAPP_ARCHIVE_POLL_MS = 5000

export function isWhatsAppArchiveInFlight(
  overview: WhatsAppArchiveOverviewDTO | undefined,
): boolean {
  return (
    overview?.archives.some(
      (archive) => archive.status === 'QUEUED' || archive.status === 'RUNNING',
    ) ?? false
  )
}

/** Comunicação › Configurações (OWNER/ADMIN). */
export function useWhatsAppArchives(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: whatsappArchiveKey(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppArchiveOverviewDTO>(
        `/api/workspaces/${workspaceId}/whatsapp/archives`,
        undefined,
        'Erro ao carregar o arquivamento de conversas',
      ),
    enabled: Boolean(workspaceId) && enabled,
    refetchInterval: (query) =>
      isWhatsAppArchiveInFlight(query.state.data)
        ? WHATSAPP_ARCHIVE_POLL_MS
        : false,
  })
}

export function useAdminWhatsAppArchive(workspaceId: string) {
  return useQuery({
    queryKey: adminWhatsappArchiveKey(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppArchiveOverviewDTO>(
        `/api/admin/workspaces/${workspaceId}/whatsapp-archive`,
        undefined,
        'Erro ao carregar o arquivamento de conversas',
      ),
    enabled: Boolean(workspaceId),
    refetchInterval: (query) =>
      isWhatsAppArchiveInFlight(query.state.data)
        ? WHATSAPP_ARCHIVE_POLL_MS
        : false,
  })
}

export function useUpdateAdminWhatsAppArchive(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateWhatsAppArchiveSettingsDTO) =>
      apiFetchJson<WhatsAppArchiveSettingsDTO>(
        `/api/admin/workspaces/${workspaceId}/whatsapp-archive`,
        'PATCH',
        input,
        'Não foi possível salvar o arquivamento',
      ),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: adminWhatsappArchiveKey(workspaceId) }),
  })
}

export function useTriggerAdminWhatsAppArchive(workspaceId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: TriggerWhatsAppArchiveDTO) =>
      apiFetchJson<WhatsAppArchiveDTO>(
        `/api/admin/workspaces/${workspaceId}/whatsapp-archive/generate`,
        'POST',
        input,
        'Não foi possível gerar o pacote',
      ),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: adminWhatsappArchiveKey(workspaceId) }),
  })
}
