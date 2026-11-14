import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { databaseError, forbidden } from '@/src/errors'
import { err, ok } from '@/src/lib/result'

vi.mock('@/lib/axiom/audit')
vi.mock('@/src/repositories/crm-company.repository')
vi.mock('@/src/repositories/crm-person.repository')
vi.mock('../authz', () => ({ assertModuleMember: vi.fn() }))
vi.mock('../crm-lead.service')
vi.mock('../crm-person.service')
vi.mock('../crm-company.service')

import { auditMutation } from '@/lib/axiom/audit'
import { CrmCompanyRepository } from '@/src/repositories/crm-company.repository'
import { CrmPersonRepository } from '@/src/repositories/crm-person.repository'
import type {
  CrmImportEntity,
  CrmImportRow,
} from '@/src/schemas/crm-import.schema'
import { assertModuleMember } from '../authz'
import { CrmCompanyService } from '../crm-company.service'
import { CrmImportService } from '../crm-import.service'
import { CrmLeadService } from '../crm-lead.service'
import { CrmPersonService } from '../crm-person.service'

const member = vi.mocked(assertModuleMember)
const intake = vi.mocked(CrmLeadService.intake)
const createPerson = vi.mocked(CrmPersonService.create)
const createCompany = vi.mocked(CrmCompanyService.create)
const findPerson = vi.mocked(CrmPersonRepository.findFirstByContacts)
const listCompanies = vi.mocked(CrmCompanyRepository.listByWorkspace)
const audit = vi.mocked(auditMutation)

const run = (entity: CrmImportEntity, rows: CrmImportRow[]) =>
  CrmImportService.import('u1', 'ws1', { entity, rows, consentConfirmed: true })

beforeEach(() => {
  vi.resetAllMocks()
  member.mockResolvedValue(ok({} as never))
  intake.mockResolvedValue(ok({ lead: {} as never, created: true }))
  createPerson.mockResolvedValue(ok({} as never))
  createCompany.mockResolvedValue(ok({} as never))
  findPerson.mockResolvedValue(ok(null))
  listCompanies.mockResolvedValue(ok([]))
})

