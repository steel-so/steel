import type { z } from 'zod'
import { logger } from '@/lib/axiom/logger'
import {
  sdAiDisabled,
  sdConfigNotFound,
  sdNlConfigFailed,
  sdNlConfigInvalid,
} from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  buildNlConfigSystem,
  describeNlConfig,
  diffNlConfig,
  nlConfigRefIds,
  SD_NL_KIND_LABEL,
  type SdNlRefs,
} from '@/src/lib/servicedesk/nl-config'
import { SdConfigRepository } from '@/src/repositories/sd-config.repository'
import { parseSdAiJson } from '@/src/schemas/sd-ai.schema'
import {
  CreateSdAutomationRuleSchema,
  sdAutomationActionRefs,
} from '@/src/schemas/sd-automation-rule.schema'
import { CreateSdEscalationRuleSchema } from '@/src/schemas/sd-escalation-rule.schema'
import {
  SD_NL_CONFIG_JSON_SCHEMA,
  type SdNlConfigApplyDTO,
  type SdNlConfigKind,
  SdNlConfigModelOutputSchema,
  type SdNlConfigPreviewDTO,
} from '@/src/schemas/sd-nl-config.schema'
import { CreateSdSlaPolicySchema } from '@/src/schemas/sd-sla-policy.schema'
import type {
  SdNlConfigApplyResultDTO,
  SdNlConfigPreviewResultDTO,
} from '@/types/sd-nl-config'
import { AiUsageService } from './ai-usage.service'
import { SdAccess } from './sd-access'
import { SdAutomationRuleService } from './sd-automation-rule.service'
import { SdCalendarService } from './sd-calendar.service'
import { SdCategoryService } from './sd-category.service'
import { assertSdRefs, sdAdminMutation } from './sd-config-support'
import { SdDepartmentService } from './sd-department.service'
import { SdEscalationRuleService } from './sd-escalation-rule.service'
import { SdPhaseService } from './sd-phase.service'
import { SdPriorityService } from './sd-priority.service'
import { SdSettingsService } from './sd-settings.service'
import { SdSlaPolicyService } from './sd-sla-policy.service'

type Json = Record<string, unknown>

/** A configuração mais longa (automação com muitas ações) cabe aqui. */
const MAX_TOKENS = 2500

const CREATE_SCHEMAS = {
  SLA: CreateSdSlaPolicySchema,
  AUTOMATION: CreateSdAutomationRuleSchema,
  ESCALATION: CreateSdEscalationRuleSchema,
} as const

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  const path = issue.path.length > 0 ? ` (${issue.path.join('.')})` : ''
  return `${issue.message}${path}`
}

async function loadRefs(
  actorId: string,
  workspaceId: string,
): Promise<Result<SdNlRefs>> {
  const [priorities, calendars, departments, categories, phases, members] =
    await Promise.all([
      SdPriorityService.list(actorId, workspaceId, 'priority'),
      SdCalendarService.list(actorId, workspaceId),
      SdDepartmentService.list(actorId, workspaceId),
      SdCategoryService.list(actorId, workspaceId),
      SdPhaseService.list(actorId, workspaceId),
      SdConfigRepository.listWorkspaceMembers(workspaceId),
    ])
  if (!priorities.ok) return priorities
  if (!calendars.ok) return calendars
  if (!departments.ok) return departments
  if (!categories.ok) return categories
  if (!phases.ok) return phases
  if (!members.ok) return members
  const pick = (list: { id: string; name: string }[]) =>
    list.map(({ id, name }) => ({ id, name }))
  return ok({
    priorities: pick(priorities.value),
    calendars: pick(calendars.value),
    departments: pick(departments.value),
    categories: pick(categories.value),
    phases: pick(phases.value),
    users: members.value.map((m) => ({ id: m.user.id, name: m.user.name })),
  })
}

