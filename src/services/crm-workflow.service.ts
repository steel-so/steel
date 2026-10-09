import type { CrmWorkflow } from '@prisma/client'
import { auditMutation } from '@/lib/axiom/audit'
import {
  crmWorkflowExecutionFailed,
  crmWorkflowInvalidDefinition,
  crmWorkflowNotFound,
  crmWorkflowVersionNotDraft,
  crmWorkflowVersionNotFound,
  crmWorkflowWebhookInvalid,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  parseCrmWorkflowDefinition,
  toCrmWorkflowDTO,
  toCrmWorkflowRunDTO,
  toCrmWorkflowVersionDTO,
  triggerTypeToPrisma,
} from '@/src/mappers/crm-workflow.mapper'
import {
  CrmWorkflowRepository,
  CrmWorkflowRunRepository,
  CrmWorkflowVersionRepository,
} from '@/src/repositories/crm-workflow.repository'
import {
  type CreateCrmWorkflowDTO,
  type CrmWorkflowDefinition,
  CrmWorkflowDefinitionSchema,
  type CrmWorkflowDTO,
  type CrmWorkflowRunDTO,
  type CrmWorkflowVersionDTO,
  type ResumeCrmWorkflowRunDTO,
  type TriggerCrmWorkflowManualRunDTO,
  type UpdateCrmWorkflowDraftDTO,
  type UpdateCrmWorkflowDTO,
} from '@/src/schemas/crm-workflow.schema'
import {
  resumeCrmWorkflow,
  runCrmWorkflow,
} from '@/src/services/crm-workflow-runner'
import { assertModuleEnabled, assertModuleMember } from './authz'

function emptyDefinition(): CrmWorkflowDefinition {
  return {
    trigger: { id: 'trigger', position: { x: 0, y: 0 }, data: null },
    nodes: [],
    edges: [],
  }
}

async function loadInWorkspace(
  workspaceId: string,
  id: string,
): Promise<Result<CrmWorkflow>> {
  const found = await CrmWorkflowRepository.findById(id)
  if (!found.ok) return found
  if (
    !found.value ||
    found.value.workspaceId !== workspaceId ||
    found.value.deletedAt
  ) {
    return err(crmWorkflowNotFound())
  }
  return ok(found.value)
}

