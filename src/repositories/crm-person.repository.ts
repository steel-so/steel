import type { CrmPerson, Prisma } from '@prisma/client'
import { notFound } from '@/src/errors'
import { prisma } from '@/src/lib/prisma'
import { err, ok, type Result } from '@/src/lib/result'
import { dbError } from './db-error'

export const CrmPersonRepository = {
  async listByWorkspace(
    workspaceId: string,
    filters?: { companyId?: string },
  ): Promise<Result<CrmPerson[]>> {
    try {
      const people = await prisma.crmPerson.findMany({
        where: {
          workspaceId,
          deletedAt: null,
          ...(filters?.companyId ? { companyId: filters.companyId } : {}),
        },
        orderBy: { position: 'asc' },
      })
      return ok(people)
    } catch (error) {
      return err(dbError('Failed to list CRM people', error))
    }
  },

  /** Natural-language search (C10): a prebuilt `where`/`orderBy`, capped. */
  async search(
    where: Prisma.CrmPersonWhereInput,
    orderBy: Prisma.CrmPersonOrderByWithRelationInput[],
    take: number,
  ): Promise<Result<CrmPerson[]>> {
    try {
      return ok(await prisma.crmPerson.findMany({ where, orderBy, take }))
    } catch (error) {
      return err(dbError('Failed to search CRM people', error))
    }
  },

  async findById(id: string, workspaceId: string): Promise<Result<CrmPerson>> {
    try {
      const person = await prisma.crmPerson.findFirst({
        where: { id, workspaceId, deletedAt: null },
      })

      if (!person) return err(notFound('CrmPerson'))

      return ok(person)
    } catch (error) {
      return err(dbError('Failed to find CRM person by id', error))
    }
  },

  /**
   * Pessoa mais antiga da workspace que compartilha ao menos um e-mail
   * (case-insensitive) ou telefone (só dígitos) com os informados. Usado na
   * conversão de lead para não duplicar contatos já cadastrados.
   * Espera `emails` em minúsculas e `phones` só com dígitos.
   */
  async findFirstByContacts(
    workspaceId: string,
    contacts: { emails: string[]; phones: string[] },
  ): Promise<Result<CrmPerson | null>> {
    if (contacts.emails.length === 0 && contacts.phones.length === 0) {
      return ok(null)
    }
    try {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM crm_people
        WHERE workspace_id = ${workspaceId}
          AND deleted_at IS NULL
          AND (
            EXISTS (
              SELECT 1 FROM unnest(emails) e
              WHERE lower(trim(e)) = ANY(${contacts.emails}::text[])
            )
            OR EXISTS (
              SELECT 1 FROM unnest(phones) p
              WHERE regexp_replace(p, '[^0-9]', '', 'g') = ANY(${contacts.phones}::text[])
            )
          )
        ORDER BY created_at ASC
        LIMIT 1
      `
      if (rows.length === 0) return ok(null)
      const person = await prisma.crmPerson.findUnique({
        where: { id: rows[0].id },
      })
      return ok(person)
    } catch (error) {
      return err(dbError('Failed to find CRM person by contacts', error))
    }
  },

  async create(data: {
    workspaceId: string
    createdById: string
    name: string
    emails?: string[]
    phones?: string[]
    city?: string
    jobTitle?: string
    linkedin?: string
    avatar?: string
    companyId?: string
  }): Promise<Result<CrmPerson>> {
    try {
      const position = await prisma.crmPerson.count({
        where: { workspaceId: data.workspaceId, deletedAt: null },
      })

      const person = await prisma.crmPerson.create({
        data: { ...data, position },
      })
      return ok(person)
    } catch (error) {
      return err(dbError('Failed to create CRM person', error))
    }
  },

  async update(
    id: string,
    data: {
      name?: string
      emails?: string[]
      phones?: string[]
      city?: string | null
      jobTitle?: string | null
      linkedin?: string | null
      avatar?: string | null
      companyId?: string | null
      updatedById?: string
    },
  ): Promise<Result<CrmPerson>> {
    try {
      const person = await prisma.crmPerson.update({ where: { id }, data })
      return ok(person)
    } catch (error) {
      return err(dbError('Failed to update CRM person', error))
    }
  },

  async softDelete(id: string): Promise<Result<void>> {
    try {
      await prisma.crmPerson.update({
        where: { id },
        data: { deletedAt: new Date() },
      })
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to delete CRM person', error))
    }
  },

  async reorder(
    workspaceId: string,
    orderedIds: string[],
  ): Promise<Result<void>> {
    try {
      await prisma.$transaction(
        orderedIds.map((id, position) =>
          prisma.crmPerson.update({
            where: { id, workspaceId },
            data: { position },
          }),
        ),
      )
      return ok(undefined)
    } catch (error) {
      return err(dbError('Failed to reorder CRM people', error))
    }
  },
}
