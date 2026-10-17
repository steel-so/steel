import { z } from 'zod'
import { err, ok, type Result } from '@/src/lib/result'
import { CrmCompanyService } from '@/src/services/crm-company.service'
import { CrmPersonService } from '@/src/services/crm-person.service'
import type { CrmCompanyDTO } from '@/types/crm-company'
import type { CrmPersonDTO } from '@/types/crm-person'
import type { AiToolContext, SteelAiTool } from '../types'
import {
  afterFields,
  changeFields,
  companyName,
  crmBase,
  formatMoney,
  matchesQuery,
  memberNames,
  nothingToChange,
  ownerParameter,
  pageParameters,
  pageSchema,
  paginate,
  recordHref,
  resolveCompany,
  resolveMember,
  zodParser,
} from './shared'

/* ================================= people ================================= */

export function compactPerson(person: CrmPersonDTO, base: string | null) {
  return {
    id: person.id,
    name: person.name,
    emails: person.emails,
    phones: person.phones,
    jobTitle: person.jobTitle,
    city: person.city,
    companyId: person.companyId,
    href: recordHref(base, 'person', person.id),
  }
}

function personTarget(p: { id: string; name: string }, base: string | null) {
  return {
    type: 'crm_person',
    id: p.id,
    label: p.name,
    href: recordHref(base, 'person', p.id),
  }
}

const ListPeopleArgs = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  company: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1).optional(),
  ...pageSchema,
})

export const crmListPeopleTool: SteelAiTool<z.output<typeof ListPeopleArgs>> = {
  name: 'crm_list_people',
  label: 'Consultando pessoas',
  module: 'CRM',
  kind: 'READ',
  description:
    'Lista as pessoas (contatos) do CRM com filtros e paginação: trecho do nome/e-mail/telefone/cargo, empresa (nome ou id) e cidade.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      company: { type: 'string', description: 'Empresa: nome ou id.' },
      city: { type: 'string' },
      ...pageParameters,
    },
    additionalProperties: false,
  },
  permission: { resource: 'people', action: 'VIEW' },
  parse: zodParser(ListPeopleArgs),
  async execute(ctx, args) {
    let companyId: string | undefined
    if (args.company) {
      const company = await resolveCompany(ctx, args.company)
      if (!company.ok) return company
      companyId = company.value.id
    }
    const people = await CrmPersonService.list(ctx.actorId, ctx.workspaceId, {
      companyId,
    })
    if (!people.ok) return people
    const filtered = people.value.filter(
      (p) =>
        matchesQuery(args.query, [
          p.name,
          p.jobTitle,
          ...p.emails,
          ...p.phones,
        ]) && matchesQuery(args.city, [p.city]),
    )
    const base = await crmBase(ctx)
    const page = paginate(filtered, args, (p) => compactPerson(p, base))
    return ok({ data: page, summary: `${page.total} pessoa(s) encontrada(s)` })
  },
}

const personProperties = {
  name: { type: 'string' },
  emails: { type: 'array', items: { type: 'string' } },
  phones: { type: 'array', items: { type: 'string' } },
  jobTitle: { type: 'string' },
  city: { type: 'string' },
  linkedin: { type: 'string' },
}

const CreatePersonArgs = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(200),
  emails: z.array(z.email()).default([]),
  phones: z.array(z.string().max(30)).default([]),
  jobTitle: z.string().max(150).optional(),
  city: z.string().max(100).optional(),
  linkedin: z.string().max(300).optional(),
  company: z.string().trim().min(1).optional(),
})

async function resolveOptionalCompany(
  ctx: AiToolContext,
  input: string | null | undefined,
): Promise<Result<{ id: string; name: string } | null | undefined>> {
  if (input === undefined || input === null) return ok(input)
  const company = await resolveCompany(ctx, input)
  if (!company.ok) return company
  return ok({ id: company.value.id, name: company.value.name })
}

export const crmCreatePersonTool: SteelAiTool<
  z.output<typeof CreatePersonArgs>
