'use client'

import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Loading02Icon,
  PlusSignIcon,
} from '@hugeicons-pro/core-stroke-rounded'
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useRef, useState } from 'react'
import { SteelIcon } from '@/components/icon/icon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { notify } from '@/lib/notify'
import { cn } from '@/lib/utils'
import {
  createCrmResource,
  useCrmResourceList,
} from '@/src/hooks/use-crm-resource-list'
import type { CrmTaskDTO } from '@/types/crm-task'

type ViewMode = 'month' | 'week'

const STATUS_DOT: Record<string, string> = {
  TODO: 'bg-slate-400',
  IN_PROGRESS: 'bg-blue-500',
  DONE: 'bg-emerald-500',
}

const STATUS_CHIP: Record<string, string> = {
  TODO: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  IN_PROGRESS:
    'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  DONE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
}

const STATUS_LABEL: Record<string, string> = {
  TODO: 'A fazer',
  IN_PROGRESS: 'Em andamento',
  DONE: 'Concluído',
}

// ─── Feriados (nacionais + comemorativas, BR) ──────────────────────────────

function easterDate(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

type Holiday = { label: string; type: 'feriado' | 'comemorativa' }

function getHolidays(year: number): Map<string, Holiday> {
  const map = new Map<string, Holiday>()
  const easter = easterDate(year)

  function add(date: Date, label: string, type: Holiday['type'] = 'feriado') {
    map.set(format(date, 'yyyy-MM-dd'), { label, type })
  }
  function off(
    base: Date,
    days: number,
    label: string,
    type: Holiday['type'] = 'feriado',
  ) {
    add(addDays(base, days), label, type)
  }

  add(new Date(year, 0, 1), 'Confraternização Universal')
  add(new Date(year, 3, 21), 'Tiradentes')
  add(new Date(year, 4, 1), 'Dia do Trabalho')
  add(new Date(year, 8, 7), 'Independência do Brasil')
  add(new Date(year, 9, 12), 'Nossa Senhora Aparecida')
  add(new Date(year, 10, 2), 'Finados')
  add(new Date(year, 10, 15), 'Proclamação da República')
  add(new Date(year, 10, 20), 'Consciência Negra')
  add(new Date(year, 11, 25), 'Natal')

  off(easter, -48, 'Carnaval (2ª)', 'comemorativa')
  off(easter, -47, 'Carnaval', 'comemorativa')
  off(easter, -2, 'Sexta-feira Santa')
  add(easter, 'Páscoa')
  off(easter, 60, 'Corpus Christi')

  add(new Date(year, 4, 11), 'Dia das Mães', 'comemorativa')
  add(new Date(year, 5, 12), 'Dia dos Namorados', 'comemorativa')
  add(new Date(year, 5, 13), 'Santo Antônio', 'comemorativa')
  add(new Date(year, 5, 24), 'São João', 'comemorativa')
  add(new Date(year, 7, 12), 'Dia dos Pais', 'comemorativa')
  add(new Date(year, 9, 12), 'Dia das Crianças', 'comemorativa')
  add(new Date(year, 9, 31), 'Halloween', 'comemorativa')
  add(new Date(year, 11, 24), 'Véspera de Natal', 'comemorativa')
  add(new Date(year, 11, 31), 'Réveillon', 'comemorativa')

  return map
}

// ─── Quick-add dialog ───────────────────────────────────────────────────────

function QuickAddDialog({
  workspaceId,
  date,
  open,
  onClose,
  onAdded,
}: {
  workspaceId: string
  date: Date | null
  open: boolean
  onClose: () => void
  onAdded: () => void
}) {
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const dateLabel = date
    ? format(date, "EEEE, d 'de' MMMM", { locale: ptBR })
    : ''

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !date) return
    setSubmitting(true)
    const result = await createCrmResource(workspaceId, 'tasks', {
      title: title.trim(),
      status: 'TODO',
      dueDate: startOfDay(date).toISOString(),
    })
    setSubmitting(false)
    if (!result.ok) {
      notify.error(result.message ?? 'Erro ao criar tarefa')
      return
    }
    notify.success('Tarefa criada')
    setTitle('')
    onAdded()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setTitle('')
          onClose()
        }
      }}
    >
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle className='text-base'>Nova tarefa</DialogTitle>
        </DialogHeader>
        {date ? (
          <p className='-mt-1 text-muted-foreground text-sm capitalize'>
            {dateLabel}
          </p>
        ) : null}
        <form onSubmit={handleSubmit} className='flex flex-col gap-3'>
          <div className='grid gap-1.5'>
            <Label className='text-muted-foreground text-xs'>Título</Label>
            <Input
              ref={inputRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='Ex: Reunião de alinhamento'
              autoComplete='off'
            />
          </div>
          {title.trim() ? null : (
            <p className='text-muted-foreground text-xs'>
              Digite o título para poder criar a tarefa.
            </p>
          )}
          <div className='flex items-center justify-end gap-2 pt-1'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={onClose}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              type='submit'
              size='sm'
              disabled={!title.trim() || submitting}
            >
              {submitting ? 'Salvando…' : 'Criar tarefa'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Sub-componentes ────────────────────────────────────────────────────────

const WEEK_HEADER = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function TaskChip({ task }: { task: CrmTaskDTO }) {
  return (
    <div
      title={`${task.title} · ${STATUS_LABEL[task.status] ?? task.status}`}
      className={cn(
        'flex items-center gap-1 truncate rounded px-1.5 py-0.5 font-medium text-xs leading-tight',
        STATUS_CHIP[task.status] ?? 'bg-muted text-foreground',
      )}
    >
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          STATUS_DOT[task.status] ?? 'bg-muted-foreground',
        )}
      />
      <span className='truncate'>{task.title}</span>
    </div>
  )
}