async function loadExisting(
  actorId: string,
  workspaceId: string,
  kind: SdNlConfigKind,
  targetId: string,
): Promise<Result<{ name: string; config: Json }>> {
  const list =
    kind === 'SLA'
      ? await SdSlaPolicyService.list(actorId, workspaceId)
      : kind === 'AUTOMATION'
        ? await SdAutomationRuleService.list(actorId, workspaceId)
        : await SdEscalationRuleService.list(actorId, workspaceId)
  if (!list.ok) return list
  const hit = (
    list.value as unknown as (Json & { id: string; name: string })[]
  ).find((r) => r.id === targetId)
  if (!hit) return err(sdConfigNotFound())
  return ok({ name: hit.name, config: hit })
}

/** Ids citados pela configuração precisam existir (tolerância zero a ids inventados). */
async function checkRefs(
  workspaceId: string,
  kind: SdNlConfigKind,
  config: Json,
): Promise<Result<true>> {
  const refs =
    kind === 'AUTOMATION'
      ? sdAutomationActionRefs(
          config.actions as Parameters<typeof sdAutomationActionRefs>[0],
        )
      : nlConfigRefIds(kind, config)
  const checked = await assertSdRefs(workspaceId, refs)
  if (checked.ok) return checked
  return err(
    sdNlConfigInvalid(
      `${checked.error.message}. Reescreva o pedido citando só itens que existem.`,
    ),
  )
}

