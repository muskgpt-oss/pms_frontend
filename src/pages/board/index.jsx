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

export default function BoardPage({
  selectedProjectId,
  onOpenIssue,
  searchTerm = '',
  onRequestCreate,
  onGoBacklog,
  onBoardModeChange,
  currentProjectRole = 'lead',
}) {
  const queryClient = useQueryClient()
  const [boardMode, setBoardMode] = useState('kanban')
  const [draggedIssueId, setDraggedIssueId] = useState('')
  const [newColumnName, setNewColumnName] = useState('')
  const [showNewColumnInput, setShowNewColumnInput] = useState(false)
  const [columnError, setColumnError] = useState('')
  const [draggedColumnStatusId, setDraggedColumnStatusId] = useState('')

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
        if (!searchTerm) return true
        const target = `${issue.issue_key} ${issue.title} ${issue.description || ''}`.toLowerCase()
        return target.includes(searchTerm)
      }),
    }))
  }, [board?.columns, boardMode, issues, searchTerm, states])

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
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="text-sm font-medium text-slate-800">
          {boardMode === 'scrum'
            ? `Scrum${board?.sprint ? ` - Active Sprint: ${board.sprint.name}` : ''}`
            : 'Kanban'}
          {boardMode === 'scrum' && board?.sprint && (
            <p className="mt-0.5 text-xs font-normal text-slate-600">{board.sprint.goal || 'No sprint goal set.'}</p>
          )}
        </div>
        <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-1 text-xs">
          <button
            type="button"
            className={`rounded px-3 py-1.5 ${boardMode === 'kanban' ? 'bg-blue-600 text-white' : 'text-slate-700'}`}
            onClick={() => setBoardMode('kanban')}
          >
            Kanban
          </button>
          <button
            type="button"
            className={`rounded px-3 py-1.5 ${boardMode === 'scrum' ? 'bg-blue-600 text-white' : 'text-slate-700'}`}
            onClick={() => setBoardMode('scrum')}
          >
            Scrum
          </button>
        </div>
      </div>

      {(columnError || createColumnMutation.error) && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-xs text-red-700">{columnError || getApiErrorMessage(createColumnMutation.error)}</p>
        </div>
      )}

      {isScrumWithoutSprint && (
        <div className="mb-4 rounded-lg border border-slate-300 bg-white p-4">
          <p className="text-sm font-semibold text-slate-800">No active sprint</p>
          <p className="mt-1 text-sm text-slate-700">Scrum board is available after you create and start a sprint from Backlog.</p>
          <button
            type="button"
            className="mt-3 rounded border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-800 hover:border-blue-500 hover:text-blue-700"
            onClick={() => onGoBacklog?.()}
          >
            Go to Backlog
          </button>
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto pb-2">
        {boardColumns.map((column) => (
          <BoardColumn
            key={column.id}
            columnId={column.id}
            className="min-w-[270px] max-w-[290px] flex-shrink-0"
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
                <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
                  <p className="text-sm font-medium text-slate-800">Get started in Backlog</p>
                  <p className="mt-1 text-xs text-slate-600">Create work items and start a sprint to use Scrum board.</p>
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

        {canManageWorkflow && (
          <div className="min-w-[220px] flex-shrink-0 rounded-xl border border-blue-400/60 bg-[#0f172a] p-4 shadow-sm">
            {!showNewColumnInput ? (
              <button
                type="button"
                className="w-full rounded-lg border border-blue-500/60 bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500"
                onClick={() => {
                  setShowNewColumnInput(true)
                  setColumnError('')
                }}
              >
                + Create Column
              </button>
            ) : (
              <div className="space-y-2">
                <input
                  className="w-full rounded-lg border border-slate-500 bg-[#0b1220] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400"
                  placeholder="Column name"
                  value={newColumnName}
                  onChange={(event) => {
                    setNewColumnName(event.target.value)
                    setColumnError('')
                  }}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
                    onClick={createColumn}
                    disabled={createColumnMutation.isPending}
                  >
                    {createColumnMutation.isPending ? 'Creating...' : 'Add'}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-slate-500 bg-[#111827] px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
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
