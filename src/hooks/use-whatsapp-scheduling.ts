import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateSchedAppointmentDTO,
  CreateSchedProfessionalDTO,
  CreateSchedServiceDTO,
  SchedAppointmentsQueryDTO,
  UpdateSchedAppointmentDTO,
  UpdateSchedProfessionalDTO,
  UpdateSchedServiceDTO,
  UpdateSchedulingSettingsDTO,
} from '@/src/schemas/whatsapp-scheduling.schema'
import type {
  WhatsAppSchedAppointmentDTO,
  WhatsAppSchedProfessionalDTO,
  WhatsAppSchedServiceDTO,
  WhatsAppSchedSlotDTO,
  WhatsAppSchedulingSettingsDTO,
} from '@/types/whatsapp-scheduling'
import { apiFetch, apiFetchJson } from './_fetch'

const base = (workspaceId: string) =>
  `/api/workspaces/${workspaceId}/whatsapp/scheduling`

const SETTINGS_KEY = (workspaceId: string) =>
  ['whatsapp-sched-settings', workspaceId] as const
const SERVICES_KEY = (workspaceId: string) =>
  ['whatsapp-sched-services', workspaceId] as const
const PROFESSIONALS_KEY = (workspaceId: string) =>
  ['whatsapp-sched-professionals', workspaceId] as const
const APPOINTMENTS_KEY = (workspaceId: string) =>
  ['whatsapp-sched-appointments', workspaceId] as const

export function useWhatsAppSchedulingSettings(workspaceId: string) {
  return useQuery({
    queryKey: SETTINGS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppSchedulingSettingsDTO>(
        `${base(workspaceId)}/settings`,
        undefined,
        'Erro ao buscar as configurações da agenda',
      ),
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}

export function useUpdateWhatsAppSchedulingSettings(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateSchedulingSettingsDTO) =>
      apiFetchJson<WhatsAppSchedulingSettingsDTO>(
        `${base(workspaceId)}/settings`,
        'PATCH',
        data,
        'Erro ao salvar as configurações da agenda',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(SETTINGS_KEY(workspaceId), data)
    },
  })
}

export function useWhatsAppSchedServices(workspaceId: string) {
  return useQuery({
    queryKey: SERVICES_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppSchedServiceDTO[]>(
        `${base(workspaceId)}/services`,
        undefined,
        'Erro ao buscar os serviços',
      ),
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}

export function useCreateSchedService(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateSchedServiceDTO) =>
      apiFetchJson<WhatsAppSchedServiceDTO>(
        `${base(workspaceId)}/services`,
        'POST',
        data,
        'Erro ao criar o serviço',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: SERVICES_KEY(workspaceId) }),
  })
}

export function useUpdateSchedService(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; data: UpdateSchedServiceDTO }) =>
      apiFetchJson<WhatsAppSchedServiceDTO>(
        `${base(workspaceId)}/services/${input.id}`,
        'PATCH',
        input.data,
        'Erro ao atualizar o serviço',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: SERVICES_KEY(workspaceId) }),
  })
}

export function useDeleteSchedService(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetchJson<null>(
        `${base(workspaceId)}/services/${id}`,
        'DELETE',
        undefined,
        'Erro ao excluir o serviço',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: SERVICES_KEY(workspaceId) }),
  })
}

export function useWhatsAppSchedProfessionals(workspaceId: string) {
  return useQuery({
    queryKey: PROFESSIONALS_KEY(workspaceId),
    queryFn: () =>
      apiFetch<WhatsAppSchedProfessionalDTO[]>(
        `${base(workspaceId)}/professionals`,
        undefined,
        'Erro ao buscar os profissionais',
      ),
    enabled: Boolean(workspaceId),
    staleTime: 60 * 1000,
  })
}

export function useCreateSchedProfessional(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateSchedProfessionalDTO) =>
      apiFetchJson<WhatsAppSchedProfessionalDTO>(
        `${base(workspaceId)}/professionals`,
        'POST',
        data,
        'Erro ao criar o profissional',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: PROFESSIONALS_KEY(workspaceId),
      }),
  })
}

export function useUpdateSchedProfessional(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; data: UpdateSchedProfessionalDTO }) =>
      apiFetchJson<WhatsAppSchedProfessionalDTO>(
        `${base(workspaceId)}/professionals/${input.id}`,
        'PATCH',
        input.data,
        'Erro ao atualizar o profissional',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: PROFESSIONALS_KEY(workspaceId),
      }),
  })
}

export function useDeleteSchedProfessional(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetchJson<null>(
        `${base(workspaceId)}/professionals/${id}`,
        'DELETE',
        undefined,
        'Erro ao excluir o profissional',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: PROFESSIONALS_KEY(workspaceId),
      }),
  })
}

export function useWhatsAppSchedSlots(
  workspaceId: string,
  query: { serviceId: string; date: string; professionalId?: string },
  enabled = true,
) {
  const params = new URLSearchParams({
    serviceId: query.serviceId,
    date: query.date,
  })
  if (query.professionalId) params.set('professionalId', query.professionalId)
  return useQuery({
    queryKey: ['whatsapp-sched-slots', workspaceId, query] as const,
    queryFn: () =>
      apiFetch<WhatsAppSchedSlotDTO[]>(
        `${base(workspaceId)}/slots?${params.toString()}`,
        undefined,
        'Erro ao buscar os horários livres',
      ),
    enabled: enabled && Boolean(workspaceId && query.serviceId && query.date),
    staleTime: 15 * 1000,
  })
}

export function useWhatsAppSchedAppointments(
  workspaceId: string,
  query: SchedAppointmentsQueryDTO,
) {
  const params = new URLSearchParams({ from: query.from, to: query.to })
  if (query.professionalId) params.set('professionalId', query.professionalId)
  if (query.status) params.set('status', query.status)
  return useQuery({
    queryKey: [...APPOINTMENTS_KEY(workspaceId), query] as const,
    queryFn: () =>
      apiFetch<WhatsAppSchedAppointmentDTO[]>(
        `${base(workspaceId)}/appointments?${params.toString()}`,
        undefined,
        'Erro ao buscar os agendamentos',
      ),
    enabled: Boolean(workspaceId),
    staleTime: 15 * 1000,
  })
}

export function useCreateSchedAppointment(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateSchedAppointmentDTO) =>
      apiFetchJson<WhatsAppSchedAppointmentDTO>(
        `${base(workspaceId)}/appointments`,
        'POST',
        data,
        'Erro ao criar o agendamento',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: APPOINTMENTS_KEY(workspaceId) })
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-sched-slots', workspaceId],
      })
    },
  })
}

export function useUpdateSchedAppointment(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; data: UpdateSchedAppointmentDTO }) =>
      apiFetchJson<WhatsAppSchedAppointmentDTO>(
        `${base(workspaceId)}/appointments/${input.id}`,
        'PATCH',
        input.data,
        'Erro ao atualizar o agendamento',
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: APPOINTMENTS_KEY(workspaceId) })
      queryClient.invalidateQueries({
        queryKey: ['whatsapp-sched-slots', workspaceId],
      })
    },
  })
}
