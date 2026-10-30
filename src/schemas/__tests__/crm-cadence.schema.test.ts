import { describe, expect, it } from 'vitest'
import {
  CRM_CADENCE_MAX_STEPS,
  CreateCrmCadenceSchema,
  CrmCadenceEnrollmentActionSchema,
  CrmCadenceStepSchema,
  EnrollCrmCadenceSchema,
  ListCrmCadenceEnrollmentsSchema,
  UpdateCrmCadenceSchema,
} from '../crm-cadence.schema'

const email = { type: 'EMAIL', subject: 'Oi', body: 'Texto' } as const

describe('CrmCadenceStepSchema', () => {
  it('should default the delay and keep a valid e-mail step', () => {
    const step = CrmCadenceStepSchema.parse(email)
    expect(step).toMatchObject({ delayValue: 0, delayUnit: 'DAYS' })
  })

  it.each([
    [{ type: 'EMAIL', body: 'x' }, 'subject'],
    [{ type: 'EMAIL', subject: 'x', body: '  ' }, 'body'],
    [{ type: 'WHATSAPP', body: '' }, 'body'],
    [{ type: 'TASK', subject: '' }, 'subject'],
  ])('should reject %j', (input, path) => {
    const parsed = CrmCadenceStepSchema.safeParse(input)
    expect(parsed.success).toBe(false)
    if (!parsed.success) expect(parsed.error.issues[0].path).toEqual([path])
  })

  it('should accept a WhatsApp step with only a template', () => {
    expect(
      CrmCadenceStepSchema.safeParse({
        type: 'WHATSAPP',
        whatsappTemplateId: 'tpl1',
      }).success,
    ).toBe(true)
  })

  it('should accept a task with only a title', () => {
    expect(
      CrmCadenceStepSchema.safeParse({ type: 'TASK', subject: 'Ligar' })
        .success,
    ).toBe(true)
  })
})

describe('CreateCrmCadenceSchema', () => {
  it('should apply defaults', () => {
    const parsed = CreateCrmCadenceSchema.parse({
      name: ' Outbound ',
      steps: [email],
    })
    expect(parsed).toMatchObject({
      name: 'Outbound',
      stopOnReply: true,
      stopOnClick: false,
      weekdaysOnly: true,
    })
  })

  it('should require at least one step and cap the list', () => {
    expect(
      CreateCrmCadenceSchema.safeParse({ name: 'x', steps: [] }).success,
    ).toBe(false)
    expect(
      CreateCrmCadenceSchema.safeParse({
        name: 'x',
        steps: Array.from({ length: CRM_CADENCE_MAX_STEPS + 1 }, () => email),
      }).success,
    ).toBe(false)
  })

  it('should require a name', () => {
    expect(
      CreateCrmCadenceSchema.safeParse({ name: ' ', steps: [email] }).success,
    ).toBe(false)
  })

  it('should require both window hours or none', () => {
    const base = { name: 'x', steps: [email] }
    expect(
      CreateCrmCadenceSchema.safeParse({ ...base, windowStartHour: 9 }).success,
    ).toBe(false)
    expect(
      CreateCrmCadenceSchema.safeParse({
        ...base,
        windowStartHour: 9,
        windowEndHour: 18,
      }).success,
    ).toBe(true)
    expect(
      CreateCrmCadenceSchema.safeParse({ ...base, windowStartHour: 25 })
        .success,
    ).toBe(false)
  })

  it('should reject an invalid sender address', () => {
    expect(
      CreateCrmCadenceSchema.safeParse({
        name: 'x',
        steps: [email],
        emailFrom: 'nao-e-email',
      }).success,
    ).toBe(false)
  })
})

describe('UpdateCrmCadenceSchema', () => {
  it('should accept a status change alone', () => {
    expect(UpdateCrmCadenceSchema.parse({ status: 'PAUSED' })).toEqual({
      status: 'PAUSED',
    })
  })

  it('should not allow archiving through the status', () => {
    expect(
      UpdateCrmCadenceSchema.safeParse({ status: 'ARCHIVED' }).success,
    ).toBe(false)
  })

  it('should clear the description with an empty string', () => {
    expect(
      UpdateCrmCadenceSchema.parse({ description: '  ' }).description,
    ).toBeNull()
  })

  it('should reject half a window', () => {
    expect(
      UpdateCrmCadenceSchema.safeParse({ windowEndHour: 18 }).success,
    ).toBe(false)
  })
})

describe('enrollment schemas', () => {
  it('should limit the batch of leads', () => {
    expect(
      EnrollCrmCadenceSchema.safeParse({ cadenceId: 'c', leadIds: [] }).success,
    ).toBe(false)
    expect(
      EnrollCrmCadenceSchema.safeParse({
        cadenceId: 'c',
        leadIds: Array.from({ length: 201 }, (_, i) => `l${i}`),
      }).success,
    ).toBe(false)
    expect(
      EnrollCrmCadenceSchema.safeParse({ cadenceId: 'c', leadIds: ['l1'] })
        .success,
    ).toBe(true)
  })

  it('should validate the enrollment action and the list filter', () => {
    expect(
      CrmCadenceEnrollmentActionSchema.safeParse({ action: 'replied' }).success,
    ).toBe(true)
    expect(
      CrmCadenceEnrollmentActionSchema.safeParse({ action: 'delete' }).success,
    ).toBe(false)
    expect(
      ListCrmCadenceEnrollmentsSchema.safeParse({ status: 'REPLIED' }).success,
    ).toBe(true)
    expect(
      ListCrmCadenceEnrollmentsSchema.safeParse({ status: 'nope' }).success,
    ).toBe(false)
  })
})
