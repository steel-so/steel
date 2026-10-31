'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  BookCrmMeetingDTO,
  CreateCrmMeetingPageDTO,
  UpdateCrmMeetingAvailabilityInput,
  UpdateCrmMeetingPageDTO,
} from '@/src/schemas/crm-meeting.schema'
import type {
  CrmMeetingAvailabilityDTO,
  CrmMeetingBookingDTO,
  CrmMeetingPageDTO,
  PublicMeetingBookingDTO,
} from '@/types/crm-meeting'
import type { CrmMemberDTO } from '@/types/crm-member'
import { apiFetch, apiFetchJson, apiSend } from './_fetch'

/** Booking pages, bookings and each seller's availability (crm-ops C5). */

const base = (ws: string) => `/api/workspaces/${encodeURIComponent(ws)}/crm`

export const crmMeetingKeys = {
  all: (ws: string) => ['crm-meetings', ws] as const,
  pages: (ws: string) => ['crm-meetings', ws, 'pages'] as const,
  bookings: (ws: string, scope: string) =>
    ['crm-meetings', ws, 'bookings', scope] as const,
  availability: (ws: string) => ['crm-meetings', ws, 'availability'] as const,
  members: (ws: string) => ['crm-meetings', ws, 'members'] as const,
}

export function useCrmMeetingPages(workspaceId: string) {
  return useQuery({
    queryKey: crmMeetingKeys.pages(workspaceId),
    queryFn: () =>
      apiFetch<CrmMeetingPageDTO[]>(
        `${base(workspaceId)}/meeting-pages`,
        undefined,
        'Erro ao buscar as páginas de agendamento',
      ),
    enabled: Boolean(workspaceId),
  })
}

export function useCrmMeetingHostOptions(workspaceId: string) {
  return useQuery({
    queryKey: crmMeetingKeys.members(workspaceId),
    queryFn: () =>
      apiFetch<CrmMemberDTO[]>(
        `${base(workspaceId)}/members`,
        undefined,
        'Erro ao buscar os vendedores',
      ),
    enabled: Boolean(workspaceId),
  })
}

export function useCrmMeetingBookings(
  workspaceId: string,
  scope: 'upcoming' | 'past',
) {
  return useQuery({
    queryKey: crmMeetingKeys.bookings(workspaceId, scope),
    queryFn: () =>
      apiFetch<CrmMeetingBookingDTO[]>(
        `${base(workspaceId)}/meeting-bookings?scope=${scope}`,
        undefined,
        'Erro ao buscar os agendamentos',
      ),
    enabled: Boolean(workspaceId),
    refetchInterval: 60_000,
  })
}

export function useCrmMeetingAvailability(workspaceId: string) {
  return useQuery({
    queryKey: crmMeetingKeys.availability(workspaceId),
    queryFn: () =>
      apiFetch<CrmMeetingAvailabilityDTO>(
        `${base(workspaceId)}/meeting-availability`,
        undefined,
        'Erro ao buscar a disponibilidade',
      ),
    enabled: Boolean(workspaceId),
  })
}

function useRefresh(workspaceId: string) {
  const queryClient = useQueryClient()
  return () =>
    queryClient.invalidateQueries({ queryKey: crmMeetingKeys.all(workspaceId) })
}

export function useCreateCrmMeetingPage(workspaceId: string) {
  const refresh = useRefresh(workspaceId)
  return useMutation({
    mutationFn: (input: CreateCrmMeetingPageDTO) =>
      apiFetchJson<CrmMeetingPageDTO>(
        `${base(workspaceId)}/meeting-pages`,
        'POST',
        input,
        'Erro ao criar a página de agendamento',
      ),
    onSuccess: refresh,
  })
}

export function useUpdateCrmMeetingPage(workspaceId: string) {
  const refresh = useRefresh(workspaceId)
  return useMutation({
    mutationFn: ({
      pageId,
      ...input
    }: UpdateCrmMeetingPageDTO & { pageId: string }) =>
      apiFetchJson<CrmMeetingPageDTO>(
        `${base(workspaceId)}/meeting-pages/${pageId}`,
        'PATCH',
        input,
        'Erro ao salvar a página de agendamento',
      ),
    onSuccess: refresh,
  })
}

export function useDeleteCrmMeetingPage(workspaceId: string) {
  const refresh = useRefresh(workspaceId)
  return useMutation({
    mutationFn: (pageId: string) =>
      apiSend(
        `${base(workspaceId)}/meeting-pages/${pageId}`,
        { method: 'DELETE' },
        'Erro ao remover a página de agendamento',
      ),
    onSuccess: refresh,
  })
}

export function useCancelCrmMeetingBooking(workspaceId: string) {
  const refresh = useRefresh(workspaceId)
  return useMutation({
    mutationFn: (bookingId: string) =>
      apiSend(
        `${base(workspaceId)}/meeting-bookings/${bookingId}`,
        { method: 'DELETE' },
        'Erro ao cancelar o agendamento',
      ),
    onSuccess: refresh,
  })
}

export function useSaveCrmMeetingAvailability(workspaceId: string) {
  const refresh = useRefresh(workspaceId)
  return useMutation({
    mutationFn: (input: UpdateCrmMeetingAvailabilityInput) =>
      apiFetchJson<CrmMeetingAvailabilityDTO>(
        `${base(workspaceId)}/meeting-availability`,
        'PUT',
        input,
        'Erro ao salvar a disponibilidade',
      ),
    onSuccess: refresh,
  })
}

// ─── Public side (no session; used by the booking widget) ───────────────────

export const publicMeetingApi = {
  bookingUrl: (slug: string) =>
    `/api/crm/meetings/${encodeURIComponent(slug)}/book`,
  slotsUrl: (slug: string, from: string, days: number) =>
    `/api/crm/meetings/${encodeURIComponent(slug)}/slots?from=${encodeURIComponent(from)}&days=${days}`,
}

export function bookPublicMeeting(slug: string, input: BookCrmMeetingDTO) {
  return apiFetchJson<PublicMeetingBookingDTO>(
    publicMeetingApi.bookingUrl(slug),
    'POST',
    input,
    'Não foi possível agendar',
  )
}