describe('CrmImportService.import', () => {
  it('checks the permission for the imported entity', async () => {
    member.mockResolvedValue(err(forbidden()))
    const result = await run('people', [{ name: 'Ana', email: 'a@x.com' }])
    expectErr(result, 'FORBIDDEN')
    expect(member).toHaveBeenCalledWith('u1', 'ws1', 'CRM', {
      resource: 'people',
      action: 'CREATE',
    })
    expect(createPerson).not.toHaveBeenCalled()
  })

  describe('leads', () => {
    it('creates leads in quiet bulk mode with a default origin', async () => {
      const result = expectOk(
        await run('leads', [
          {
            name: 'Ana',
            email: 'ANA@x.com; ana2@x.com',
            phone: '(11) 91234-5678',
            company: 'Acme',
          },
          { name: 'Bia', phone: '11999990000', source: 'Feira' },
        ]),
      )

      expect(result).toEqual({ created: 2, rejected: [] })
      expect(intake).toHaveBeenNthCalledWith(
        1,
        'ws1',
        { kind: 'user', userId: 'u1' },
        expect.objectContaining({
          name: 'Ana',
          emails: ['ana@x.com', 'ana2@x.com'],
          phones: ['5511912345678'],
          source: 'Importação CSV',
          company: 'Acme',
        }),
        { quiet: true },
      )
      expect(intake.mock.calls[1][2]).toMatchObject({ source: 'Feira' })
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          entity: 'crm_lead',
          action: 'import',
          actorId: 'u1',
          meta: expect.objectContaining({ rows: 2, created: 2, rejected: 0 }),
        }),
      )
    })

    it('rejects invalid rows with a reason and keeps going', async () => {
      const result = expectOk(
        await run('leads', [
          { email: 'a@x.com' },
          { name: 'Sem contato' },
          { name: 'Email ruim', email: 'nao-e-email' },
          { name: 'Fone ruim', phone: 'abc' },
          { name: 'LinkedIn', email: 'l@x.com', linkedin: 'x'.repeat(301) },
          { name: 'Ok', email: 'ok@x.com' },
        ]),
      )

      expect(result.created).toBe(1)
      expect(result.rejected.map((r) => [r.row, r.reason])).toEqual([
        [1, 'Nome é obrigatório'],
        [2, 'Informe ao menos um email ou telefone'],
        [3, 'E-mail inválido'],
        [4, 'Telefone inválido'],
        [5, 'LinkedIn: valor inválido ou longo demais'],
      ])
      expect(intake).toHaveBeenCalledTimes(1)
    })

    it('rejects a lead that already exists', async () => {
      intake.mockResolvedValue(ok({ lead: {} as never, created: false }))
      const result = expectOk(
        await run('leads', [{ name: 'Ana', email: 'a@x.com' }]),
      )
      expect(result.created).toBe(0)
      expect(result.rejected[0].reason).toContain('Já existe um lead')
    })

    it('rejects repeated e-mails and phones inside the file', async () => {
      const result = expectOk(
        await run('leads', [
          { name: 'Ana', email: 'a@x.com', phone: '11 91234-5678' },
          { name: 'Ana 2', email: 'A@x.com' },
          { name: 'Ana 3', phone: '(11) 91234-5678' },
          { name: 'Ana 4', phone: '+5511912345678' },
          { name: 'Sem contato' },
        ]),
      )
      expect(result.created).toBe(1)
      expect(result.rejected.map((r) => [r.row, r.reason])).toEqual([
        [2, 'Repetido no arquivo'],
        [3, 'Repetido no arquivo'],
        [4, 'Repetido no arquivo'],
        [5, 'Informe ao menos um email ou telefone'],
      ])
    })

    it('shows the service message, hiding database details', async () => {
      intake
        .mockResolvedValueOnce(err(forbidden('Sem permissão')))
        .mockResolvedValueOnce(err(databaseError('boom')))
      const result = expectOk(
        await run('leads', [
          { name: 'A', email: 'a@x.com' },
          { name: 'B', email: 'b@x.com' },
        ]),
      )
      expect(result.rejected.map((r) => r.reason)).toEqual([
        'Sem permissão',
        'Erro ao salvar esta linha. Tente de novo.',
      ])
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({ created: 0, rejected: 2 }),
        }),
      )
    })
  })

  describe('people', () => {
    it('creates people and links the company by name', async () => {
      listCompanies.mockResolvedValue(
        ok([{ id: 'c1', name: ' Acme ' }] as never),
      )
      const result = expectOk(
        await run('people', [
          { name: 'Ana', email: 'a@x.com', company: 'acme' },
          { name: 'Bia', phone: '11999990000', company: 'Desconhecida' },
          { name: 'Caio', email: 'c@x.com' },
        ]),
      )
      expect(result.created).toBe(3)
      expect(createPerson.mock.calls[0][2]).toMatchObject({ companyId: 'c1' })
      expect(createPerson.mock.calls[1][2].companyId).toBeUndefined()
      expect(createPerson.mock.calls[2][2].companyId).toBeUndefined()
      expect(findPerson).toHaveBeenCalledWith('ws1', {
        emails: ['a@x.com'],
        phones: [],
      })
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'crm_person', action: 'import' }),
      )
    })

    it('propagates a failure listing the companies', async () => {
      listCompanies.mockResolvedValue(err(databaseError('down')))
      expectErr(
        await run('people', [{ name: 'Ana', email: 'a@x.com' }]),
        'DATABASE_ERROR',
      )
      expect(createPerson).not.toHaveBeenCalled()
    })

    it('rejects invalid rows, rows without contact and existing people', async () => {
      findPerson
        .mockResolvedValueOnce(ok({ id: 'p1' } as never))
        .mockResolvedValueOnce(err(databaseError('down')))
      const result = expectOk(
        await run('people', [
          { name: '', email: 'a@x.com' },
          { name: 'Sem contato' },
          { name: 'Já existe', email: 'e@x.com' },
          { name: 'Falha', email: 'f@x.com' },
        ]),
      )
      expect(result.created).toBe(0)
      expect(result.rejected.map((r) => r.reason)).toEqual([
        'Nome é obrigatório',
        'Informe ao menos um e-mail ou telefone',
        'Já existe uma pessoa com este e-mail ou telefone',
        'Erro ao salvar esta linha. Tente de novo.',
      ])
    })

    it('rejects a person the service refuses to create', async () => {
      createPerson.mockResolvedValue(err(forbidden('Sem permissão')))
      const result = expectOk(
        await run('people', [{ name: 'Ana', email: 'a@x.com' }]),
      )
      expect(result.rejected).toEqual([
        { row: 1, name: 'Ana', reason: 'Sem permissão' },
      ])
    })
  })

  describe('companies', () => {
    it('creates companies with address, employees and a clean domain', async () => {
      const result = expectOk(
        await run('companies', [
          {
            name: 'Acme',
            cnpj: '12.345.678/0001-90',
            domain: 'https://www.Acme.com.br/contato?x=1',
            employees: '1.200',
            city: 'Recife',
            state: 'pe',
            linkedin: 'https://linkedin.com/company/acme',
          },
          { name: 'Beta', state: 'SP' },
          { name: 'Gama' },
        ]),
      )
      expect(result.created).toBe(3)
      expect(createCompany.mock.calls[0][2]).toMatchObject({
        name: 'Acme',
        cnpj: '12.345.678/0001-90',
        domain: 'acme.com.br',
        employees: 1200,
        address: { city: 'Recife', state: 'PE' },
      })
      expect(createCompany.mock.calls[1][2].address).toMatchObject({
        state: 'SP',
      })
      expect(createCompany.mock.calls[2][2].address).toBeUndefined()
      expect(createCompany.mock.calls[2][2].domain).toBeUndefined()
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({ entity: 'crm_company', action: 'import' }),
      )
    })

    it('rejects bad rows, repeated CNPJ/site and conflicts', async () => {
      createCompany.mockResolvedValueOnce(ok({} as never))
      createCompany.mockResolvedValueOnce(
        err(forbidden('Já existe uma empresa com este domínio ou CNPJ')),
      )
      const result = expectOk(
        await run('companies', [
          { name: 'Acme', cnpj: '12.345.678/0001-90', domain: 'acme.com' },
          { name: 'Acme filial', cnpj: '12345678000190' },
          { name: 'Acme site', domain: 'WWW.ACME.COM' },
          { name: 'Sem número', employees: 'muitos' },
          { name: '' },
          { name: 'Conflito', domain: 'conflito.com' },
        ]),
      )
      expect(result.created).toBe(1)
      expect(result.rejected.map((r) => [r.row, r.reason])).toEqual([
        [2, 'Repetido no arquivo'],
        [3, 'Repetido no arquivo'],
        [4, 'Funcionários: informe só o número'],
        [5, 'Nome é obrigatório'],
        [6, 'Já existe uma empresa com este domínio ou CNPJ'],
      ])
    })
  })
})