export const SdNlConfigService = {
  /**
   * Monta a prévia de uma configuração descrita em texto. **Nunca salva.**
   * O modelo só vê o pedido e os nomes/ids de referência do workspace (nenhum
   * dado de chamado); a saída é validada com o schema de criação do tipo e
   * as referências conferidas antes de mostrar qualquer coisa. Usa a cota de
   * IA do ServiceDesk. Só admins.
   */
  async preview(
    actorId: string,
    workspaceId: string,
    dto: SdNlConfigPreviewDTO,
    now: Date = new Date(),
  ): Promise<Result<SdNlConfigPreviewResultDTO>> {
    const ctx = await SdAccess.requireAdmin(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const settings = await SdSettingsService.get(actorId, workspaceId)
    if (!settings.ok) return settings
    if (!settings.value.aiEnabled) return err(sdAiDisabled())

    const refs = await loadRefs(actorId, workspaceId)
    if (!refs.ok) return refs

    let existing: { name: string; config: Json } | null = null
    if (dto.targetId) {
      const loaded = await loadExisting(
        actorId,
        workspaceId,
        dto.kind,
        dto.targetId,
      )
      if (!loaded.ok) return loaded
      existing = loaded.value
    }

    const call = await AiUsageService.prepare(
      workspaceId,
      'SERVICEDESK_COPILOT',
      actorId,
    )
    if (!call.ok) return call

    let text: string
    try {
      const response = await call.value.provider.chat({
        model: call.value.model.model,
        system: buildNlConfigSystem({
          kind: dto.kind,
          refs: refs.value,
          existing: existing?.config ?? null,
          now,
        }),
        messages: [{ role: 'user', content: dto.text }],
        jsonSchema: {
          name: 'sd_nl_config',
          schema: SD_NL_CONFIG_JSON_SCHEMA,
        },
        maxTokens: MAX_TOKENS,
      })
      await AiUsageService.record(call.value, {
        workspaceId,
        userId: actorId,
        usage: response.usage,
        scope: { module: 'SERVICE_DESK' },
      })
      text = response.text
    } catch (error) {
      logger.error('servicedesk.nl_config.provider_failed', {
        component: 'SdNlConfigService',
        workspaceId,
        kind: dto.kind,
        provider: call.value.model.provider,
        model: call.value.model.model,
        message: error instanceof Error ? error.message : String(error),
      })
      return err(sdNlConfigFailed())
    }

    const output = parseSdAiJson(SdNlConfigModelOutputSchema, text)
    if (!output) {
      logger.warn('servicedesk.nl_config.invalid_output', {
        component: 'SdNlConfigService',
        workspaceId,
        kind: dto.kind,
      })
      return err(sdNlConfigFailed())
    }
    if (!output.understood) {
      return err(
        sdNlConfigInvalid(
          output.summary ||
            `Não entendi o pedido como uma ${SD_NL_KIND_LABEL[dto.kind]}. Descreva com mais detalhe.`,
        ),
      )
    }

    let raw: unknown
    try {
      raw = JSON.parse(output.configJson)
    } catch {
      return err(sdNlConfigFailed())
    }
    const parsed = CREATE_SCHEMAS[dto.kind].safeParse(raw)
    if (!parsed.success) {
      logger.warn('servicedesk.nl_config.schema_rejected', {
        component: 'SdNlConfigService',
        workspaceId,
        kind: dto.kind,
      })
      return err(
        sdNlConfigInvalid(
          `A configuração proposta não é válida: ${firstIssue(parsed.error)}. Reescreva o pedido com mais detalhes.`,
        ),
      )
    }
    const config = parsed.data as Json

    const refsOk = await checkRefs(workspaceId, dto.kind, config)
    if (!refsOk.ok) return refsOk

    logger.info('servicedesk.nl_config.preview', {
      component: 'SdNlConfigService',
      workspaceId,
      kind: dto.kind,
      mode: existing ? 'update' : 'create',
      textLength: dto.text.length,
      model: call.value.model.key,
    })

    return ok({
      kind: dto.kind,
      targetId: dto.targetId ?? null,
      targetName: existing?.name ?? null,
      mode: existing ? 'update' : 'create',
      summary: output.summary,
      warnings: output.warnings,
      config,
      lines: describeNlConfig(dto.kind, config, refs.value).map(
        (f) => `${f.label}: ${f.text}`,
      ),
      diff: existing
        ? diffNlConfig(dto.kind, existing.config, config, refs.value)
        : null,
    })
  },

  /**
   * Grava a configuração que o admin confirmou na prévia. O corpo já passou
   * pelo schema de criação; o service de cada tipo ainda confere as
   * referências e audita. Só admins.
   */
  async apply(
    actorId: string,
    workspaceId: string,
    dto: SdNlConfigApplyDTO,
  ): Promise<Result<SdNlConfigApplyResultDTO>> {
    const mode = dto.targetId ? 'update' : 'create'
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_nl_config',
      action: mode,
      targetId: (value) => value.id,
      meta: { kind: dto.kind },
      run: async () => {
        const saved = await save(actorId, workspaceId, dto)
        if (!saved.ok) return saved
        return ok({ kind: dto.kind, mode, ...saved.value })
      },
    })
  },
}

async function save(
  actorId: string,
  workspaceId: string,
  dto: SdNlConfigApplyDTO,
): Promise<Result<{ id: string; name: string }>> {
  const id = dto.targetId
  let saved: Result<{ id: string; name: string }>
  switch (dto.kind) {
    case 'SLA': {
      // Uma política padrão nunca perde o posto por um ajuste em texto.
      const { isDefault, ...rest } = dto.config
      saved = id
        ? await SdSlaPolicyService.update(actorId, workspaceId, id, {
            ...rest,
            ...(isDefault ? { isDefault } : {}),
          })
        : await SdSlaPolicyService.create(actorId, workspaceId, dto.config)
      break
    }
    case 'AUTOMATION':
      saved = id
        ? await SdAutomationRuleService.update(
            actorId,
            workspaceId,
            id,
            dto.config,
          )
        : await SdAutomationRuleService.create(actorId, workspaceId, dto.config)
      break
    case 'ESCALATION':
      saved = id
        ? await SdEscalationRuleService.update(
            actorId,
            workspaceId,
            id,
            dto.config,
          )
        : await SdEscalationRuleService.create(actorId, workspaceId, dto.config)
      break
  }
  if (!saved.ok) return saved
  return ok({ id: saved.value.id, name: saved.value.name })
}
