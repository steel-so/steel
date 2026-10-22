import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { mockFetch, renderWithQuery } from '@/src/__tests__/component-utils'
import type { CrmActivityDTO } from '@/types/crm-activity'
import { CrmRecordTimeline } from '../crm-record-timeline'

function activity(overrides: Partial<CrmActivityDTO>): CrmActivityDTO {
  return {
    id: 'a1',
    workspaceId: 'ws1',
    actorUserId: 'u1',
    action: 'CREATED',
    entity: 'person',
    entityId: 'p1',
    companyId: null,
    personId: 'p1',
    opportunityId: null,
    summary: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

const minutesAgo = (m: number) =>
  new Date(Date.now() - m * 60_000).toISOString()

describe('<CrmRecordTimeline />', () => {
  it('shows a loading state and then the empty state', async () => {
    mockFetch([
      { match: '/calls', data: [] },
      { match: '/crm/activities', data: [] },
    ])
    renderWithQuery(<CrmRecordTimeline workspaceId='ws1' personId='p1' />)

    expect(screen.getByText('Carregando…')).toBeTruthy()
    expect(await screen.findByText('Sem atividade ainda.')).toBeTruthy()
  })

  it('filters the feed by the record it belongs to', async () => {
    const fetchSpy = mockFetch([
      { match: '/calls', data: [] },
      { match: '/crm/activities', data: [] },
    ])
    renderWithQuery(<CrmRecordTimeline workspaceId='ws1' opportunityId='o9' />)

    await screen.findByText('Sem atividade ainda.')
    const urls = fetchSpy.mock.calls.map((call) => String(call[0]))
    expect(urls).toContain(
      '/api/workspaces/ws1/crm/activities?opportunityId=o9',
    )
    expect(urls).toContain('/api/workspaces/ws1/crm/opportunities/o9/calls')
  })

  it('resolves actors, falls back to summaries/verbs and relative times', async () => {
    mockFetch([
      { match: '/calls', data: [] },
      {
        match: '/crm/activities',
        data: [
          activity({
            id: 'a1',
            actorUserId: 'u1',
            summary: 'criou a pessoa Ada',
            createdAt: minutesAgo(0),
          }),
          activity({
            id: 'a2',
            actorUserId: 'ghost',
            action: 'UPDATED',
            createdAt: minutesAgo(5),
          }),
          activity({
            id: 'a3',
            actorUserId: null,
            action: 'DELETED',
            createdAt: minutesAgo(60 * 3),
          }),
          activity({
            id: 'a4',
            action: 'UPDATED',
            summary: 'moveu de etapa',
            createdAt: minutesAgo(60 * 24 * 2),
          }),
        ],
      },
    ])
    renderWithQuery(
      <CrmRecordTimeline
        workspaceId='ws1'
        personId='p1'
        userMap={{ u1: 'Ana Souza' }}
      />,
    )

    expect(await screen.findByText('criou a pessoa Ada')).toBeTruthy()
    expect(screen.getAllByText('Ana Souza')).toHaveLength(2)
    expect(screen.getByText('Alguém')).toBeTruthy()
    expect(screen.getByText('Sistema')).toBeTruthy()
    expect(screen.getByText(/atualizou/)).toBeTruthy()
    expect(screen.getByText(/removeu/)).toBeTruthy()
    expect(screen.getByText('agora')).toBeTruthy()
    expect(screen.getByText('há 5min')).toBeTruthy()
    expect(screen.getByText('há 3h')).toBeTruthy()
    expect(screen.getByText('há 2d')).toBeTruthy()
  })

  it('degrades to the empty state when the request fails', async () => {
    mockFetch([{ match: '/crm/activities', status: 500, error: 'boom' }])
    renderWithQuery(<CrmRecordTimeline workspaceId='ws1' companyId='c1' />)
    expect(await screen.findByText('Sem atividade ainda.')).toBeTruthy()
  })

  it('shows the calls of the person above the activity', async () => {
    mockFetch([
      {
        match: '/crm/people/p1/calls',
        data: [
          {
            id: 'call1',
            conversationId: 'conv1',
            userId: 'u1',
            extension: '200',
            destination: '11999998888',
            status: 'COMPLETED',
            answeredAt: null,
            endedAt: null,
            durationSeconds: 75,
            createdAt: '2026-10-18T15:00:00.000Z',
            recordingNotice: null,
            hasRecording: false,
            aiStatus: 'DONE',
            userName: 'Ana',
            contactName: 'Maria',
            recording: null,
            transcript: 'Olá',
            summary: 'Cliente pediu o boleto.',
            sentiment: 'NEUTRAL',
            sentimentScore: 0,
            nextSteps: ['Enviar o boleto'],
            aiModel: 'openai:gpt-4o-mini',
            aiSkipReason: null,
            aiProcessedAt: null,
            sdTicketId: null,
            crmPersonId: 'p1',
            crmOpportunityId: null,
            voiceAgent: false,
            voiceEndReason: null,
            voiceTransferTarget: null,
            voiceHandoff: null,
          },
        ],
      },
      { match: '/crm/activities', data: [] },
    ])
    renderWithQuery(<CrmRecordTimeline workspaceId='ws1' personId='p1' />)

    expect(await screen.findByText('Cliente pediu o boleto.')).toBeTruthy()
    expect(screen.getByText('Ligações')).toBeTruthy()
    expect(screen.getByText('Enviar o boleto')).toBeTruthy()
  })

  it('does not ask for calls on a company', async () => {
    const fetchSpy = mockFetch([{ match: '/crm/activities', data: [] }])
    renderWithQuery(<CrmRecordTimeline workspaceId='ws1' companyId='c1' />)
    await screen.findByText('Sem atividade ainda.')
    expect(
      fetchSpy.mock.calls.some((call) => String(call[0]).includes('/calls')),
    ).toBe(false)
  })
})
