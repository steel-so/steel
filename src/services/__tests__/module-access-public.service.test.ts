import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeCrmForm } from '@/src/__tests__/factories/crm-form.factory'
import { createFakeCrmIntegrationKey } from '@/src/__tests__/factories/crm-integration-key.factory'
import { createFakeCrmProposal } from '@/src/__tests__/factories/crm-proposal.factory'
import {
  createFakeCrmWorkflow,
  createFakeCrmWorkflowVersion,
} from '@/src/__tests__/factories/crm-workflow.factory'
import { expectErr } from '@/src/__tests__/helpers/result.helpers'
import { ok } from '@/src/lib/result'

vi.mock('@/src/repositories/crm-form.repository')
vi.mock('@/src/repositories/crm-proposal.repository')
vi.mock('@/src/repositories/crm-integration-key.repository')
vi.mock('@/src/repositories/crm-workflow.repository')

import { CrmFormRepository } from '@/src/repositories/crm-form.repository'
import { CrmIntegrationKeyRepository } from '@/src/repositories/crm-integration-key.repository'
import {
  CrmProposalRepository,
  CrmProposalViewRepository,
} from '@/src/repositories/crm-proposal.repository'
import {
  CrmWorkflowRepository,
  CrmWorkflowRunRepository,
} from '@/src/repositories/crm-workflow.repository'
import { WorkspaceModuleAccessRepository } from '@/src/repositories/workspace-module-access.repository'
import { CrmFormService } from '../crm-form.service'
import { CrmIntegrationKeyService } from '../crm-integration-key.service'
import { CrmProposalService } from '../crm-proposal.service'
import { CrmWorkflowService } from '../crm-workflow.service'

const isEnabled = vi.mocked(WorkspaceModuleAccessRepository.isEnabled)

/**
 * Rotas públicas do CRM (formulário, proposta, API de
 * integração, webhook de workflow) não têm sessão: resolvem a workspace pelo
 * token e precisam recusar quando o CRM está desabilitado para ela.
 */
describe('CRM public entry points — module gating', () => {
  beforeEach(() => {
    isEnabled.mockResolvedValue(ok(false))
  })

  it('refuses a public form when the CRM is disabled', async () => {
    vi.mocked(CrmFormRepository.findPublishedByPublicToken).mockResolvedValue(
      ok(createFakeCrmForm({ workspaceId: 'ws1' })),
    )

    expectErr(await CrmFormService.getPublicByToken('tok'), 'MODULE_DISABLED')
    expect(isEnabled).toHaveBeenCalledWith('ws1', 'CRM')
  })

  it('refuses a form submission without creating anything', async () => {
    vi.mocked(CrmFormRepository.findPublishedByPublicToken).mockResolvedValue(
      ok(createFakeCrmForm({ workspaceId: 'ws1' })),
    )

    expectErr(
      await CrmFormService.submit('tok', '1.1.1.1', undefined, { values: {} }),
      'MODULE_DISABLED',
    )
  })

  it('refuses a public proposal without marking it as viewed', async () => {
    vi.mocked(CrmProposalRepository.findByShareToken).mockResolvedValue(
      ok(
        createFakeCrmProposal({ workspaceId: 'ws1', status: 'SENT' }) as never,
      ),
    )

    expectErr(
      await CrmProposalService.getPublicByShareToken('tok'),
      'MODULE_DISABLED',
    )
    expect(CrmProposalRepository.setStatus).not.toHaveBeenCalled()
    expectErr(
      await CrmProposalService.recordView('tok', '1.1.1.1', {
        viewId: 'v1',
      } as never),
      'MODULE_DISABLED',
    )
    expect(CrmProposalViewRepository.record).not.toHaveBeenCalled()
  })

  it('refuses an integration API key without marking it as used', async () => {
    vi.mocked(CrmIntegrationKeyRepository.findActiveByHash).mockResolvedValue(
      ok(createFakeCrmIntegrationKey({ workspaceId: 'ws1' })),
    )

    expectErr(
      await CrmIntegrationKeyService.verify('nexo_live_x'),
      'MODULE_DISABLED',
    )
    expect(CrmIntegrationKeyRepository.markUsed).not.toHaveBeenCalled()
  })

  it('refuses a workflow webhook trigger without creating a run', async () => {
    vi.mocked(CrmWorkflowRepository.findActiveByWebhookToken).mockResolvedValue(
      ok({
        ...createFakeCrmWorkflow({ workspaceId: 'ws1' }),
        activeVersion: createFakeCrmWorkflowVersion(),
      } as never),
    )

    expectErr(
      await CrmWorkflowService.triggerWebhook('tok', {}),
      'MODULE_DISABLED',
    )
    expect(CrmWorkflowRunRepository.create).not.toHaveBeenCalled()
  })
})
