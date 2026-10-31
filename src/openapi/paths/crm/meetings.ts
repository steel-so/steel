import { z } from 'zod'
import {
  BookCrmMeetingSchema,
  CreateCrmMeetingPageSchema,
  ListCrmMeetingBookingsSchema,
  PublicSlotsQuerySchema,
  UpdateCrmMeetingAvailabilitySchema,
  UpdateCrmMeetingPageSchema,
} from '@/src/schemas/crm-meeting.schema'
import type { ErrorEntry, RouteConfig } from '../../registry'
import {
  CrmMeetingAvailabilityDTO,
  CrmMeetingBookingDTO,
  CrmMeetingPageDTO,
  PublicMeetingBookingDTO,
  PublicMeetingPageDTO,
  PublicMeetingSlotsDTO,
} from '../../schemas/crm/meetings'
import { CRM_ERRORS, crmAccess, describe } from './shared'

/**
 * CRM · Agendamento de reuniões (crm-ops C5): páginas públicas com os
 * horários livres dos vendedores (jornada semanal + agenda iCal + reuniões já
 * marcadas), rodízio entre vendedores, lead e reunião criados sozinhos.
 */

const TAGS: RouteConfig['tags'] = ['CRM · Leads']
const PUBLIC_TAGS: RouteConfig['tags'] = ['CRM público · Agendamento']
const BASE = '/workspaces/{id}/crm'
const PAGE_ID = 'ID da página de agendamento.'

const PAGE_NOT_FOUND: ErrorEntry = {
  code: 'CRM_MEETING_PAGE_NOT_FOUND',
  when: 'Página inexistente, removida, pausada ou com o CRM desabilitado',
}
const BOOKING_NOT_FOUND: ErrorEntry = {
  code: 'CRM_MEETING_BOOKING_NOT_FOUND',
  when: 'Agendamento inexistente',
}
const INVALID: ErrorEntry = {
  code: 'CRM_MEETING_INVALID',
  when: 'Vendedor que não é membro, endereço em uso, agenda iCal inacessível ou reunião que já começou',
}

