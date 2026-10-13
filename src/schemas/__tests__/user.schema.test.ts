import { describe, expect, it } from 'vitest'
import { UpdateUserSchema } from '@/src/schemas/user.schema'

describe('UpdateUserSchema', () => {
  it('should accept the PABX extension and device as digits', () => {
    const result = UpdateUserSchema.safeParse({
      pabxExtension: ' 200 ',
      pabxDeviceId: '123',
    })
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ pabxExtension: '200', pabxDeviceId: '123' })
  })

  it('should clear the PABX fields with an empty string', () => {
    const result = UpdateUserSchema.safeParse({
      pabxExtension: '',
      pabxDeviceId: null,
    })
    expect(result.data).toEqual({ pabxExtension: null, pabxDeviceId: null })
  })

  it('should reject a non-numeric PABX extension', () => {
    const result = UpdateUserSchema.safeParse({ pabxExtension: '20a' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toBe(
      'Ramal deve conter apenas números',
    )
  })

  it('should accept valid name and email', () => {
    const result = UpdateUserSchema.safeParse({
      name: 'John Doe',
      email: 'john@example.com',
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ name: 'John Doe', email: 'john@example.com' })
  })

  it('should accept name only', () => {
    const result = UpdateUserSchema.safeParse({ name: 'John Doe' })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ name: 'John Doe' })
  })

  it('should accept email only', () => {
    const result = UpdateUserSchema.safeParse({ email: 'john@example.com' })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ email: 'john@example.com' })
  })

  it('should accept empty object (all fields optional)', () => {
    const result = UpdateUserSchema.safeParse({})

    expect(result.success).toBe(true)
  })

  it('should reject name shorter than 2 characters', () => {
    const result = UpdateUserSchema.safeParse({ name: 'A' })

    expect(result.success).toBe(false)
  })

  it('should reject name longer than 100 characters', () => {
    const result = UpdateUserSchema.safeParse({ name: 'A'.repeat(101) })

    expect(result.success).toBe(false)
  })

  it('should reject invalid email format', () => {
    const result = UpdateUserSchema.safeParse({ email: 'not-an-email' })

    expect(result.success).toBe(false)
  })

  it('should accept name with exactly 2 characters', () => {
    const result = UpdateUserSchema.safeParse({ name: 'AB' })

    expect(result.success).toBe(true)
  })

  it('should accept name with exactly 100 characters', () => {
    const result = UpdateUserSchema.safeParse({ name: 'A'.repeat(100) })

    expect(result.success).toBe(true)
  })

  it('should accept a valid username', () => {
    const result = UpdateUserSchema.safeParse({ username: 'john.doe_01' })

    expect(result.success).toBe(true)
  })

  it('should reject a username shorter than 3 characters', () => {
    const result = UpdateUserSchema.safeParse({ username: 'ab' })

    expect(result.success).toBe(false)
  })

  it('should reject a username longer than 39 characters', () => {
    const result = UpdateUserSchema.safeParse({ username: 'a'.repeat(40) })

    expect(result.success).toBe(false)
  })

  it('should reject a username with uppercase or invalid characters', () => {
    expect(UpdateUserSchema.safeParse({ username: 'John' }).success).toBe(false)
    expect(UpdateUserSchema.safeParse({ username: 'jo hn' }).success).toBe(
      false,
    )
    expect(UpdateUserSchema.safeParse({ username: 'joão' }).success).toBe(false)
  })

  it('should accept a coverImage as a relative path', () => {
    const result = UpdateUserSchema.safeParse({ coverImage: '/covers/1.jpg' })

    expect(result.success).toBe(true)
  })

  it('should accept a coverImage as an absolute URL', () => {
    const result = UpdateUserSchema.safeParse({
      coverImage: 'https://cdn.example.com/c.jpg',
    })

    expect(result.success).toBe(true)
  })

  it('should reject a coverImage that is neither a path nor a URL', () => {
    const result = UpdateUserSchema.safeParse({ coverImage: 'not-a-url' })

    expect(result.success).toBe(false)
  })
})