export const CrmWorkflowService = {
  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateCrmWorkflowDTO,
  ): Promise<Result<CrmWorkflowDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'workflows',
      action: 'CREATE',
    })
    if (!membership.ok) return membership

    const created = await CrmWorkflowRepository.create({
      workspaceId,
      createdById: actorId,
      name: dto.name,
      description: dto.description ?? null,
      initialDefinition: emptyDefinition(),
    })
    if (!created.ok) {
      auditMutation({
        entity: 'crm_workflow',
        action: 'create',
        actorId,
        outcome: 'failure',
        reason: created.error.code,
      })
      return created
    }

    auditMutation({
      entity: 'crm_workflow',
      action: 'create',
      actorId,
      targetId: created.value.id,
    })
    return ok(toCrmWorkflowDTO(created.value))
  },

  async list(
    actorId: string,
    workspaceId: string,
  ): Promise<Result<CrmWorkflowDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'workflows',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const list = await CrmWorkflowRepository.listByWorkspace(workspaceId)
    if (!list.ok) return list
    return ok(list.value.map(toCrmWorkflowDTO))
  },

  async getById(
    actorId: string,
    workspaceId: string,
    workflowId: string,
  ): Promise<Result<CrmWorkflowDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'workflows',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const wf = await loadInWorkspace(workspaceId, workflowId)
    if (!wf.ok) return wf
    return ok(toCrmWorkflowDTO(wf.value))
  },

  async update(
    actorId: string,
    workspaceId: string,
    workflowId: string,
    dto: UpdateCrmWorkflowDTO,
  ): Promise<Result<CrmWorkflowDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'workflows',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await loadInWorkspace(workspaceId, workflowId)
    if (!existing.ok) return existing

    const updated = await CrmWorkflowRepository.update(workflowId, {
      updatedById: actorId,
      name: dto.name,
      description: dto.description,
      status: dto.status,
    })
    if (!updated.ok) return updated

    auditMutation({
      entity: 'crm_workflow',
      action: 'update',
      actorId,
      targetId: workflowId,
      meta: { fields: Object.keys(dto) },
    })
    return ok(toCrmWorkflowDTO(updated.value))
  },

  async remove(
    actorId: string,
    workspaceId: string,
    workflowId: string,
  ): Promise<Result<void>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'workflows',
      action: 'DELETE',
    })
    if (!membership.ok) return membership

    const existing = await loadInWorkspace(workspaceId, workflowId)
    if (!existing.ok) return existing

    const removed = await CrmWorkflowRepository.softDelete(workflowId, actorId)
    if (!removed.ok) return removed

    auditMutation({
      entity: 'crm_workflow',
      action: 'delete',
      actorId,
      targetId: workflowId,
    })
    return ok(undefined)
  },

  async getDraft(
    actorId: string,
    workspaceId: string,
    workflowId: string,
  ): Promise<Result<CrmWorkflowVersionDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'workflows',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const existing = await loadInWorkspace(workspaceId, workflowId)
    if (!existing.ok) return existing

    const draft = await CrmWorkflowVersionRepository.findDraft(workflowId)
    if (!draft.ok) return draft
    if (!draft.value) return err(crmWorkflowVersionNotFound())
    return ok(toCrmWorkflowVersionDTO(draft.value))
  },

  async listVersions(
    actorId: string,
    workspaceId: string,
    workflowId: string,
  ): Promise<Result<CrmWorkflowVersionDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'workflows',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const existing = await loadInWorkspace(workspaceId, workflowId)
    if (!existing.ok) return existing

    const list = await CrmWorkflowVersionRepository.listByWorkflow(workflowId)
    if (!list.ok) return list
    return ok(list.value.map(toCrmWorkflowVersionDTO))
  },

  /** Autosave: persiste o `definition` no DRAFT corrente. */
  async updateDraft(
    actorId: string,
    workspaceId: string,
    workflowId: string,
    dto: UpdateCrmWorkflowDraftDTO,
  ): Promise<Result<CrmWorkflowVersionDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'workflows',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await loadInWorkspace(workspaceId, workflowId)
    if (!existing.ok) return existing

    const draft = await CrmWorkflowVersionRepository.findDraft(workflowId)
    if (!draft.ok) return draft
    if (!draft.value) return err(crmWorkflowVersionNotDraft())

    const parsed = CrmWorkflowDefinitionSchema.safeParse(dto.definition)
    if (!parsed.success) {
      return err(
        crmWorkflowInvalidDefinition('Definição inválida', parsed.error.issues),
      )
    }
    const updated = await CrmWorkflowVersionRepository.updateDefinition(
      draft.value.id,
      parsed.data,
    )
    if (!updated.ok) return updated
    await CrmWorkflowRepository.update(workflowId, { updatedById: actorId })
    return ok(toCrmWorkflowVersionDTO(updated.value))
  },

  /** Activate: precisa ter trigger configurado. */
  async activate(
    actorId: string,
    workspaceId: string,
    workflowId: string,
  ): Promise<Result<CrmWorkflowDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'workflows',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await loadInWorkspace(workspaceId, workflowId)
    if (!existing.ok) return existing

    const draft = await CrmWorkflowVersionRepository.findDraft(workflowId)
    if (!draft.ok) return draft
    if (!draft.value) return err(crmWorkflowVersionNotDraft())

    const definition = parseCrmWorkflowDefinition(draft.value.definition)
    if (!definition.trigger.data) {
      return err(
        crmWorkflowInvalidDefinition('Configure o trigger antes de ativar'),
      )
    }

    const activated = await CrmWorkflowVersionRepository.activateDraft(
      workflowId,
      draft.value.id,
    )
    if (!activated.ok) return activated

    const reloaded = await CrmWorkflowRepository.findById(workflowId)
    if (!reloaded.ok) return reloaded
    if (!reloaded.value) return err(crmWorkflowNotFound())

    auditMutation({
      entity: 'crm_workflow',
      action: 'update',
      actorId,
      targetId: workflowId,
      meta: { status: 'ACTIVE' },
    })
    return ok(toCrmWorkflowDTO(reloaded.value))
  },

  /** Deactivate: só muda o status — não mexe nas versões. */
  async deactivate(
    actorId: string,
    workspaceId: string,
    workflowId: string,
  ): Promise<Result<CrmWorkflowDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'workflows',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await loadInWorkspace(workspaceId, workflowId)
    if (!existing.ok) return existing

    const updated = await CrmWorkflowRepository.update(workflowId, {
      updatedById: actorId,
      status: 'DEACTIVATED',
    })
    if (!updated.ok) return updated

    auditMutation({
      entity: 'crm_workflow',
      action: 'update',
      actorId,
      targetId: workflowId,
      meta: { status: 'DEACTIVATED' },
    })
    return ok(toCrmWorkflowDTO(updated.value))
  },

  /** Discard: descarta alterações no draft (volta para o ACTIVE). */
  async discard(
    actorId: string,
    workspaceId: string,
    workflowId: string,
  ): Promise<Result<CrmWorkflowVersionDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'workflows',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await loadInWorkspace(workspaceId, workflowId)
    if (!existing.ok) return existing

    const result = await CrmWorkflowVersionRepository.discardDraft(workflowId)
    if (!result.ok) return result
    if (!result.value) return err(crmWorkflowVersionNotDraft())
    return ok(toCrmWorkflowVersionDTO(result.value))
  },

  async listRuns(
    actorId: string,
    workspaceId: string,
    workflowId: string,
  ): Promise<Result<CrmWorkflowRunDTO[]>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'workflows',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const existing = await loadInWorkspace(workspaceId, workflowId)
    if (!existing.ok) return existing

    const list = await CrmWorkflowRunRepository.listByWorkflow(workflowId)
    if (!list.ok) return list
    return ok(list.value.map((run) => toCrmWorkflowRunDTO(run)))
  },

  async getRun(
    actorId: string,
    workspaceId: string,
    workflowId: string,
    runId: string,
  ): Promise<Result<CrmWorkflowRunDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'workflows',
      action: 'VIEW',
    })
    if (!membership.ok) return membership

    const existing = await loadInWorkspace(workspaceId, workflowId)
    if (!existing.ok) return existing

    const run = await CrmWorkflowRunRepository.findById(runId)
    if (!run.ok) return run
    if (!run.value || run.value.workflowId !== workflowId) {
      return err(crmWorkflowNotFound())
    }
    return ok(toCrmWorkflowRunDTO(run.value))
  },

  /**
   * Disparo manual via UI ("Test" / botão Run). Cria a run, despacha pro
   * runner e retorna a run criada. O runner roda em foreground (await).
   */
  async triggerManual(
    actorId: string,
    workspaceId: string,
    workflowId: string,
    dto: TriggerCrmWorkflowManualRunDTO,
  ): Promise<Result<CrmWorkflowRunDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'workflows',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await loadInWorkspace(workspaceId, workflowId)
    if (!existing.ok) return existing

    // Em test mode usamos o DRAFT (preview); senão, a versão ACTIVE.
    const versionResult = dto.test
      ? await CrmWorkflowVersionRepository.findDraft(workflowId)
      : await CrmWorkflowVersionRepository.findActive(workflowId)
    if (!versionResult.ok) return versionResult
    if (!versionResult.value) return err(crmWorkflowVersionNotFound())

    const created = await CrmWorkflowRunRepository.create({
      workflowId,
      versionId: versionResult.value.id,
      triggerType: triggerTypeToPrisma('launch-manually'),
      triggerPayload: (dto.payload ?? {}) as object,
      startedById: actorId,
    })
    if (!created.ok) return created

    try {
      await runCrmWorkflow({
        runId: created.value.id,
        workspaceId,
        actingUserId: actorId,
        definition: parseCrmWorkflowDefinition(versionResult.value.definition),
        triggerType: 'launch-manually',
        triggerPayload: dto.payload,
        testMode: dto.test,
      })
    } catch (cause) {
      return err(
        crmWorkflowExecutionFailed('Falha ao executar o workflow', {
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      )
    }

    const reloaded = await CrmWorkflowRunRepository.findById(created.value.id)
    if (!reloaded.ok) return reloaded
    if (!reloaded.value) return err(crmWorkflowNotFound())
    return ok(toCrmWorkflowRunDTO(reloaded.value))
  },

  /**
   * Retoma um run pausado em um form. Encontra o step waiting, busca o node
   * correspondente na versão usada pelo run, e chama `resumeCrmWorkflow` com
   * o scope persistido em `run.state`.
   */
  async resumeRun(
    actorId: string,
    workspaceId: string,
    workflowId: string,
    runId: string,
    dto: ResumeCrmWorkflowRunDTO,
  ): Promise<Result<CrmWorkflowRunDTO>> {
    const membership = await assertModuleMember(actorId, workspaceId, 'CRM', {
      resource: 'workflows',
      action: 'EDIT',
    })
    if (!membership.ok) return membership

    const existing = await loadInWorkspace(workspaceId, workflowId)
    if (!existing.ok) return existing

    const runFound = await CrmWorkflowRunRepository.findById(runId)
    if (!runFound.ok) return runFound
    if (!runFound.value || runFound.value.workflowId !== workflowId) {
      return err(crmWorkflowNotFound())
    }
    const run = runFound.value
    if (run.status !== 'WAITING' || !run.waitingStepId || !run.state) {
      return err(
        crmWorkflowExecutionFailed('A execução não está aguardando resposta'),
      )
    }
    const waitingStep = run.steps.find((s) => s.id === run.waitingStepId)
    if (!waitingStep) {
      return err(crmWorkflowExecutionFailed('Etapa pausada não encontrada'))
    }

    const versionFound = await CrmWorkflowVersionRepository.findById(
      run.versionId,
    )
    if (!versionFound.ok) return versionFound
    if (!versionFound.value) return err(crmWorkflowVersionNotFound())

    const definition = parseCrmWorkflowDefinition(versionFound.value.definition)
    const pausedNode = definition.nodes.find((n) => n.id === waitingStep.nodeId)
    if (pausedNode?.data.type !== 'form') {
      return err(crmWorkflowExecutionFailed('Etapa pausada inválida'))
    }
    const outputAlias = pausedNode.data.outputAlias ?? pausedNode.id

    try {
      await resumeCrmWorkflow({
        runId: run.id,
        workspaceId,
        actingUserId: actorId,
        definition,
        triggerType: 'launch-manually',
        triggerPayload: run.triggerPayload,
        waitingStepId: run.waitingStepId,
        pausedNodeId: pausedNode.id,
        scope: run.state as Record<string, unknown>,
        submission: dto.payload,
        outputAlias,
      })
    } catch (cause) {
      return err(
        crmWorkflowExecutionFailed('Falha ao retomar o workflow', {
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      )
    }

    const reloaded = await CrmWorkflowRunRepository.findById(run.id)
    if (!reloaded.ok) return reloaded
    if (!reloaded.value) return err(crmWorkflowNotFound())
    return ok(toCrmWorkflowRunDTO(reloaded.value))
  },

  /**
   * Disparo pelo endpoint público `/api/crm/workflows/webhook/<token>`. Sem
   * auth — a posse vem do próprio token. Roda contra a versão ACTIVE.
   */
  async triggerWebhook(
    token: string,
    payload: unknown,
  ): Promise<Result<CrmWorkflowRunDTO>> {
    const match = await CrmWorkflowRepository.findActiveByWebhookToken(token)
    if (!match.ok) return match
    if (!match.value?.activeVersion) {
      return err(crmWorkflowWebhookInvalid())
    }
    const wf = match.value

    // Rota pública: sem sessão, mas o módulo precisa estar habilitado.
    const moduleEnabled = await assertModuleEnabled(wf.workspaceId, 'CRM')
    if (!moduleEnabled.ok) return moduleEnabled
    const version = match.value.activeVersion
    const created = await CrmWorkflowRunRepository.create({
      workflowId: wf.id,
      versionId: version.id,
      triggerType: triggerTypeToPrisma('webhook'),
      triggerPayload: (payload ?? {}) as object,
      startedById: null,
    })
    if (!created.ok) return created

    try {
      await runCrmWorkflow({
        runId: created.value.id,
        workspaceId: wf.workspaceId,
        actingUserId: wf.createdById,
        definition: parseCrmWorkflowDefinition(version.definition),
        triggerType: 'webhook',
        triggerPayload: payload,
        testMode: false,
      })
    } catch (cause) {
      return err(
        crmWorkflowExecutionFailed('Falha ao executar o workflow', {
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      )
    }
    const reloaded = await CrmWorkflowRunRepository.findById(created.value.id)
    if (!reloaded.ok) return reloaded
    if (!reloaded.value) return err(crmWorkflowNotFound())
    return ok(toCrmWorkflowRunDTO(reloaded.value))
  },
}
