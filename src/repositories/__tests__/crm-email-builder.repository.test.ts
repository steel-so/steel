import { Prisma } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { seedCrmCompany } from '@/src/__tests__/factories/crm-company.factory'
import {
  seedCrmEmailBrand,
  seedCrmEmailBuilderTemplate,
} from '@/src/__tests__/factories/crm-email-marketing.factory'
import { seedCrmForm } from '@/src/__tests__/factories/crm-form.factory'
import { seedCrmLandingPage } from '@/src/__tests__/factories/crm-landing-page.factory'
import { seedCrmPerson } from '@/src/__tests__/factories/crm-person.factory'
import { seedCrmProduct } from '@/src/__tests__/factories/crm-product.factory'
import { seedUser } from '@/src/__tests__/factories/user.factory'
import { seedWorkspace } from '@/src/__tests__/factories/workspace.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { createBuilderDocument } from '@/src/lib/crm-email-builder/layouts'
import { prisma } from '@/src/lib/prisma'
import { CrmEmailBuilderRepository } from '../crm-email-builder.repository'
import { CrmEmailTemplateRepository } from '../crm-email-template.repository'

const brandInput = {
  companyName: 'Acme',
  logoUrl: 'https://cdn/logo.png',
  primaryColor: '#112233',
  address: 'Rua A, 1',
  website: 'https://acme.com',
}