> = {
  name: 'crm_create_person',
  label: 'Criando pessoa',
  module: 'CRM',
  kind: 'CREATE',
  annotations: { destructiveHint: false },
  description:
    'Cria uma pessoa (contato) no CRM, opcionalmente vinculada a uma empresa (nome, domínio, CNPJ ou id).',
  parameters: {
    type: 'object',
    properties: {
      ...personProperties,
      company: { type: 'string', description: 'Empresa: nome ou id.' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  permission: { resource: 'people', action: 'CREATE' },
  parse: zodParser(CreatePersonArgs),
  async preview(ctx, args) {
    const company = await resolveOptionalCompany(ctx, args.company)
    if (!company.ok) return company
    return ok({
      title: `Criar a pessoa “${args.name}”`,
      summary: 'Um novo contato entra no CRM.',
      fields: afterFields([
        ['Nome', args.name],
        ['E-mails', args.emails],
        ['Telefones', args.phones],
        ['Cargo', args.jobTitle],
        ['Cidade', args.city],
        ['LinkedIn', args.linkedin],
        ['Empresa', company.value?.name],
      ]),
      target: { type: 'crm_person', label: args.name },
    })
  },
  async execute(ctx, args) {
    const company = await resolveOptionalCompany(ctx, args.company)
    if (!company.ok) return company
    const { company: _company, ...dto } = args
    const person = await CrmPersonService.create(ctx.actorId, ctx.workspaceId, {
      ...dto,
      companyId: company.value?.id,
    })
    if (!person.ok) return person
    const base = await crmBase(ctx)
    return ok({
      data: compactPerson(person.value, base),
      summary: `Pessoa “${person.value.name}” criada`,
      target: personTarget(person.value, base),
    })
  },
}

const UpdatePersonArgs = z
  .object({
    personId: z.string().min(1),
    name: z.string().trim().min(1).max(200).optional(),
    emails: z.array(z.email()).optional(),
    phones: z.array(z.string().max(30)).optional(),
    jobTitle: z.string().max(150).nullable().optional(),
    city: z.string().max(100).nullable().optional(),
    linkedin: z.string().max(300).nullable().optional(),
    company: z.string().trim().min(1).nullable().optional(),
  })
  .refine((a) => Object.keys(a).some((k) => k !== 'personId'), {
    message: 'Informe ao menos um campo para alterar',
  })

export const crmUpdatePersonTool: SteelAiTool<
  z.output<typeof UpdatePersonArgs>
> = {
  name: 'crm_update_person',
  label: 'Atualizando pessoa',
  module: 'CRM',
  kind: 'UPDATE',
  annotations: { idempotentHint: true, destructiveHint: true },
  description:
    'Altera dados de uma pessoa. Envie só o que muda; null limpa o campo; listas (emails/phones) substituem as atuais; `company` null desvincula da empresa.',
  parameters: {
    type: 'object',
    properties: {
      personId: {
        type: 'string',
        description: 'Id da pessoa (de crm_list_people ou ws_search).',
      },
      ...personProperties,
      jobTitle: { type: ['string', 'null'] },
      city: { type: ['string', 'null'] },
      linkedin: { type: ['string', 'null'] },
      company: {
        type: ['string', 'null'],
        description: 'Empresa: nome ou id.',
      },
    },
    required: ['personId'],
    additionalProperties: false,
  },
  permission: { resource: 'people', action: 'EDIT' },
  parse: zodParser(UpdatePersonArgs),
  async preview(ctx, args) {
    const person = await CrmPersonService.getById(
      ctx.actorId,
      ctx.workspaceId,
      args.personId,
    )
    if (!person.ok) return person
    const company = await resolveOptionalCompany(ctx, args.company)
    if (!company.ok) return company
    const before = person.value
    const fields = changeFields([
      ['Nome', before.name, args.name],
      ['E-mails', before.emails, args.emails],
      ['Telefones', before.phones, args.phones],
      ['Cargo', before.jobTitle, args.jobTitle],
      ['Cidade', before.city, args.city],
      ['LinkedIn', before.linkedin, args.linkedin],
      [
        'Empresa',
        args.company === undefined
          ? null
          : await companyName(ctx, before.companyId),
        company.value === undefined ? undefined : (company.value?.name ?? null),
      ],
    ])
    if (fields.length === 0) return err(nothingToChange())
    const base = await crmBase(ctx)
    return ok({
      title: `Atualizar a pessoa “${before.name}”`,
      summary: `${fields.length} campo(s) alterado(s).`,
      fields,
      target: personTarget(before, base),
    })
  },
  async execute(ctx, args) {
    const company = await resolveOptionalCompany(ctx, args.company)
    if (!company.ok) return company
    const { personId, company: _company, ...dto } = args
    const person = await CrmPersonService.update(
      ctx.actorId,
      ctx.workspaceId,
      personId,
      {
        ...dto,
        companyId:
          company.value === undefined ? undefined : (company.value?.id ?? null),
      },
    )
    if (!person.ok) return person
    const base = await crmBase(ctx)
    return ok({
      data: compactPerson(person.value, base),
      summary: `Pessoa “${person.value.name}” atualizada`,
      target: personTarget(person.value, base),
    })
  },
}

const PersonIdArgs = z.object({ personId: z.string().min(1) })

export const crmDeletePersonTool: SteelAiTool<z.output<typeof PersonIdArgs>> = {
  name: 'crm_delete_person',
  label: 'Excluindo pessoa',
  module: 'CRM',
  kind: 'DELETE',
  annotations: { idempotentHint: true, destructiveHint: true },
  description:
    'Exclui uma pessoa (contato) do CRM: ela some das listas e buscas. Não há ferramenta para desfazer.',
  parameters: {
    type: 'object',
    properties: {
      personId: {
        type: 'string',
        description: 'Id da pessoa (de crm_list_people ou ws_search).',
      },
    },
    required: ['personId'],
    additionalProperties: false,
  },
  permission: { resource: 'people', action: 'DELETE' },
  parse: zodParser(PersonIdArgs),
  async preview(ctx, args) {
    const person = await CrmPersonService.getById(
      ctx.actorId,
      ctx.workspaceId,
      args.personId,
    )
    if (!person.ok) return person
    const base = await crmBase(ctx)
    return ok({
      title: `Excluir a pessoa “${person.value.name}”`,
      summary: 'O contato sai das listas do CRM.',
      fields: afterFields([
        ['E-mails', person.value.emails],
        ['Telefones', person.value.phones],
      ]),
      target: personTarget(person.value, base),
    })
  },
  async execute(ctx, args) {
    const person = await CrmPersonService.getById(
      ctx.actorId,
      ctx.workspaceId,
      args.personId,
    )
    if (!person.ok) return person
    const removed = await CrmPersonService.remove(
      ctx.actorId,
      ctx.workspaceId,
      args.personId,
    )
    if (!removed.ok) return removed
    return ok({
      data: { id: args.personId, deleted: true },
      summary: `Pessoa “${person.value.name}” excluída`,
      target: {
        type: 'crm_person',
        id: args.personId,
        label: person.value.name,
      },
    })
  },
}

/* ================================ companies ================================ */

export function compactCompany(
  company: CrmCompanyDTO,
  base: string | null,
  owners: Map<string, string>,
) {
  return {
    id: company.id,
    name: company.name,
    domain: company.domain,
    cnpj: company.cnpj,
    employees: company.employees,
    arr: company.arr,
    icp: company.icp,
    city: company.address?.city ?? null,
    accountOwnerId: company.accountOwnerId,
    accountOwnerName: company.accountOwnerId
      ? (owners.get(company.accountOwnerId) ?? null)
      : null,
    href: recordHref(base, 'company', company.id),
  }
}

function companyTarget(c: { id: string; name: string }, base: string | null) {
  return {
    type: 'crm_company',
    id: c.id,
    label: c.name,
    href: recordHref(base, 'company', c.id),
  }
}

const ListCompaniesArgs = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  icp: z.boolean().optional(),
  owner: z.string().trim().min(1).optional(),
  ...pageSchema,
})

export const crmListCompaniesTool: SteelAiTool<
  z.output<typeof ListCompaniesArgs>
> = {
  name: 'crm_list_companies',
  label: 'Consultando empresas',
  module: 'CRM',
  kind: 'READ',
  description:
    'Lista as empresas (contas) do CRM com filtros e paginação: trecho do nome/domínio/CNPJ, se é ICP (perfil de cliente ideal) e responsável pela conta.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      icp: { type: 'boolean' },
      owner: ownerParameter,
      ...pageParameters,
    },
    additionalProperties: false,
  },
  permission: { resource: 'companies', action: 'VIEW' },
  parse: zodParser(ListCompaniesArgs),
  async execute(ctx, args) {
    let ownerId: string | undefined
    if (args.owner) {
      const owner = await resolveMember(ctx, args.owner)
      if (!owner.ok) return owner
      ownerId = owner.value.id
    }
    const companies = await CrmCompanyService.list(
      ctx.actorId,
      ctx.workspaceId,
      { icp: args.icp },
    )
    if (!companies.ok) return companies
    const filtered = companies.value.filter(
      (c) =>
        matchesQuery(args.query, [c.name, c.domain, c.cnpj]) &&
        (!ownerId || c.accountOwnerId === ownerId),
    )
    const [base, owners] = await Promise.all([crmBase(ctx), memberNames(ctx)])
    const page = paginate(filtered, args, (c) =>
      compactCompany(c, base, owners),
    )
    return ok({ data: page, summary: `${page.total} empresa(s) encontrada(s)` })
  },
}

