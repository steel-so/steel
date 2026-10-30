import type { CrmCompany, CrmLead, CrmPerson } from '@prisma/client'
import { prisma } from '@/src/lib/prisma'

type Dated = { updatedAt?: Date; createdAt?: Date }

/** `@updatedAt` ignores explicit values through Prisma: force it with SQL. */
async function forceUpdatedAt(table: string, id: string, updatedAt?: Date) {
  if (!updatedAt) return
  await prisma.$executeRawUnsafe(
    `UPDATE ${table} SET updated_at = $1 WHERE id = $2`,
    updatedAt,
    id,
  )
}

/** Lead with the extra columns the NL search filters on (channel, city...). */
export async function seedSearchableLead(
  workspaceId: string,
  createdById: string,
  overrides: Partial<
    Pick<
      CrmLead,
      | 'name'
      | 'emails'
      | 'phones'
      | 'company'
      | 'jobTitle'
      | 'city'
      | 'source'
      | 'channel'
      | 'stage'
      | 'score'
      | 'ownerId'
      | 'position'
      | 'deletedAt'
      | 'closeResult'
    >
  > &
    Dated = {},
) {
  const { updatedAt, ...rest } = overrides
  const lead = await prisma.crmLead.create({
    data: { name: 'Seed Lead', workspaceId, createdById, ...rest },
  })
  await forceUpdatedAt('crm_leads', lead.id, updatedAt)
  return lead
}

export async function seedSearchablePerson(
  workspaceId: string,
  createdById: string,
  overrides: Partial<
    Pick<
      CrmPerson,
      | 'name'
      | 'emails'
      | 'phones'
      | 'city'
      | 'jobTitle'
      | 'companyId'
      | 'position'
      | 'deletedAt'
    >
  > &
    Dated = {},
) {
  const { updatedAt, ...rest } = overrides
  const person = await prisma.crmPerson.create({
    data: { name: 'Seed Person', workspaceId, createdById, ...rest },
  })
  await forceUpdatedAt('crm_people', person.id, updatedAt)
  return person
}

export async function seedSearchableCompany(
  workspaceId: string,
  createdById: string,
  overrides: Partial<
    Pick<
      CrmCompany,
      | 'name'
      | 'cnpj'
      | 'domain'
      | 'employees'
      | 'icp'
      | 'accountOwnerId'
      | 'position'
      | 'deletedAt'
    > & { arr: number }
  > &
    Dated = {},
) {
  const { updatedAt, ...rest } = overrides
  const company = await prisma.crmCompany.create({
    data: { name: 'Seed Company', workspaceId, createdById, ...rest },
  })
  await forceUpdatedAt('crm_companies', company.id, updatedAt)
  return company
}