export const crmMeetingRoutes: RouteConfig[] = [
  {
    method: 'get',
    path: `${BASE}/meeting-pages`,
    tags: TAGS,
    summary: 'Listar páginas de agendamento',
    description: describe(
      'Páginas do workspace com os vendedores e quantas reuniões futuras cada uma tem.',
      crmAccess('leads', 'VIEW'),
    ),
    responses: {
      200: { description: 'Páginas.', schema: z.array(CrmMeetingPageDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'post',
    path: `${BASE}/meeting-pages`,
    tags: TAGS,
    summary: 'Criar página de agendamento',
    description: describe(
      'Cria a página pública `/m/<slug>`. Com mais de um vendedor, a reserva vai em rodízio para quem atendeu há mais tempo entre os livres naquele horário. Sem `slug`, ele sai do título.',
      crmAccess('leads', 'CREATE'),
    ),
    consent: true,
    body: {
      schema: CreateCrmMeetingPageSchema,
      example: {
        title: 'Conversa com vendas',
        durationMinutes: 30,
        hostUserIds: ['clx1abc'],
        location: 'https://meet.google.com/abc-defg-hij',
      },
    },
    responses: {
      201: { description: 'Página criada.', schema: CrmMeetingPageDTO },
    },
    errors: [
      ...CRM_ERRORS,
      INVALID,
      { code: 'CRM_MEETING_SLUG_TAKEN', when: 'O endereço já existe' },
    ],
  },
  {
    method: 'patch',
    path: `${BASE}/meeting-pages/{pageId}`,
    tags: TAGS,
    summary: 'Editar página de agendamento',
    description: describe(
      'Só muda o que for enviado. `hostUserIds` substitui a lista de vendedores.',
      crmAccess('leads', 'EDIT'),
    ),
    consent: true,
    params: { pageId: PAGE_ID },
    body: { schema: UpdateCrmMeetingPageSchema, example: { active: false } },
    responses: {
      200: { description: 'Página atualizada.', schema: CrmMeetingPageDTO },
    },
    errors: [...CRM_ERRORS, PAGE_NOT_FOUND, INVALID],
  },
  {
    method: 'delete',
    path: `${BASE}/meeting-pages/{pageId}`,
    tags: TAGS,
    summary: 'Remover página de agendamento',
    description: describe(
      'O link deixa de funcionar; os agendamentos já feitos continuam.',
      crmAccess('leads', 'DELETE'),
    ),
    consent: true,
    params: { pageId: PAGE_ID },
    responses: { 200: { description: 'Página removida.' } },
    errors: [...CRM_ERRORS, PAGE_NOT_FOUND],
  },
  {
    method: 'get',
    path: `${BASE}/meeting-bookings`,
    tags: TAGS,
    summary: 'Listar reuniões agendadas',
    description: describe(
      'Reservas feitas nas páginas (até 200). `mine=true` mostra só as do usuário.',
      crmAccess('leads', 'VIEW'),
    ),
    query: ListCrmMeetingBookingsSchema,
    responses: {
      200: { description: 'Reservas.', schema: z.array(CrmMeetingBookingDTO) },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'delete',
    path: `${BASE}/meeting-bookings/{bookingId}`,
    tags: TAGS,
    summary: 'Cancelar uma reunião agendada',
    description: describe(
      'Cancela a reserva, libera o horário, tira o evento da agenda e avisa o convidado por e-mail.',
      crmAccess('leads', 'EDIT'),
    ),
    consent: true,
    params: { bookingId: 'ID da reserva.' },
    responses: { 200: { description: 'Reserva cancelada.' } },
    errors: [...CRM_ERRORS, BOOKING_NOT_FOUND],
  },
  {
    method: 'get',
    path: `${BASE}/meeting-availability`,
    tags: TAGS,
    summary: 'Minha disponibilidade',
    description: describe(
      'Jornada semanal, fuso e se há uma agenda iCal conectada do usuário. Sem configuração, vale segunda a sexta, das 9h às 18h.',
      crmAccess('leads', 'VIEW'),
    ),
    responses: {
      200: {
        description: 'Disponibilidade.',
        schema: CrmMeetingAvailabilityDTO,
      },
    },
    errors: CRM_ERRORS,
  },
  {
    method: 'put',
    path: `${BASE}/meeting-availability`,
    tags: TAGS,
    summary: 'Salvar minha disponibilidade',
    description: describe(
      'Substitui a jornada e o fuso. `icsUrl` conecta (ou, com `null`, desconecta) o endereço secreto iCal do Google ou do Outlook: ele é testado na hora (HTTPS, host público), guardado cifrado e só os horários ocupados são lidos. Omitido, o endereço atual fica.',
      crmAccess('leads', 'VIEW'),
    ),
    consent: true,
    body: {
      schema: UpdateCrmMeetingAvailabilitySchema,
      example: {
        timezone: 'America/Sao_Paulo',
        weeklyHours: {
          '1': [
            { start: '09:00', end: '12:00' },
            { start: '14:00', end: '18:00' },
          ],
        },
      },
    },
    responses: {
      200: {
        description: 'Disponibilidade salva.',
        schema: CrmMeetingAvailabilityDTO,
      },
    },
    errors: [...CRM_ERRORS, INVALID],
  },
  // ─── Public ────────────────────────────────────────────────────────────────
  {
    method: 'get',
    path: '/crm/meetings/{slug}',
    tags: PUBLIC_TAGS,
    summary: 'Dados públicos da página de agendamento',
    description:
      'Sem sessão. Título, duração, formato e fuso da página `/m/<slug>`.',
    auth: 'public',
    rateLimit: 'ip',
    params: { slug: 'Endereço da página.' },
    responses: {
      200: { description: 'Página.', schema: PublicMeetingPageDTO },
    },
    errors: [PAGE_NOT_FOUND],
  },
  {
    method: 'get',
    path: '/crm/meetings/{slug}/slots',
    tags: PUBLIC_TAGS,
    summary: 'Horários livres',
    description:
      'Sem sessão. Horários livres a partir de `from` (padrão: agora) pelos próximos `days` (1 a 31, padrão 14): une a jornada, a agenda iCal e as reuniões já marcadas de cada vendedor, respeitando duração, folga, antecedência mínima e o horizonte da página.',
    auth: 'public',
    rateLimit: 'ip',
    params: { slug: 'Endereço da página.' },
    query: PublicSlotsQuerySchema,
    responses: {
      200: { description: 'Horários.', schema: PublicMeetingSlotsDTO },
    },
    errors: [PAGE_NOT_FOUND],
  },
  {
    method: 'post',
    path: '/crm/meetings/{slug}/book',
    tags: PUBLIC_TAGS,
    summary: 'Reservar um horário',
    description:
      'Sem sessão; limite por IP. O convidado precisa concordar (`consent: true`, LGPD). Escolhe o vendedor livre mais ocioso, trava o horário, cria (ou reaproveita) o lead com o vendedor como responsável, registra a reunião na ficha do lead e na agenda e manda e-mail de confirmação com convite .ics. O lembrete sai antes da reunião.',
    auth: 'public',
    rateLimit: 'ip',
    params: { slug: 'Endereço da página.' },
    body: {
      schema: BookCrmMeetingSchema,
      example: {
        startsAt: '2026-11-03T13:00:00.000Z',
        name: 'Ana Souza',
        email: 'ana@empresa.com.br',
        timezone: 'America/Sao_Paulo',
        consent: true,
      },
    },
    responses: {
      201: {
        description: 'Reserva confirmada.',
        schema: PublicMeetingBookingDTO,
      },
    },
    errors: [
      PAGE_NOT_FOUND,
      {
        code: 'CRM_MEETING_SLOT_TAKEN',
        when: 'O horário acabou de ser ocupado ou não está livre',
      },
    ],
  },
  {
    method: 'get',
    path: '/crm/meeting-bookings/{token}',
    tags: PUBLIC_TAGS,
    summary: 'Ver uma reserva pelo link do e-mail',
    description: 'Sem sessão: o token do e-mail é o acesso.',
    auth: 'public',
    rateLimit: 'ip',
    params: { token: 'Token do agendamento.' },
    responses: {
      200: { description: 'Reserva.', schema: PublicMeetingBookingDTO },
    },
    errors: [BOOKING_NOT_FOUND],
  },
  {
    method: 'delete',
    path: '/crm/meeting-bookings/{token}',
    tags: PUBLIC_TAGS,
    summary: 'Cancelar uma reserva pelo link do e-mail',
    description:
      'Sem sessão. Libera o horário e avisa o vendedor. Reuniões que já começaram não podem ser canceladas.',
    auth: 'public',
    rateLimit: 'ip',
    params: { token: 'Token do agendamento.' },
    responses: {
      200: {
        description: 'Reserva cancelada.',
        schema: PublicMeetingBookingDTO,
      },
    },
    errors: [BOOKING_NOT_FOUND, INVALID],
  },
]