const companyProperties = {
  name: { type: 'string' },
  cnpj: { type: 'string' },
  domain: {
    type: 'string',
    description: 'Domínio do site (ex.: acme.com.br).',
  },
  employees: { type: 'integer', minimum: 0 },
  linkedin: { type: 'string' },
  arr: { type: 'number', description: 'Receita recorrente anual (R$).' },
  icp: { type: 'boolean', description: 'Perfil de cliente ideal.' },
}

const CreateCompanyArgs = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório').max(200),
  cnpj: z.string().max(20).optional(),
  domain: z.string().max(200).optional(),
  employees: z.coerce.number().int().min(0).optional(),
  linkedin: z.string().max(300).optional(),
  arr: z.coerce.number().min(0).optional(),
  icp: z.boolean().default(false),
})

export const crmCreateCompanyTool: SteelAiTool<
  z.output<typeof CreateCompanyArgs>
> = {
  name: 'crm_create_company',
  label: 'Criando empresa',
  module: 'CRM',
  kind: 'CREATE',
  annotations: { destructiveHint: false },
  description: 'Cria uma empresa (conta) no CRM.',
  parameters: {
    type: 'object',
    properties: companyProperties,
    required: ['name'],
    additionalProperties: false,
  },
  permission: { resource: 'companies', action: 'CREATE' },
  parse: zodParser(CreateCompanyArgs),
  async preview(_ctx, args) {
    return ok({
      title: `Criar a empresa “${args.name}”`,
      summary: 'Uma nova empresa entra no CRM.',
      fields: afterFields([
        ['Nome', args.name],
        ['CNPJ', args.cnpj],
        ['Domínio', args.domain],
        ['Funcionários', args.employees],
        ['LinkedIn', args.linkedin],
        ['ARR', formatMoney(args.arr)],
        ['ICP', args.icp],
      ]),
      target: { type: 'crm_company', label: args.name },
    })
  },
  async execute(ctx, args) {
    const company = await CrmCompanyService.create(
      ctx.actorId,
      ctx.workspaceId,
      args,
    )
    if (!company.ok) return company
    const base = await crmBase(ctx)
    return ok({
      data: compactCompany(company.value, base, new Map()),
      summary: `Empresa “${company.value.name}” criada`,
      target: companyTarget(company.value, base),
    })
  },
}

