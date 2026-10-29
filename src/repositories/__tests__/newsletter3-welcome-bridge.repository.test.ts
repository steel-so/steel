import { describe, expect, it, vi } from 'vitest'
import { seedNewsletterScope } from '@/src/__tests__/factories/newsletter-nl-issues.factory'
import {
  seedConfirmedSubscriber,
  seedWelcomeStep,
} from '@/src/__tests__/factories/newsletter2-automation.factory'
import { seedWelcomeDelivery } from '@/src/__tests__/factories/newsletter3-welcome-bridge.factory'
import { expectErr, expectOk } from '@/src/__tests__/helpers/result.helpers'
import { prisma } from '@/src/lib/prisma'
import { CrmLeadScoringRuleRepository } from '../crm-lead-scoring-rule.repository'
import { CrmNewsletterBridgeRepository as Bridge } from '../crm-newsletter-bridge.repository'
import { CrmNewsletterWelcomeRepository as Welcome } from '../crm-newsletter-welcome.repository'

const NOW = new Date('2026-10-29T12:00:00.000Z')

describe('welcome series ↔ CRM bridge (nl3-welcome-bridge)', () => {
  it('stores welcome clicks and counts them per delivery × URL', async () => {
    const { newsletter, userId } = await seedNewsletterScope()
    const step = await seedWelcomeStep(newsletter, userId)
    const ana = await seedConfirmedSubscriber(newsletter, 'ana@example.com')
    const delivery = await seedWelcomeDelivery(newsletter, step, ana)

    const click = {
      deliveryId: delivery.id,
      stepId: step.id,
      url: 'https://acme.com/precos',
      clickedAt: NOW,
    }
    expectOk(await Welcome.recordClick(click))
    expect(
      expectOk(await Bridge.countWelcomeClicks(delivery.id, click.url)),
    ).toBe(1)
    expectOk(await Welcome.recordClick(click))
    expect(
      expectOk(await Bridge.countWelcomeClicks(delivery.id, click.url)),
    ).toBe(2)
    expect(
      expectOk(await Bridge.countWelcomeClicks(delivery.id, 'https://other')),
    ).toBe(0)

    // Deleting the step cascades to its deliveries and their clicks.
    await prisma.crmNewsletterWelcomeStep.delete({ where: { id: step.id } })
    expect(await prisma.crmNewsletterWelcomeLinkClick.count()).toBe(0)
  })

  it('loads a welcome step with its 1-based position', async () => {
    const { newsletter, userId } = await seedNewsletterScope()
    await seedWelcomeStep(newsletter, userId)
    const second = await seedWelcomeStep(newsletter, userId, {
      subject: 'Dicas',
    })
    expect(expectOk(await Bridge.findWelcomeStep(second.id))).toEqual({
      id: second.id,
      subject: 'Dicas',
      position: 2,
    })
    expect(expectOk(await Bridge.findWelcomeStep('missing'))).toBeNull()
  })

  it('sums the welcome engagement per subscriber', async () => {
    const { newsletter, userId } = await seedNewsletterScope()
    const a = await seedWelcomeStep(newsletter, userId)
    const b = await seedWelcomeStep(newsletter, userId)
    const ana = await seedConfirmedSubscriber(newsletter, 'ana@example.com')
    const bia = await seedConfirmedSubscriber(newsletter, 'bia@example.com')
    await seedWelcomeDelivery(newsletter, a, ana, {
      openedAt: NOW,
      clickedAt: NOW,
    })
    await seedWelcomeDelivery(newsletter, b, ana)
    await seedWelcomeDelivery(newsletter, a, bia, { status: 'SKIPPED' })

    const stats = expectOk(
      await Bridge.welcomeStatsBySubscriber([ana.id, bia.id]),
    )
    expect(stats.get(ana.id)).toEqual({ sent: 2, opened: 1, clicked: 1 })
    expect(stats.get(bia.id)).toEqual({ sent: 0, opened: 0, clicked: 0 })
    expect(expectOk(await Bridge.welcomeStatsBySubscriber([])).size).toBe(0)
  })

  it('stores the scoring rule "include welcome e-mails" (default on)', async () => {
    const { newsletter } = await seedNewsletterScope()
    const workspaceId = newsletter.workspaceId
    const rule = expectOk(
      await CrmLeadScoringRuleRepository.create({
        workspaceId,
        field: 'newsletter_opened',
        operator: 'contains',
        points: 5,
      }),
    )
    expect(rule.includeWelcome).toBe(true)
    const off = expectOk(
      await CrmLeadScoringRuleRepository.update(rule.id, {
        includeWelcome: false,
      }),
    )
    expect(off.includeWelcome).toBe(false)
  })

  it('maps database failures to DATABASE_ERROR', async () => {
    const down = () => Promise.reject(new Error('down'))
    const spies = [
      vi.spyOn(prisma, '$queryRaw').mockImplementation(down as never),
      vi
        .spyOn(prisma.crmNewsletterWelcomeStep, 'findUnique')
        .mockImplementation(down as never),
      ...(['create', 'count'] as const).map((method) =>
        vi
          .spyOn(prisma.crmNewsletterWelcomeLinkClick, method)
          .mockImplementation(down as never),
      ),
    ]
    const code = 'DATABASE_ERROR'
    expectErr(
      await Welcome.recordClick({
        deliveryId: 'd',
        stepId: 's',
        url: 'u',
        clickedAt: NOW,
      }),
      code,
    )
    expectErr(await Bridge.findWelcomeStep('s'), code)
    expectErr(await Bridge.countWelcomeClicks('d', 'u'), code)
    expectErr(await Bridge.welcomeStatsBySubscriber(['s']), code)
    for (const spy of spies) spy.mockRestore()
  })
})