describe('CrmEmailBuilderRepository', () => {
  describe('findBrand() / upsertBrand()', () => {
    it('should return null before the brand is saved', async () => {
      const workspace = await seedWorkspace()
      expect(
        expectOk(await CrmEmailBuilderRepository.findBrand(workspace.id)),
      ).toBeNull()
    })

    it('should create then update the single brand row of the workspace', async () => {
      const [workspace, other, user] = await Promise.all([
        seedWorkspace(),
        seedWorkspace(),
        seedUser(),
      ])
      await seedCrmEmailBrand(other.id, { companyName: 'Other' })

      const created = expectOk(
        await CrmEmailBuilderRepository.upsertBrand(
          workspace.id,
          brandInput,
          user.id,
        ),
      )
      expect(created).toMatchObject({ ...brandInput, updatedById: user.id })

      const updated = expectOk(
        await CrmEmailBuilderRepository.upsertBrand(
          workspace.id,
          { ...brandInput, primaryColor: '#445566' },
          user.id,
        ),
      )
      expect(updated.id).toBe(created.id)
      expect(updated.primaryColor).toBe('#445566')

      const found = expectOk(
        await CrmEmailBuilderRepository.findBrand(workspace.id),
      )
      expect(found?.primaryColor).toBe('#445566')
      expect(
        await prisma.crmEmailBrand.count({ where: { workspaceId: other.id } }),
      ).toBe(1)
    })

    it('should return DATABASE_ERROR when the queries throw', async () => {
      vi.spyOn(prisma.crmEmailBrand, 'findUnique').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await CrmEmailBuilderRepository.findBrand('w'),
        'DATABASE_ERROR',
      )
      vi.spyOn(prisma.crmEmailBrand, 'upsert').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await CrmEmailBuilderRepository.upsertBrand('w', brandInput, 'u'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('findWorkspaceIdentity()', () => {
    it('should return the workspace name and logo', async () => {
      const workspace = await seedWorkspace()
      await prisma.workspace.update({
        where: { id: workspace.id },
        data: { logoUrl: 'https://cdn/ws.png' },
      })
      expect(
        expectOk(
          await CrmEmailBuilderRepository.findWorkspaceIdentity(workspace.id),
        ),
      ).toEqual({ name: workspace.name, logoUrl: 'https://cdn/ws.png' })
    })

    it('should return NOT_FOUND for an unknown workspace', async () => {
      expectErr(
        await CrmEmailBuilderRepository.findWorkspaceIdentity('missing'),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should return DATABASE_ERROR when the query throws', async () => {
      vi.spyOn(prisma.workspace, 'findUnique').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await CrmEmailBuilderRepository.findWorkspaceIdentity('w'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('findContacts()', () => {
    it('should return people with their company, scoped to the workspace', async () => {
      const [workspace, other, user] = await Promise.all([
        seedWorkspace(),
        seedWorkspace(),
        seedUser(),
      ])
      const company = await seedCrmCompany(workspace.id, user.id, {
        name: 'Acme Ltda.',
      })
      const maria = await seedCrmPerson(workspace.id, user.id, {
        name: 'Maria Silva',
        emails: ['maria@acme.com'],
        phones: ['11 9999'],
        city: 'São Paulo',
        jobTitle: 'Gerente',
        companyId: company.id,
      })
      const deleted = await seedCrmPerson(workspace.id, user.id, {
        deletedAt: new Date(),
      })
      const foreign = await seedCrmPerson(other.id, user.id)

      const contacts = expectOk(
        await CrmEmailBuilderRepository.findContacts(workspace.id, [
          maria.id,
          deleted.id,
          foreign.id,
        ]),
      )
      expect(contacts).toEqual([
        {
          id: maria.id,
          name: 'Maria Silva',
          emails: ['maria@acme.com'],
          phones: ['11 9999'],
          city: 'São Paulo',
          jobTitle: 'Gerente',
          companyName: 'Acme Ltda.',
        },
      ])
    })

    it('should not query when no ids are given', async () => {
      const spy = vi.spyOn(prisma.crmPerson, 'findMany')
      expect(
        expectOk(await CrmEmailBuilderRepository.findContacts('w', [])),
      ).toEqual([])
      expect(spy).not.toHaveBeenCalled()
    })

    it('should map a person without company to a null company name', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const person = await seedCrmPerson(workspace.id, user.id)
      const [contact] = expectOk(
        await CrmEmailBuilderRepository.findContacts(workspace.id, [person.id]),
      )
      expect(contact.companyName).toBeNull()
    })

    it('should return DATABASE_ERROR when the query throws', async () => {
      vi.spyOn(prisma.crmPerson, 'findMany').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await CrmEmailBuilderRepository.findContacts('w', ['p']),
        'DATABASE_ERROR',
      )
    })
  })

  describe('findProducts()', () => {
    it('should return live products of the workspace only', async () => {
      const [workspace, other, user] = await Promise.all([
        seedWorkspace(),
        seedWorkspace(),
        seedUser(),
      ])
      const [live, deleted, foreign] = await Promise.all([
        seedCrmProduct(workspace.id, user.id, {
          name: 'Plano Pro',
          unitPrice: new Prisma.Decimal('99.9'),
        }),
        seedCrmProduct(workspace.id, user.id, { deletedAt: new Date() }),
        seedCrmProduct(other.id, user.id),
      ])
      const rows = expectOk(
        await CrmEmailBuilderRepository.findProducts(workspace.id, [
          live.id,
          deleted.id,
          foreign.id,
        ]),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        id: live.id,
        name: 'Plano Pro',
        description: null,
        currency: 'BRL',
      })
      expect(rows[0].unitPrice.toString()).toBe('99.9')
    })

    it('should not query when no ids are given', async () => {
      const spy = vi.spyOn(prisma.crmProduct, 'findMany')
      expect(
        expectOk(await CrmEmailBuilderRepository.findProducts('w', [])),
      ).toEqual([])
      expect(spy).not.toHaveBeenCalled()
    })

    it('should return DATABASE_ERROR when the query throws', async () => {
      vi.spyOn(prisma.crmProduct, 'findMany').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await CrmEmailBuilderRepository.findProducts('w', ['p']),
        'DATABASE_ERROR',
      )
    })
  })

  describe('listPublishedLinkTargets()', () => {
    it('should list only published, live landing pages and forms of the workspace', async () => {
      const [workspace, other, user] = await Promise.all([
        seedWorkspace(),
        seedWorkspace(),
        seedUser(),
      ])
      const page = await seedCrmLandingPage(workspace.id, user.id, {
        title: 'Black Friday',
        status: 'PUBLISHED',
      })
      await seedCrmLandingPage(workspace.id, user.id, { status: 'DRAFT' })
      await seedCrmLandingPage(workspace.id, user.id, {
        status: 'PUBLISHED',
        deletedAt: new Date(),
      })
      await seedCrmLandingPage(other.id, user.id, { status: 'PUBLISHED' })
      const form = await seedCrmForm(workspace.id, user.id, {
        name: 'Contato',
        status: 'PUBLISHED',
      })
      await seedCrmForm(workspace.id, user.id, { status: 'DRAFT' })

      const targets = expectOk(
        await CrmEmailBuilderRepository.listPublishedLinkTargets(workspace.id),
      )
      expect(targets).toEqual({
        landingPages: [
          { id: page.id, title: 'Black Friday', shareToken: page.shareToken },
        ],
        forms: [
          { id: form.id, name: 'Contato', publicToken: form.publicToken },
        ],
      })
    })

    it('should return DATABASE_ERROR when the query throws', async () => {
      vi.spyOn(prisma.crmForm, 'findMany').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await CrmEmailBuilderRepository.listPublishedLinkTargets('w'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('findUserIdentity()', () => {
    it('should return the e-mail and name of the user', async () => {
      const user = await seedUser()
      expect(
        expectOk(await CrmEmailBuilderRepository.findUserIdentity(user.id)),
      ).toEqual({ email: user.email, name: user.name })
    })

    it('should return NOT_FOUND for an unknown user', async () => {
      expectErr(
        await CrmEmailBuilderRepository.findUserIdentity('missing'),
        'RESOURCE_NOT_FOUND',
      )
    })

    it('should return DATABASE_ERROR when the query throws', async () => {
      vi.spyOn(prisma.user, 'findUnique').mockRejectedValueOnce(
        new Error('boom'),
      )
      expectErr(
        await CrmEmailBuilderRepository.findUserIdentity('u'),
        'DATABASE_ERROR',
      )
    })
  })

  describe('CrmEmailTemplateRepository with builder fields', () => {
    it('should persist and update the builder document and plain text', async () => {
      const [workspace, user] = await Promise.all([seedWorkspace(), seedUser()])
      const created = expectOk(
        await CrmEmailTemplateRepository.create({
          workspaceId: workspace.id,
          createdById: user.id,
          name: 'Newsletter',
          subject: 'Oi',
          contentHtml: '<html></html>',
          contentText: 'texto',
          kind: 'BUILDER',
          builderDocument: createBuilderDocument('newsletter'),
        }),
      )
      expect(created.kind).toBe('BUILDER')
      expect(created.contentText).toBe('texto')

      const doc = createBuilderDocument('promocao')
      const updated = expectOk(
        await CrmEmailTemplateRepository.update(created.id, {
          builderDocument: doc,
          contentText: 'novo',
        }),
      )
      expect(updated.builderDocument).toEqual(doc)
      expect(updated.contentText).toBe('novo')

      const seeded = await seedCrmEmailBuilderTemplate(workspace.id, user.id)
      expect(seeded.kind).toBe('BUILDER')
    })
  })
})