const UpdateCompanyArgs = z
  .object({
    companyId: z.string().min(1),
    name: z.string().trim().min(1).max(200).optional(),
    cnpj: z.string().max(20).nullable().optional(),
    domain: z.string().max(200).nullable().optional(),
    employees: z.coerce.number().int().min(0).nullable().optional(),
    linkedin: z.string().max(300).nullable().optional(),
    arr: z.coerce.number().min(0).nullable().optional(),
    icp: z.boolean().optional(),
  })
  .refine((a) => Object.keys(a).some((k) => k !== 'companyId'), {
    message: 'Informe ao menos um campo para alterar',
  })

export const crmUpdateCompanyTool: SteelAiTool<
  z.output<typeof UpdateCompanyArgs>
> = {
  name: 'crm_update_company',
  label: 'Atualizando empresa',
  module: 'CRM',
  kind: 'UPDATE',
  annotations: { idempotentHint: true, destructiveHint: true },
  description:
    'Altera dados de uma empresa. Envie só o que muda; null limpa o campo. Para o responsável pela conta use crm_assign_owner.',
  parameters: {
    type: 'object',
    properties: {
      companyId: {
        type: 'string',
        description: 'Id da empresa (de crm_list_companies ou ws_search).',
      },
      ...companyProperties,
      cnpj: { type: ['string', 'null'] },
      domain: { type: ['string', 'null'] },
      employees: { type: ['integer', 'null'], minimum: 0 },
      linkedin: { type: ['string', 'null'] },
      arr: { type: ['number', 'null'] },
    },
    required: ['companyId'],
    additionalProperties: false,
  },
  permission: { resource: 'companies', action: 'EDIT' },
  parse: zodParser(UpdateCompanyArgs),
  async preview(ctx, args) {
    const company = await CrmCompanyService.getById(
      ctx.actorId,
      ctx.workspaceId,
      args.companyId,
    )
    if (!company.ok) return company
    const before = company.value
    const fields = changeFields([
      ['Nome', before.name, args.name],
      ['CNPJ', before.cnpj, args.cnpj],
      ['Domínio', before.domain, args.domain],
      ['Funcionários', before.employees, args.employees],
      ['LinkedIn', before.linkedin, args.linkedin],
      [
        'ARR',
        formatMoney(before.arr),
        args.arr === undefined ? undefined : formatMoney(args.arr),
      ],
      ['ICP', before.icp, args.icp],
    ])
    if (fields.length === 0) return err(nothingToChange())
    const base = await crmBase(ctx)
    return ok({
      title: `Atualizar a empresa “${before.name}”`,
      summary: `${fields.length} campo(s) alterado(s).`,
      fields,
      target: companyTarget(before, base),
    })
  },
  async execute(ctx, args) {
    const { companyId, ...dto } = args
    const company = await CrmCompanyService.update(
      ctx.actorId,
      ctx.workspaceId,
      companyId,
      { ...dto, address: undefined },
    )
    if (!company.ok) return company
    const base = await crmBase(ctx)
    return ok({
      data: compactCompany(company.value, base, new Map()),
      summary: `Empresa “${company.value.name}” atualizada`,
      target: companyTarget(company.value, base),
    })
  },
}