function ViewSwitcher({
  view,
  onMonth,
  onWeek,
}: {
  view: ViewMode
  onMonth: () => void
  onWeek: () => void
}) {
  return (
    <div className='flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/30 p-0.5'>
      {(['month', 'week'] as const).map((v) => (
        <button
          key={v}
          type='button'
          onClick={v === 'month' ? onMonth : onWeek}
          className={cn(
            'rounded-md px-3 py-1 font-medium text-sm transition-colors',
            view === v
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {v === 'month' ? 'Mês' : 'Semana'}
        </button>
      ))}
    </div>
  )
}

function MonthCell({
  date,
  tasks,
  holiday,
  isCurrentMonth,
  onAdd,
}: {
  date: Date
  tasks: CrmTaskDTO[]
  holiday?: Holiday
  isCurrentMonth: boolean
  onAdd: (date: Date) => void
}) {
  const today = isToday(date)
  const maxVisible = 3
  const overflow = tasks.length - maxVisible

  return (
    <div
      className={cn(
        'group relative flex min-h-[90px] flex-col gap-0.5 border-border/30 border-r border-b p-1.5 last:border-r-0',
        !isCurrentMonth && 'bg-muted/10',
      )}
    >
      <div className='mb-0.5 flex items-center justify-between'>
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-full font-medium text-xs leading-none',
            today
              ? 'bg-primary font-semibold text-primary-foreground'
              : isCurrentMonth
                ? 'text-foreground'
                : 'text-muted-foreground/40',
          )}
        >
          {format(date, 'd')}
        </span>
        <div className='flex items-center gap-1'>
          {holiday ? (
            <span
              title={holiday.label}
              className={cn(
                'truncate rounded-full px-1 py-px font-medium text-[9px] leading-tight',
                holiday.type === 'feriado'
                  ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
              )}
            >
              {holiday.label.length > 10
                ? `${holiday.label.slice(0, 9)}…`
                : holiday.label}
            </span>
          ) : null}
          <button
            type='button'
            onClick={() => onAdd(date)}
            aria-label={`Adicionar tarefa em ${format(date, 'd MMM', { locale: ptBR })}`}
            className='flex size-5 items-center justify-center rounded-full opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100'
          >
            <SteelIcon
              icon={PlusSignIcon}
              strokeWidth={2}
              className='size-3 text-muted-foreground'
            />
          </button>
        </div>
      </div>

      {tasks.slice(0, maxVisible).map((task) => (
        <TaskChip key={task.id} task={task} />
      ))}
      {overflow > 0 ? (
        <span className='px-1 text-[10px] text-muted-foreground'>
          +{overflow} mais
        </span>
      ) : null}
    </div>
  )
}

