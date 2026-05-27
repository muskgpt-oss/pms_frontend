import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import BoardColumn from './components/BoardColumn'
import { fetchBoard, fetchProjectIssues, fetchWorkflow, updateWorkflow } from '../../services/projectApi'
import { archiveIssue, deleteIssueHard, transitionIssue } from '../../services/issueApi'
import { getApiErrorMessage } from '../../services/apiClient'

const normalize = (value) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')

const toColumnId = (value) => normalize(value).replace(/[^a-z0-9_]/g, '').replace(/^_+|_+$/g, '')

const orderWorkflowStates = (states = []) => {
  const backlog = states.find((state) => normalize(state.id) === 'backlog')
  const done = states.find((state) => normalize(state.category) === 'done')
  const ordered = [...states].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

  const middle = ordered.filter((state) => state.id !== backlog?.id && state.id !== done?.id)
  const final = [
    ...(backlog ? [backlog] : []),
    ...middle,
    ...(done ? [done] : []),
  ]

  return final.map((state, index) => ({ ...state, position: index }))
}

const resolveStateByCategory = (states = [], category) => {
  const byCategory = states.filter((state) => normalize(state.category) === normalize(category))
  if (byCategory.length === 0) return null
  return [...byCategory].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]
}

const resolveIssueStatusToStateId = (status, states = []) => {
  const statusKey = normalize(status)
  const direct = states.find((state) => normalize(state.id) === statusKey || normalize(state.name) === statusKey)
  if (direct) return direct.id

  if (['done', 'closed', 'completed'].includes(statusKey)) {
    return resolveStateByCategory(states, 'done')?.id || states[0]?.id
  }
  if (['in_progress', 'doing', 'development', 'review', 'in_review', 'qa', 'testing', 'blocked'].includes(statusKey)) {
    return resolveStateByCategory(states, 'in_progress')?.id || states[0]?.id
  }
  return resolveStateByCategory(states, 'todo')?.id || states[0]?.id
}

const classifyStatus = (status, states = []) => {
  const key = normalize(status)
  const state = states.find((entry) => normalize(entry.id) === key)
  const stateName = normalize(state?.name)
  const stateCategory = normalize(state?.category)

  if (['done', 'closed', 'completed'].includes(key) || stateCategory === 'done') return 'done'
  if (
    ['in_review', 'review', 'qa', 'testing'].includes(key)
    || stateName.includes('review')
  ) {
    return 'in_review'
  }
  if (
    ['in_progress', 'doing', 'development'].includes(key)
    || stateCategory === 'in_progress'
    || stateName.includes('progress')
  ) {
    return 'in_progress'
  }
  return 'todo'
}

const resolveStateForColumn = (columnId, states = []) => {
  const normalizedColumn = normalize(columnId)
  const candidatesByColumn = {
    todo: ['selected_for_development', 'to_do', 'todo', 'backlog'],
    in_progress: ['in_progress', 'doing'],
    in_review: ['in_review', 'review'],
    done: ['done', 'closed'],
  }

  const candidates = candidatesByColumn[normalizedColumn] || []
  const normalizedCandidates = new Set(candidates.map((entry) => normalize(entry)))
  const direct = states.find((state) => normalizedCandidates.has(normalize(state.id)) || normalizedCandidates.has(normalize(state.name)))
  if (direct) return direct.id

  if (normalizedColumn === 'done') {
    const doneState = states.find((state) => normalize(state.category) === 'done')
    if (doneState) return doneState.id
  }

  if (normalizedColumn === 'in_review') {
    const reviewState = states.find((state) => normalize(state.category) === 'in_progress' && normalize(state.name).includes('review'))
    if (reviewState) return reviewState.id
  }

  if (normalizedColumn === 'in_progress') {
    const progressState = states.find((state) => normalize(state.category) === 'in_progress' && !normalize(state.name).includes('review'))
    if (progressState) return progressState.id
  }

  if (normalizedColumn === 'todo') {
    const todoState = states.find((state) => normalize(state.category) === 'todo' && normalize(state.id) !== 'backlog')
      || states.find((state) => normalize(state.category) === 'todo')
    if (todoState) return todoState.id
  }

  return columnId
}

const getIssueBoardSource = (issue) => {
  const labels = Array.isArray(issue?.labels) ? issue.labels.map((entry) => String(entry).toLowerCase()) : []
  if (labels.includes('board:scrum')) return 'scrum'
  if (labels.includes('board:kanban')) return 'kanban'

  const description = String(issue?.description || '')
  const match = description.match(/board\s*source\s*[:=-]\s*(kanban|scrum)/i)
  if (match?.[1]) return match[1].toLowerCase()
  return ''
}

