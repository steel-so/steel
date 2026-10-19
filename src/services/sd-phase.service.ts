import type { SdTicketType } from '@prisma/client'
import { sdConfigConflict, sdPhaseNotFound } from '@/src/errors'
import { err, ok, type Result } from '@/src/lib/result'
import {
  toSdPhaseDTO,
  toSdPhaseTransitionDTO,
} from '@/src/mappers/sd-phase.mapper'
import { SdPhaseRepository } from '@/src/repositories/sd-phase.repository'
import type {
  CreateSdPhaseDTO,
  ListSdPhasesDTO,
  SaveSdPhaseTransitionsDTO,
  UpdateSdPhaseDTO,
} from '@/src/schemas/sd-phase.schema'
import type { SdPhaseDTO, SdPhaseTransitionDTO } from '@/types/sd-config'
import { SdAccess } from './sd-access'
import { assertSdRefs, sdAdminMutation } from './sd-config-support'

const INITIAL_REQUIRED =
  'Cada tipo precisa de uma fase inicial ativa: marque outra como inicial antes'

export const SdPhaseService = {
  async list(
    actorId: string,
    workspaceId: string,
    filters: ListSdPhasesDTO = { includeInactive: false },
  ): Promise<Result<SdPhaseDTO[]>> {
    const ctx = await SdAccess.resolve(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const rows = await SdPhaseRepository.list(workspaceId, filters)
    if (!rows.ok) return rows
    return ok(rows.value.map(toSdPhaseDTO))
  },

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateSdPhaseDTO,
  ): Promise<Result<SdPhaseDTO>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_phase',
      action: 'create',
      targetId: (value) => value.id,
      meta: { ticketType: dto.ticketType },
      run: async () => {
        const initials = await SdPhaseRepository.countInitial(
          workspaceId,
          dto.ticketType,
        )
        if (!initials.ok) return initials
        // A primeira fase do tipo vira a inicial.
        const isInitial = dto.isInitial || initials.value === 0
        if (isInitial && !dto.active) {
          return err(sdConfigConflict('A fase inicial precisa estar ativa'))
        }
        const created = await SdPhaseRepository.create(workspaceId, {
          ...dto,
          isInitial,
        })
        if (!created.ok) return created
        return ok(toSdPhaseDTO(created.value))
      },
    })
  },

  async update(
    actorId: string,
    workspaceId: string,
    phaseId: string,
    dto: UpdateSdPhaseDTO,
  ): Promise<Result<SdPhaseDTO>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_phase',
      action: 'update',
      targetId: phaseId,
      meta: { fields: Object.keys(dto) },
      run: async () => {
        const existing = await SdPhaseRepository.findById(phaseId, workspaceId)
        if (!existing.ok) return existing
        if (existing.value.isInitial && dto.isInitial === false) {
          return err(sdConfigConflict(INITIAL_REQUIRED))
        }
        const willBeInitial = dto.isInitial ?? existing.value.isInitial
        const willBeActive = dto.active ?? existing.value.active
        if (willBeInitial && !willBeActive) {
          return err(sdConfigConflict('A fase inicial precisa estar ativa'))
        }
        const updated = await SdPhaseRepository.update(
          phaseId,
          workspaceId,
          dto,
        )
        if (!updated.ok) return updated
        return ok(toSdPhaseDTO(updated.value))
      },
    })
  },

  /** Exclui só fases sem chamados (as demais: desative). */
  async remove(
    actorId: string,
    workspaceId: string,
    phaseId: string,
  ): Promise<Result<void>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_phase',
      action: 'delete',
      targetId: phaseId,
      run: async () => {
        const existing = await SdPhaseRepository.findById(phaseId, workspaceId)
        if (!existing.ok) return existing
        if (existing.value.isInitial) {
          return err(sdConfigConflict(INITIAL_REQUIRED))
        }
        const tickets = await SdPhaseRepository.countTickets(phaseId)
        if (!tickets.ok) return tickets
        if (tickets.value > 0) {
          return err(
            sdConfigConflict(
              'Há chamados nesta fase: desative-a em vez de excluir',
            ),
          )
        }
        return SdPhaseRepository.delete(phaseId, workspaceId)
      },
    })
  },

  async reorder(
    actorId: string,
    workspaceId: string,
    ticketType: SdTicketType,
    orderedIds: string[],
  ): Promise<Result<void>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_phase',
      action: 'update',
      meta: { ticketType, reorder: orderedIds.length },
      run: () => SdPhaseRepository.reorder(workspaceId, ticketType, orderedIds),
    })
  },

  /** Transitions of one ticket type, or of every type when omitted. */
  async listTransitions(
    actorId: string,
    workspaceId: string,
    ticketType?: SdTicketType,
  ): Promise<Result<SdPhaseTransitionDTO[]>> {
    const ctx = await SdAccess.resolve(actorId, workspaceId)
    if (!ctx.ok) return ctx
    const rows = await SdPhaseRepository.listTransitions(
      workspaceId,
      ticketType,
    )
    if (!rows.ok) return rows
    return ok(rows.value.map(toSdPhaseTransitionDTO))
  },

  /**
   * Salva a matriz inteira de transições do tipo. As fases precisam ser do
   * mesmo tipo e da workspace; lista vazia volta ao fluxo livre.
   */
  async saveTransitions(
    actorId: string,
    workspaceId: string,
    ticketType: SdTicketType,
    dto: SaveSdPhaseTransitionsDTO,
  ): Promise<Result<SdPhaseTransitionDTO[]>> {
    return sdAdminMutation({
      actorId,
      workspaceId,
      entity: 'sd_phase_transition',
      action: 'update',
      targetId: workspaceId,
      meta: { ticketType, transitions: dto.transitions.length },
      run: async () => {
        const phases = await SdPhaseRepository.list(workspaceId, {
          ticketType,
          includeInactive: true,
        })
        if (!phases.ok) return phases
        const ids = new Set(phases.value.map((p) => p.id))
        const foreign = dto.transitions.find(
          (t) => !ids.has(t.fromPhaseId) || !ids.has(t.toPhaseId),
        )
        if (foreign) return err(sdPhaseNotFound())

        const refs = await assertSdRefs(workspaceId, {
          departmentIds: dto.transitions.flatMap((t) => t.allowedDepartmentIds),
        })
        if (!refs.ok) return refs

        const saved = await SdPhaseRepository.saveTransitions(
          workspaceId,
          ticketType,
          dto.transitions,
        )
        if (!saved.ok) return saved
        return ok(saved.value.map(toSdPhaseTransitionDTO))
      },
    })
  },
}
