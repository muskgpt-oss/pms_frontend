import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createIssue, createSprint, fetchBacklog, startSprint, completeSprint } from '../../services/projectApi'
import { assignIssueToSprint, removeIssueFromSprint, transitionIssue } from '../../services/issueApi'
import { getApiErrorMessage } from '../../services/apiClient'

const matchesFilters = (issue, filters) => {
  if (filters.q) {
    const target = `${issue.issue_key} ${issue.title} ${issue.description || ''}`.toLowerCase()
    if (!target.includes(filters.q.toLowerCase())) return false
  }
  if (filters.assignee && (issue.assignee || '') !== filters.assignee) return false
  if (filters.priority && issue.priority !== filters.priority) return false
  if (filters.issue_type && issue.issue_type !== filters.issue_type) return false
  if (filters.label && !(issue.labels || []).includes(filters.label)) return false
  return true
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

export default function BacklogPage({ selectedProjectId, onOpenIssue }) {
  const queryClient = useQueryClient()
  const [quickCreateTitle, setQuickCreateTitle] = useState('')
  const [newSprintName, setNewSprintName] = useState('')
  const [filters, setFilters] = useState({ q: '', assignee: '', priority: '', issue_type: '', label: '' })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setFilters({
      q: params.get('q') || '',
      assignee: params.get('assignee') || '',
      priority: params.get('priority') || '',
      issue_type: params.get('issue_type') || '',
      label: params.get('label') || '',
    })
  }, [selectedProjectId])

  const updateFilter = (key, value) => {
    const next = { ...filters, [key]: value }
    setFilters(next)
    const params = new URLSearchParams(window.location.search)
    Object.entries(next).forEach(([entryKey, entryValue]) => {
      if (entryValue) params.set(entryKey, entryValue)
      else params.delete(entryKey)
    })
    window.history.replaceState({ ...(window.history.state || {}) }, '', `${window.location.pathname}?${params.toString()}`)
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['backlog', selectedProjectId] })
    queryClient.invalidateQueries({ queryKey: ['board', selectedProjectId] })
    queryClient.invalidateQueries({ queryKey: ['issues', selectedProjectId] })
  }

  const { data: backlogData, isLoading, error } = useQuery({
    queryKey: ['backlog', selectedProjectId],
    queryFn: () => fetchBacklog(selectedProjectId),
    enabled: Boolean(selectedProjectId),
  })

  const backlogIssues = backlogData?.backlog ?? []
  const sprints = backlogData?.sprints ?? []
  const workflowStates = backlogData?.workflow_states ?? []

  const createIssueMutation = useMutation({
    mutationFn: createIssue,
    onSuccess: invalidate,
  })

  const createSprintMutation = useMutation({
    mutationFn: createSprint,
    onSuccess: invalidate,
  })

  const transitionIssueMutation = useMutation({
    mutationFn: transitionIssue,
    onSuccess: invalidate,
  })

  const assignIssueMutation = useMutation({
    mutationFn: assignIssueToSprint,
    onSuccess: invalidate,
  })

  const removeIssueMutation = useMutation({
    mutationFn: removeIssueFromSprint,
    onSuccess: invalidate,
  })

  const startSprintMutation = useMutation({
    mutationFn: startSprint,
    onSuccess: invalidate,
  })

  const completeSprintMutation = useMutation({
    mutationFn: completeSprint,
    onSuccess: invalidate,
  })

  const visibleBacklogIssues = useMemo(
    () => backlogIssues
      .filter((issue) => getIssueBoardSource(issue) === 'scrum')
      .filter((issue) => matchesFilters(issue, filters)),
    [backlogIssues, filters]
  )

  const visibleSprintIssues = useMemo(
    () =>
      sprints.map((sprint) => ({
        ...sprint,
        issues: (sprint.issues || [])
          .filter((issue) => getIssueBoardSource(issue) === 'scrum')
          .filter((issue) => matchesFilters(issue, filters)),
      })),
    [filters, sprints]
  )

  const quickCreate = () => {
    if (!quickCreateTitle.trim()) return
    const initialState = workflowStates.find((state) => state.is_initial)?.id || 'backlog'
    createIssueMutation.mutate({
      projectId: selectedProjectId,
      payload: {
        title: quickCreateTitle,
        description: 'Board source: scrum',
        status: initialState,
        labels: ['board:scrum'],
      },
    })
    setQuickCreateTitle('')
  }

  const createSprintQuick = () => {
    if (!newSprintName.trim()) return
    createSprintMutation.mutate({
      projectId: selectedProjectId,
      payload: { name: newSprintName.trim(), goal: '' },
    })
    setNewSprintName('')
  }

  if (!selectedProjectId) {
    return <p className="rounded bg-white p-4 text-sm text-slate-600 shadow-sm">Select a project first.</p>
  }

  if (error) {
    return <p className="rounded bg-white p-4 text-sm text-red-600 shadow-sm">{getApiErrorMessage(error)}</p>
  }

  return (
    <div className="rounded bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Backlog</h2>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className="w-full max-w-md rounded border border-slate-300 px-3 py-2 text-sm"
          value={filters.q}
          onChange={(event) => updateFilter('q', event.target.value)}
          placeholder="Search backlog"
        />
        <button type="button" className="rounded border border-slate-300 bg-slate-100 px-3 py-2 text-xs text-slate-700">Filter</button>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          className="w-full max-w-md rounded border border-slate-300 px-3 py-2 text-sm"
          value={quickCreateTitle}
          onChange={(event) => setQuickCreateTitle(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && quickCreate()}
          placeholder="Create work item"
        />
        <button className="rounded bg-slate-900 px-3 py-2 text-xs text-white" onClick={quickCreate}>
          Create
        </button>
      </div>

      <div className="mb-6 rounded border border-slate-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-800">Sprints</p>
          <div className="flex items-center gap-2">
            <input
              className="rounded border border-slate-300 px-2 py-1 text-sm"
              value={newSprintName}
              onChange={(event) => setNewSprintName(event.target.value)}
              placeholder="Sprint name"
            />
            <button
              className="rounded bg-slate-900 px-3 py-1.5 text-xs text-white"
              onClick={createSprintQuick}
              disabled={createSprintMutation.isPending}
            >
              {createSprintMutation.isPending ? 'Creating...' : 'Create sprint'}
            </button>
          </div>
        </div>

        <div className="mt-3 space-y-4">
          {visibleSprintIssues.map((sprint) => (
            <div key={sprint.id} className="rounded border border-slate-200">
              <div className="flex items-center justify-between bg-slate-50 px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{sprint.name}</p>
                  <p className="text-xs text-slate-500">{sprint.state.toUpperCase()} · {(sprint.issues || []).length} items</p>
                </div>
                <div className="flex gap-2">
                  {sprint.state !== 'active' && sprint.state !== 'completed' && (
                    <button
                      className="rounded bg-slate-800 px-3 py-1.5 text-xs text-white"
                      onClick={() => startSprintMutation.mutate({ projectId: selectedProjectId, sprintId: sprint.id })}
                    >
                      Start sprint
                    </button>
                  )}
                  {sprint.state === 'active' && (
                    <button
                      className="rounded bg-slate-900 px-3 py-1.5 text-xs text-white"
                      onClick={() => completeSprintMutation.mutate({ projectId: selectedProjectId, sprintId: sprint.id })}
                    >
                      Complete sprint
                    </button>
                  )}
                </div>
              </div>

              <div className="divide-y divide-slate-200">
                {(sprint.issues || []).length === 0 && <p className="px-3 py-2 text-sm text-slate-500">No work items.</p>}
                {(sprint.issues || []).map((issue) => (
                  <div key={issue.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <button className="text-left text-slate-900 hover:underline" onClick={() => onOpenIssue?.(issue.id)}>
                      {issue.issue_key} - {issue.title}
                    </button>
                    <div className="flex items-center gap-2">
                      <select
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                        value={issue.status}
                        onChange={(event) => transitionIssueMutation.mutate({ issueId: issue.id, status: event.target.value })}
                      >
                        {workflowStates.map((state) => (
                          <option key={state.id} value={state.id}>{state.name}</option>
                        ))}
                      </select>
                      <button
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                        onClick={() => removeIssueMutation.mutate({ issueId: issue.id })}
                      >
                        Move to backlog
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded border border-slate-200 p-3">
        <p className="mb-2 text-sm font-semibold text-slate-800">Backlog items ({visibleBacklogIssues.length})</p>
        <div className="divide-y divide-slate-200">
          {isLoading && <p className="py-2 text-sm text-slate-500">Loading backlog...</p>}
          {!isLoading && visibleBacklogIssues.length === 0 && <p className="py-2 text-sm text-slate-500">Backlog is empty.</p>}
          {visibleBacklogIssues.map((issue) => (
            <div key={issue.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <button className="text-left text-slate-900 hover:underline" onClick={() => onOpenIssue?.(issue.id)}>
                {issue.issue_key} - {issue.title}
              </button>
              <div className="flex items-center gap-2">
                <select
                  className="rounded border border-slate-300 px-2 py-1 text-xs"
                  value={issue.sprint_id || ''}
                  onChange={(event) => {
                    const sprintId = event.target.value
                    if (!sprintId) return
                    assignIssueMutation.mutate({ issueId: issue.id, sprintId })
                  }}
                >
                  <option value="">Add to sprint</option>
                  {sprints.map((sprint) => (
                    <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