const getDisplayColumnTitle = (state, position) => {
  const stateId = normalize(state?.id)
  const stateName = String(state?.name || '').trim()
  const stateCategory = normalize(state?.category)
  const isTodoAlias = ['selected_for_development', 'todo', 'to_do', 'backlog'].includes(stateId)
  if (position === 0 || (stateCategory === 'todo' && isTodoAlias)) return 'To Do'
  return stateName || state?.id || 'Column'
}

const getInitials = (name) => {
  if (!name || name.toLowerCase() === 'unassigned') return '?'
  const parts = name.split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

const getAvatarColorClass = (name) => {
  if (!name || name.toLowerCase() === 'unassigned') return 'bg-slate-800 text-slate-400 border-slate-700'
  const colors = [
    'bg-blue-655 text-white border-blue-500/50',
    'bg-emerald-655 text-white border-emerald-500/50',
    'bg-indigo-655 text-white border-indigo-500/50',
    'bg-violet-655 text-white border-violet-500/50',
    'bg-amber-655 text-white border-amber-500/50',
    'bg-rose-655 text-white border-rose-500/50',
    'bg-cyan-655 text-white border-cyan-500/50',
  ]
  let sum = 0
  for (let i = 0; i < name.length; i++) {
    sum += name.charCodeAt(i)
  }
  return colors[sum % colors.length]
}

export default function BoardPage({
  selectedProjectId,
  onOpenIssue,
  searchTerm = '',
  onRequestCreate,
  onGoBacklog,
  onBoardModeChange,
  currentProjectRole = 'lead',
  projectMembers = [],
}) {
  const queryClient = useQueryClient()
  const [boardMode, setBoardMode] = useState('kanban')
  const [draggedIssueId, setDraggedIssueId] = useState('')
  const [newColumnName, setNewColumnName] = useState('')
  const [showNewColumnInput, setShowNewColumnInput] = useState(false)
  const [columnError, setColumnError] = useState('')
  const [draggedColumnStatusId, setDraggedColumnStatusId] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('')

  const normalizedRole = normalize(currentProjectRole)
  const canManageWorkflow = normalizedRole === 'lead' || normalizedRole === 'developer' || normalizedRole === 'restricted'
  const canManageIssues = normalizedRole === 'lead' || normalizedRole === 'developer'
  const canTransitionIssues = normalizedRole === 'lead' || normalizedRole === 'developer' || normalizedRole === 'restricted'
  const canCreateIssues = normalizedRole === 'lead' || normalizedRole === 'developer'

  useEffect(() => {
    onBoardModeChange?.(boardMode)
  }, [boardMode, onBoardModeChange])

  const { data: board, isLoading, error } = useQuery({
    queryKey: ['board', selectedProjectId],
    queryFn: () => fetchBoard({ projectId: selectedProjectId }),
    enabled: Boolean(selectedProjectId),
  })

  const workflowQuery = useQuery({
    queryKey: ['workflow', selectedProjectId],
    queryFn: () => fetchWorkflow({ projectId: selectedProjectId }),
    enabled: Boolean(selectedProjectId),
  })

  const { data: issues = [], isLoading: isIssuesLoading, error: issuesError } = useQuery({
    queryKey: ['issues', selectedProjectId, 'kanban-board'],
    queryFn: () => fetchProjectIssues({ projectId: selectedProjectId }),
    enabled: Boolean(selectedProjectId) && boardMode === 'kanban',
  })

  const updateIssueMutation = useMutation({
    mutationFn: transitionIssue,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board', selectedProjectId] })
      queryClient.invalidateQueries({ queryKey: ['backlog', selectedProjectId] })
      queryClient.invalidateQueries({ queryKey: ['issues', selectedProjectId, 'kanban-board'] })
      queryClient.invalidateQueries({ queryKey: ['issues', selectedProjectId] })
    },
  })

  const archiveIssueMutation = useMutation({
    mutationFn: archiveIssue,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board', selectedProjectId] })
      queryClient.invalidateQueries({ queryKey: ['issues', selectedProjectId, 'kanban-board'] })
      queryClient.invalidateQueries({ queryKey: ['issues', selectedProjectId] })
    },
  })

  const deleteIssueMutation = useMutation({
    mutationFn: deleteIssueHard,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board', selectedProjectId] })
      queryClient.invalidateQueries({ queryKey: ['issues', selectedProjectId, 'kanban-board'] })
      queryClient.invalidateQueries({ queryKey: ['issues', selectedProjectId] })
    },
  })

  const createColumnMutation = useMutation({
    mutationFn: updateWorkflow,
    onSuccess: () => {
      setNewColumnName('')
      setShowNewColumnInput(false)
      setColumnError('')
      queryClient.invalidateQueries({ queryKey: ['workflow', selectedProjectId] })
      queryClient.invalidateQueries({ queryKey: ['board', selectedProjectId] })
      queryClient.invalidateQueries({ queryKey: ['issues', selectedProjectId, 'kanban-board'] })
      queryClient.invalidateQueries({ queryKey: ['issues', selectedProjectId] })
    },
  })

  const states = board?.states || []

  const boardColumns = useMemo(() => {
    const displayedColumns = [...states]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((state, index) => ({ key: state.id, title: getDisplayColumnTitle(state, index), state }))

    const grouped = displayedColumns.reduce((acc, column) => {
      acc[column.state.id] = []
      return acc
    }, {})

    const sourceIssues = boardMode === 'scrum'
      ? Object.values(board?.columns || {}).flat()
      : (issues || []).filter((issue) => getIssueBoardSource(issue) !== 'scrum')

    sourceIssues.forEach((issue) => {
      const stateId = resolveIssueStatusToStateId(issue.status, states)
      if (!stateId || !grouped[stateId]) return
      grouped[stateId].push(issue)
    })

    return displayedColumns.map((column) => ({
      id: column.key,
      title: column.title,
      category: column.state.category,
      statusId: column.state.id,
      issues: (grouped[column.state.id] || []).filter((issue) => {
        if (assigneeFilter && issue.assignee !== assigneeFilter) return false
        if (!searchTerm) return true
        const target = `${issue.issue_key} ${issue.title} ${issue.description || ''}`.toLowerCase()
        return target.includes(searchTerm)
      }),
    }))
  }, [board?.columns, boardMode, issues, searchTerm, states, assigneeFilter])

  const statusOptions = boardColumns.map((column) => ({
    value: column.statusId,
    label: column.title,
  }))

  const saveWorkflow = ({ nextStates, nextTransitions }) => {
    createColumnMutation.mutate({
      projectId: selectedProjectId,
      payload: {
        states: nextStates,
        transitions: (nextTransitions || []).map((transition, index) => ({ ...transition, position: index })),
      },
    })
  }

  const reorderColumns = (targetStatusId, sourceStatusId = '') => {
    const activeSource = sourceStatusId || draggedColumnStatusId
    if (!canManageWorkflow || !activeSource || !targetStatusId || activeSource === targetStatusId) return

    const workflow = workflowQuery.data
    if (!workflow) {
      setColumnError('Workflow unavailable. Try again.')
      return
    }

    const orderedStates = orderWorkflowStates(workflow.states || [])
    const boardStates = orderedStates.filter((state) => normalize(state.id) !== 'backlog')
    const doneState = boardStates.find((state) => normalize(state.category) === 'done')

    if (activeSource === doneState?.id || targetStatusId === doneState?.id) {
      setColumnError('Done is locked as the final step and cannot be reordered.')
      return
    }

    const movableIds = boardStates.filter((state) => state.id !== doneState?.id).map((state) => state.id)
    const fromIndex = movableIds.indexOf(activeSource)
    const toIndex = movableIds.indexOf(targetStatusId)
    if (fromIndex < 0 || toIndex < 0) return

    const reordered = [...movableIds]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    const boardOrder = doneState ? [...reordered, doneState.id] : reordered

    const finalOrder = [
      ...orderedStates.filter((state) => normalize(state.id) === 'backlog').map((state) => state.id),
      ...boardOrder,
    ]
    const positionById = Object.fromEntries(finalOrder.map((id, index) => [id, index]))
    const nextStates = (workflow.states || []).map((state) => ({
      ...state,
      position: positionById[state.id] ?? state.position ?? 0,
    }))

    setColumnError('')
    saveWorkflow({ nextStates, nextTransitions: workflow.transitions || [] })
  }

  const deleteColumn = (statusId) => {
    if (!canManageWorkflow) return

    const workflow = workflowQuery.data
    if (!workflow) {
      setColumnError('Workflow unavailable. Try again.')
      return
    }

    const targetState = (workflow.states || []).find((state) => state.id === statusId)
    if (!targetState) return
    if (normalize(targetState.id) === 'backlog') {
      setColumnError('Backlog cannot be deleted.')
      return
    }
    if (normalize(targetState.category) === 'done') {
      setColumnError('Done is required as the final workflow step and cannot be deleted.')
      return
    }

    const hasIssues = (boardColumns.find((column) => column.statusId === statusId)?.issues || []).length > 0
    if (hasIssues) {
      setColumnError('Move all issues out of this column before deleting it.')
      return
    }

    const nextStatesRaw = (workflow.states || []).filter((state) => state.id !== statusId)
    const nextStates = orderWorkflowStates(nextStatesRaw)
    const nextTransitions = (workflow.transitions || []).filter((transition) => {
      if (transition.to_state_id === statusId) return false
      return !(transition.from_state_ids || []).includes(statusId)
    })

    setColumnError('')
    saveWorkflow({ nextStates, nextTransitions })
  }

  const createColumn = () => {
    if (!canManageWorkflow) return

    const trimmed = newColumnName.trim()
    if (!trimmed) {
      setColumnError('Column name is required')
      return
    }

    const normalizedName = normalize(trimmed)
    const hasDuplicate = states.some((state) => normalize(state.name) === normalizedName || normalize(state.id) === normalizedName)
    if (hasDuplicate) {
      setColumnError('Column name already exists')
      return
    }

    const workflow = workflowQuery.data
    if (!workflow) {
      setColumnError('Workflow unavailable. Try again.')
      return
    }

    const stateId = toColumnId(trimmed)
    if (!stateId) {
      setColumnError('Invalid column name')
      return
    }

    const nextStates = orderWorkflowStates([
      ...(workflow.states || []),
      {
        id: stateId,
        name: trimmed,
        category: 'in_progress',
        color: '#475569',
        position: 999,
        is_initial: false,
      },
    ])

    const existingTransitionIds = new Set((workflow.transitions || []).map((transition) => transition.id))
    const nextTransitions = [...(workflow.transitions || [])]

    const doneState = nextStates.find((state) => normalize(state.category) === 'done')
    const nonDoneStates = nextStates.filter((state) => state.id !== stateId && state.id !== doneState?.id)

    const addTransition = (transition) => {
      if (existingTransitionIds.has(transition.id)) return
      existingTransitionIds.add(transition.id)
      nextTransitions.push({ ...transition, position: nextTransitions.length })
    }

    nonDoneStates.forEach((state) => {
      if (state.id === stateId) return
      addTransition({
        id: `${state.id}_to_${stateId}`,
        name: `Move ${state.name} to ${trimmed}`,
        from_state_ids: [state.id],
        to_state_id: stateId,
        conditions: [],
        post_functions: [],
      })
    })

    nonDoneStates.forEach((state) => {
      if (state.id === stateId) return
      addTransition({
        id: `${stateId}_to_${state.id}`,
        name: `Move ${trimmed} to ${state.name}`,
        from_state_ids: [stateId],
        to_state_id: state.id,
        conditions: [],
        post_functions: [],
      })
    })

    if (doneState?.id) {
      addTransition({
        id: `${stateId}_to_${doneState.id}`,
        name: `Move ${trimmed} to ${doneState.name}`,
        from_state_ids: [stateId],
        to_state_id: doneState.id,
        conditions: [],
        post_functions: [],
      })
    }

    saveWorkflow({ nextStates, nextTransitions })
  }

  const isScrumWithoutSprint = boardMode === 'scrum' && !board?.sprint

  if (!selectedProjectId) {
    return <p className="rounded-lg border border-slate-300 bg-white p-4 text-sm text-slate-700">Select a project first.</p>
  }

  if (isLoading || (boardMode === 'kanban' && isIssuesLoading)) {
    return <p className="rounded-lg border border-slate-300 bg-white p-4 text-sm text-slate-700">Loading board...</p>
  }

  if (error || issuesError) {
    return <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">{getApiErrorMessage(error || issuesError)}</p>
  }

  return (
    <div className="space-y-6">
      {/* Board Header Actions & Toggles */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-brand-border pb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand-blue/10 border border-[#b3d4ff] flex items-center justify-center text-brand-blue">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18M15 3v18" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-bold text-brand-navy flex items-center gap-2">
              {boardMode === 'scrum' ? 'Scrum Board' : 'Kanban Board'}
              {boardMode === 'scrum' && board?.sprint && (
                <span className="rounded bg-[#deebff] border border-[#b3d4ff] text-brand-blue px-2.5 py-0.5 text-[10px] font-bold tracking-wide uppercase select-none">
                  Active Sprint
                </span>
              )}
            </h2>
            {boardMode === 'scrum' && board?.sprint ? (
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs font-semibold text-brand-navy">{board.sprint.name}</span>
                {board.sprint.goal && (
                  <>
                    <span className="text-slate-350 text-xs select-none">•</span>
                    <span className="text-xs text-brand-slate italic max-w-md truncate" title={board.sprint.goal}>
                      Goal: {board.sprint.goal}
                    </span>
                  </>
                )}
              </div>
            ) : (
              <p className="text-xs text-brand-slate mt-0.5">Manage and transition issues in this project's workspace.</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Board Search Box */}
          {searchTerm && (
            <div className="rounded bg-[#deebff] border border-[#b3d4ff] text-brand-blue px-2.5 py-1 text-[11px] font-semibold">
              Filter: "{searchTerm}"
            </div>
          )}

          {/* Mode Switcher */}
          <div className="inline-flex rounded border border-brand-border bg-white p-1 select-none shadow-xs">
            <button
              type="button"
              className={`rounded px-3.5 py-1.5 text-xs font-bold transition-all ${
                boardMode === 'kanban'
                  ? 'bg-brand-blue text-white shadow-sm'
                  : 'text-brand-slate hover:text-brand-navy'
              }`}
              onClick={() => setBoardMode('kanban')}
            >
              Kanban
            </button>
            <button
              type="button"
              className={`rounded px-3.5 py-1.5 text-xs font-bold transition-all ${
                boardMode === 'scrum'
                  ? 'bg-brand-blue text-white shadow-sm'
                  : 'text-brand-slate hover:text-brand-navy'
              }`}
              onClick={() => setBoardMode('scrum')}
            >
              Scrum
            </button>
          </div>
        </div>
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-4 bg-white p-3 rounded-lg border border-brand-border shadow-xs select-none">
        {/* Search filter indicator */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-brand-slate uppercase tracking-wider">Search Filter:</span>
          {searchTerm ? (
            <span className="rounded bg-[#deebff] border border-[#b3d4ff] text-brand-blue px-2 py-0.5 text-xs font-semibold">
              "{searchTerm}"
            </span>
          ) : (
            <span className="text-xs text-slate-400 italic">No search active</span>
          )}
        </div>

        {/* Assignee Filter group */}
        {projectMembers.length > 0 && (
          <div className="flex items-center gap-2 border-l border-brand-border pl-4">
            <span className="text-[10px] font-bold text-brand-slate uppercase tracking-wider mr-1">Assignees:</span>
            <div className="flex -space-x-1.5">
              {projectMembers.map((member) => {
                const isActive = assigneeFilter === member
                return (
                  <button
                    key={member}
                    type="button"
                    title={member}
                    onClick={() => setAssigneeFilter(isActive ? '' : member)}
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold border transition-all hover:scale-105 relative hover:z-10 cursor-pointer ${
                      isActive
                        ? 'border-brand-blue ring-2 ring-brand-blue/30 scale-105'
                        : 'border-brand-border hover:border-brand-slate'
                    } ${getAvatarColorClass(member)}`}
                  >
                    {getInitials(member)}
                  </button>
                )
              })}
            </div>
            {assigneeFilter && (
              <button
                type="button"
                className="text-[10px] font-bold text-brand-blue hover:text-brand-blue-hover ml-2 cursor-pointer transition-colors"
                onClick={() => setAssigneeFilter('')}
              >
                Clear filter
              </button>
            )}
          </div>
        )}
      </div>

      {/* Errors notifications */}
      {(columnError || createColumnMutation.error) && (
        <div className="rounded border border-rose-200 bg-rose-50 px-4 py-3 flex items-start gap-3 shadow-sm max-w-xl">
          <div className="text-rose-600 bg-rose-100 p-1.5 rounded border border-rose-200">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-semibold text-rose-800">Action Failed</p>
            <p className="text-[11px] text-rose-700 mt-0.5 leading-relaxed">
              {columnError || getApiErrorMessage(createColumnMutation.error)}
            </p>
          </div>
        </div>
      )}

      {/* Scrum Active Sprint Check */}
      {isScrumWithoutSprint && (
        <div className="rounded border border-amber-250 bg-amber-50/50 p-5 shadow-xs max-w-2xl">
          <div className="flex items-start gap-3.5">
            <div className="text-amber-700 bg-amber-100 p-2 rounded-lg border border-amber-200">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div>
              <h4 className="text-sm font-bold text-brand-navy">No Active Sprint</h4>
              <p className="mt-1.5 text-xs text-brand-slate leading-relaxed">
                The Scrum board is active only when there is an ongoing sprint. Go to the backlog to plan and start a sprint.
              </p>
              <button
                type="button"
                className="mt-4 btn-primary px-4 py-2"
                onClick={() => onGoBacklog?.()}
              >
                Go to Backlog
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Board Columns container */}
      <div className="flex gap-4 overflow-x-auto pb-6 select-none items-start">
        {boardColumns.map((column) => (
          <BoardColumn
            key={column.id}
            columnId={column.id}
            className="min-w-[280px] max-w-[300px] flex-shrink-0"
            title={column.title}
            issues={column.issues}
            allStates={states}
            statusOptions={statusOptions}
            onTransition={(issueId, status) => canTransitionIssues && updateIssueMutation.mutate({ issueId, status })}
            onOpenIssue={onOpenIssue}
            onCreateIssue={(statusId) => canCreateIssues && onRequestCreate?.(statusId, boardMode)}
            columnStatusId={column.statusId}
            draggedIssueId={draggedIssueId}
            onDragStart={(issueId) => setDraggedIssueId(issueId)}
            onDropIssue={(issueId, status) => canTransitionIssues && updateIssueMutation.mutate({ issueId, status })}
            onArchiveIssue={(issueId) => archiveIssueMutation.mutate({ issueId })}
            onDeleteIssue={(issueId) => deleteIssueMutation.mutate({ issueId })}
            showCreateButton={canCreateIssues}
            canTransitionIssues={canTransitionIssues}
            showIssueActions={canManageIssues}
            canManageColumn={canManageWorkflow}
            onDeleteColumn={deleteColumn}
            onColumnDragStart={(statusId) => {
              setDraggedColumnStatusId(statusId)
              setColumnError('')
            }}
            onColumnDrop={(statusId, sourceStatusId) => {
              reorderColumns(statusId, sourceStatusId)
              setDraggedColumnStatusId('')
            }}
            emptyContent={
              isScrumWithoutSprint && column.id === 'todo' ? (
                <div className="rounded border border-dashed border-brand-border bg-white p-4 text-center shadow-xs">
                  <p className="text-xs font-bold text-brand-navy">Start in Backlog</p>
                  <p className="mt-1 text-[10px] text-brand-slate leading-normal">Create issues and start a sprint to populate Scrum board.</p>
                </div>
              ) : null
            }
            onOpenIssueLink={(issueId) => {
              const link = `${window.location.origin}${window.location.pathname}?issue=${issueId}`
              window.open(link, '_blank')
            }}
            onCopyIssueLink={(issueId) => {
              const link = `${window.location.origin}${window.location.pathname}?issue=${issueId}`
              navigator.clipboard?.writeText(link)
            }}
          />
        ))}

        {/* Add Column Button */}
        {canManageWorkflow && (
          <div className="min-w-[240px] flex-shrink-0 rounded border border-brand-border bg-[#ebecf0]/50 p-3.5 shadow-xs transition-all duration-200">
            {!showNewColumnInput ? (
              <button
                type="button"
                className="w-full flex items-center justify-center gap-1.5 rounded border border-dashed border-[#a5adba] hover:border-brand-slate bg-white hover:bg-brand-hover py-2.5 text-xs font-bold text-brand-slate hover:text-brand-navy transition-all cursor-pointer shadow-xs"
                onClick={() => {
                  setShowNewColumnInput(true)
                  setColumnError('')
                }}
              >
                <svg className="w-3.5 h-3.5 text-brand-slate" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>Add Column</span>
              </button>
            ) : (
              <div className="space-y-2.5">
                <h4 className="text-[11px] font-bold text-brand-slate uppercase tracking-wider">New Column</h4>
                <input
                  className="w-full input-text"
                  placeholder="Column name"
                  value={newColumnName}
                  onChange={(event) => {
                    setNewColumnName(event.target.value)
                    setColumnError('')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createColumn()
                  }}
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-primary py-1 px-3"
                    onClick={createColumn}
                    disabled={createColumnMutation.isPending}
                  >
                    {createColumnMutation.isPending ? 'Adding...' : 'Add'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary py-1 px-3"
                    onClick={() => {
                      setShowNewColumnInput(false)
                      setNewColumnName('')
                      setColumnError('')
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