const CompanyIdArgs = z.object({ companyId: z.string().min(1) })

export const crmDeleteCompanyTool: SteelAiTool<z.output<typeof CompanyIdArgs>> =
  {
    name: 'crm_delete_company',
    label: 'Excluindo empresa',
    module: 'CRM',
    kind: 'DELETE',
    annotations: { idempotentHint: true, destructiveHint: true },
    description:
      'Exclui uma empresa (conta) do CRM: ela some das listas e buscas, e o CNPJ e o domínio ficam livres para outro cadastro. Não há ferramenta para desfazer.',
    parameters: {
      type: 'object',
      properties: {
        companyId: {
          type: 'string',
          description: 'Id da empresa (de crm_list_companies ou ws_search).',
        },
      },
      required: ['companyId'],
      additionalProperties: false,
    },
    permission: { resource: 'companies', action: 'DELETE' },
    parse: zodParser(CompanyIdArgs),
    async preview(ctx, args) {
      const company = await CrmCompanyService.getById(
        ctx.actorId,
        ctx.workspaceId,
        args.companyId,
      )
      if (!company.ok) return company
      const base = await crmBase(ctx)
      return ok({
        title: `Excluir a empresa “${company.value.name}”`,
        summary: 'A empresa sai das listas do CRM.',
        fields: afterFields([
          ['Domínio', company.value.domain],
          ['CNPJ', company.value.cnpj],
        ]),
        target: companyTarget(company.value, base),
      })
    },
    async execute(ctx, args) {
      const company = await CrmCompanyService.getById(
        ctx.actorId,
        ctx.workspaceId,
        args.companyId,
      )
      if (!company.ok) return company
      const removed = await CrmCompanyService.remove(
        ctx.actorId,
        ctx.workspaceId,
        args.companyId,
      )
      if (!removed.ok) return removed
      return ok({
        data: { id: args.companyId, deleted: true },
        summary: `Empresa “${company.value.name}” excluída`,
        target: {
          type: 'crm_company',
          id: args.companyId,
          label: company.value.name,
        },
      })
    },
  }

export const CRM_CONTACT_TOOLS = [
  crmListPeopleTool,
  crmCreatePersonTool,
  crmUpdatePersonTool,
  crmDeletePersonTool,
  crmListCompaniesTool,
  crmCreateCompanyTool,
  crmUpdateCompanyTool,
  crmDeleteCompanyTool,
]
