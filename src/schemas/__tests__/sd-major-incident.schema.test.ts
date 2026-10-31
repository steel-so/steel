import { describe, expect, it } from 'vitest'
import {
  AddSdMajorIncidentUpdateSchema,
  DeclareSdMajorIncidentSchema,
  LinkSdMajorIncidentTicketsSchema,
  ListSdMajorIncidentsQuerySchema,
  ResolveSdMajorIncidentSchema,
  UpdateSdMajorIncidentSchema,
} from '../sd-major-incident.schema'

describe('sd-major-incident schemas', () => {
  it('declares with defaults and trims the title', () => {
    const parsed = DeclareSdMajorIncidentSchema.parse({
      ticketRef: ' INC-000123 ',
      title: '  Telefonia fora  ',
    })
    expect(parsed.ticketRef).toBe('INC-000123')
    expect(parsed.title).toBe('Telefonia fora')
    expect(parsed.impact).toBe('PARTIAL_OUTAGE')
    expect(parsed.publishInitial).toBe(true)
  })

  it('rejects a short title, too many specialists and an empty war room', () => {
    const base = { ticketRef: '1', title: 'ok título' }
    expect(
      DeclareSdMajorIncidentSchema.safeParse({ ...base, title: 'ab' }).success,
    ).toBe(false)
    expect(
      DeclareSdMajorIncidentSchema.safeParse({
        ...base,
        warRoom: { userIds: [] },
      }).success,
    ).toBe(false)
    expect(
      DeclareSdMajorIncidentSchema.safeParse({
        ...base,
        warRoom: { userIds: Array.from({ length: 11 }, (_, i) => `u${i}`) },
      }).success,
    ).toBe(false)
    expect(
      DeclareSdMajorIncidentSchema.safeParse({
        ...base,
        warRoom: { userIds: ['u1'] },
      }).success,
    ).toBe(true)
  })

  it('requires at least one field to update', () => {
    expect(UpdateSdMajorIncidentSchema.safeParse({}).success).toBe(false)
    expect(
      UpdateSdMajorIncidentSchema.safeParse({ commanderId: null }).success,
    ).toBe(true)
  })

  it('does not accept RESOLVED as a plain update status', () => {
    const base = { message: 'Causa identificada' }
    expect(
      AddSdMajorIncidentUpdateSchema.safeParse({ ...base, status: 'RESOLVED' })
        .success,
    ).toBe(false)
    const ok = AddSdMajorIncidentUpdateSchema.parse({
      ...base,
      status: 'IDENTIFIED',
    })
    expect(ok.publish).toBe(true)
  })

  it('resolves with a public message', () => {
    expect(
      ResolveSdMajorIncidentSchema.safeParse({ message: 'x' }).success,
    ).toBe(false)
    expect(
      ResolveSdMajorIncidentSchema.parse({ message: 'Tudo normal' }).publish,
    ).toBe(true)
  })

  it('takes the children to resolve together and caps the batch', () => {
    const base = { message: 'Tudo normal' }
    expect(
      ResolveSdMajorIncidentSchema.parse(base).childTicketIds,
    ).toBeUndefined()
    expect(
      ResolveSdMajorIncidentSchema.parse({ ...base, childTicketIds: ['t1'] })
        .childTicketIds,
    ).toEqual(['t1'])
    expect(
      ResolveSdMajorIncidentSchema.safeParse({
        ...base,
        childTicketIds: Array.from({ length: 201 }, (_, i) => `t${i}`),
      }).success,
    ).toBe(false)
  })

  it('bounds the ticket refs and the list query', () => {
    expect(
      LinkSdMajorIncidentTicketsSchema.safeParse({ ticketRefs: [] }).success,
    ).toBe(false)
    expect(
      LinkSdMajorIncidentTicketsSchema.safeParse({
        ticketRefs: Array.from({ length: 101 }, (_, i) => String(i)),
      }).success,
    ).toBe(false)
    expect(ListSdMajorIncidentsQuerySchema.parse({}).status).toBe('ACTIVE')
    expect(ListSdMajorIncidentsQuerySchema.parse({ limit: '5' }).limit).toBe(5)
  })
})