function WeekColumn({
  date,
  tasks,
  holiday,
  onAdd,
}: {
  date: Date
  tasks: CrmTaskDTO[]
  holiday?: Holiday
  onAdd: (date: Date) => void
}) {
  const today = isToday(date)

  return (
    <div className='group flex flex-1 flex-col border-border/30 border-r last:border-r-0'>
      <div
        className={cn(
          'relative flex flex-col items-center gap-1 border-border/30 border-b py-2',
          today && 'bg-primary/5',
        )}
      >
        <span className='font-medium text-[11px] text-muted-foreground uppercase tracking-wide'>
          {format(date, 'EEE', { locale: ptBR })}
        </span>
        <span
          className={cn(
            'flex size-8 items-center justify-center rounded-full font-semibold text-base leading-none',
            today ? 'bg-primary text-primary-foreground' : 'text-foreground',
          )}
        >
          {format(date, 'd')}
        </span>
        {holiday ? (
          <span
            title={holiday.label}
            className={cn(
              'truncate rounded-full px-1.5 py-px font-medium text-[9px] leading-tight',
              holiday.type === 'feriado'
                ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
            )}
          >
            {holiday.label.length > 10
              ? `${holiday.label.slice(0, 9)}…`
              : holiday.label}
          </span>
        ) : null}
      </div>

      <div className='flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1.5'>
        {tasks.map((task) => (
          <TaskChip key={task.id} task={task} />
        ))}
        <button
          type='button'
          onClick={() => onAdd(date)}
          aria-label={`Adicionar tarefa em ${format(date, 'd MMM', { locale: ptBR })}`}
          className='mt-auto flex items-center justify-center gap-1 rounded-md py-1 text-muted-foreground text-xs opacity-0 transition-opacity hover:bg-muted/50 group-hover:opacity-100'
        >
          <SteelIcon icon={PlusSignIcon} strokeWidth={2} className='size-3' />
          Adicionar
        </button>
      </div>
    </div>
  )
}

// ─── Componente principal ───────────────────────────────────────────────────

export function CrmTasksCalendar({ workspaceId }: { workspaceId: string }) {
  const {
    items: tasks,
    isLoading,
    refetch,
  } = useCrmResourceList<CrmTaskDTO>(workspaceId, 'tasks')
  const [view, setView] = useState<ViewMode>('month')
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [addDate, setAddDate] = useState<Date | null>(null)

  const tasksByDay = new Map<string, CrmTaskDTO[]>()
  for (const task of tasks) {
    if (!task.dueDate) continue
    const key = format(new Date(task.dueDate), 'yyyy-MM-dd')
    if (!tasksByDay.has(key)) tasksByDay.set(key, [])
    tasksByDay.get(key)?.push(task)
  }

  function goToday() {
    setAnchor(startOfDay(new Date()))
  }
  function openAdd(date: Date) {
    setAddDate(date)
  }
  function closeAdd() {
    setAddDate(null)
  }

  if (view === 'month') {
    const monthStart = startOfMonth(anchor)
    const monthEnd = endOfMonth(anchor)
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 })
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
    const days = eachDayOfInterval({ start: gridStart, end: gridEnd })
    const holidays = getHolidays(anchor.getFullYear())
    const title = format(anchor, 'MMMM yyyy', { locale: ptBR })

    return (
      <>
        <div className='flex h-full flex-col'>
          <div className='flex items-center gap-3 border-border/40 border-b px-4 py-2.5'>
            <Button variant='outline' size='sm' onClick={goToday}>
              Hoje
            </Button>
            <div className='flex items-center gap-0.5'>
              <Button
                variant='ghost'
                size='icon-sm'
                onClick={() => setAnchor(startOfMonth(addMonths(anchor, -1)))}
                aria-label='Mês anterior'
              >
                <SteelIcon icon={ArrowLeft01Icon} strokeWidth={2} />
              </Button>
              <Button
                variant='ghost'
                size='icon-sm'
                onClick={() => setAnchor(startOfMonth(addMonths(anchor, 1)))}
                aria-label='Próximo mês'
              >
                <SteelIcon icon={ArrowRight01Icon} strokeWidth={2} />
              </Button>
            </div>
            <h2 className='font-semibold capitalize'>{title}</h2>
            <div className='ml-auto'>
              <ViewSwitcher
                view='month'
                onMonth={() => setView('month')}
                onWeek={() => {
                  setView('week')
                  setAnchor(startOfWeek(anchor, { weekStartsOn: 0 }))
                }}
              />
            </div>
          </div>

          <div className='grid grid-cols-7 border-border/30 border-b bg-muted/20'>
            {WEEK_HEADER.map((d) => (
              <div
                key={d}
                className='py-2 text-center font-medium text-[11px] text-muted-foreground uppercase tracking-wide'
              >
                {d}
              </div>
            ))}
          </div>

          {isLoading ? (
            <div className='flex flex-1 items-center justify-center gap-2 text-muted-foreground'>
              <SteelIcon
                icon={Loading02Icon}
                strokeWidth={2}
                className='size-5 animate-spin'
              />
              <span className='text-sm'>Carregando tarefas…</span>
            </div>
          ) : (
            <div
              className='grid flex-1 grid-cols-7'
              style={{ gridAutoRows: 'minmax(90px, 1fr)' }}
            >
              {days.map((day) => {
                const key = format(day, 'yyyy-MM-dd')
                return (
                  <MonthCell
                    key={key}
                    date={day}
                    tasks={tasksByDay.get(key) ?? []}
                    holiday={holidays.get(key)}
                    isCurrentMonth={isSameMonth(day, anchor)}
                    onAdd={openAdd}
                  />
                )
              })}
            </div>
          )}
        </div>

        <QuickAddDialog
          workspaceId={workspaceId}
          date={addDate}
          open={addDate !== null}
          onClose={closeAdd}
          onAdded={() => {
            closeAdd()
            refetch()
          }}
        />
      </>
    )
  }

  const weekStart = startOfWeek(anchor, { weekStartsOn: 0 })
  const weekEnd = endOfWeek(anchor, { weekStartsOn: 0 })
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd })
  const holidays = getHolidays(anchor.getFullYear())
  const weekLabel = `${format(weekStart, 'd MMM', { locale: ptBR })} – ${format(weekEnd, 'd MMM yyyy', { locale: ptBR })}`

  return (
    <>
      <div className='flex h-full flex-col'>
        <div className='flex items-center gap-3 border-border/40 border-b px-4 py-2.5'>
          <Button variant='outline' size='sm' onClick={goToday}>
            Hoje
          </Button>
          <div className='flex items-center gap-0.5'>
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={() => setAnchor(addWeeks(anchor, -1))}
              aria-label='Semana anterior'
            >
              <SteelIcon icon={ArrowLeft01Icon} strokeWidth={2} />
            </Button>
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={() => setAnchor(addWeeks(anchor, 1))}
              aria-label='Próxima semana'
            >
              <SteelIcon icon={ArrowRight01Icon} strokeWidth={2} />
            </Button>
          </div>
          <h2 className='font-semibold'>{weekLabel}</h2>
          <div className='ml-auto'>
            <ViewSwitcher
              view='week'
              onMonth={() => {
                setView('month')
                setAnchor(startOfMonth(anchor))
              }}
              onWeek={() => setView('week')}
            />
          </div>
        </div>

        {isLoading ? (
          <div className='flex flex-1 items-center justify-center gap-2 text-muted-foreground'>
            <SteelIcon
              icon={Loading02Icon}
              strokeWidth={2}
              className='size-5 animate-spin'
            />
            <span className='text-sm'>Carregando tarefas…</span>
          </div>
        ) : (
          <div className='flex min-h-0 flex-1 overflow-hidden border-border/30 border-b'>
            {weekDays.map((day) => {
              const key = format(day, 'yyyy-MM-dd')
              return (
                <WeekColumn
                  key={key}
                  date={day}
                  tasks={tasksByDay.get(key) ?? []}
                  holiday={holidays.get(key)}
                  onAdd={openAdd}
                />
              )
            })}
          </div>
        )}
      </div>

      <QuickAddDialog
        workspaceId={workspaceId}
        date={addDate}
        open={addDate !== null}
        onClose={closeAdd}
        onAdded={() => {
          closeAdd()
          refetch()
        }}
      />
    </>
  )
}
