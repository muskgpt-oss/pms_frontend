import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createIssue, createSprint, fetchBacklog, startSprint, completeSprint } from '../../services/projectApi'
import { assignIssueToSprint, removeIssueFromSprint, transitionIssue } from '../../services/issueApi'
import { getApiErrorMessage } from '../../services/apiClient'
import IssueTypeBadge from '../../components/IssueTypeBadge'

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

const prettyLabel = (status) => {
  if (!status) return ''
  return String(status).replace(/[_-]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function BacklogPage({ selectedProjectId, onOpenIssue }) {
  const queryClient = useQueryClient()
  const [quickCreateTitle, setQuickCreateTitle] = useState('')
  const [newSprintName, setNewSprintName] = useState('')
  const [filters, setFilters] = useState({ q: '', assignee: '', priority: '', issue_type: '', label: '' })
  
  // Sprints collapse state
  const [collapsedSprints, setCollapsedSprints] = useState({})

  // Start Sprint Modal State
  const [startSprintModalOpen, setStartSprintModalOpen] = useState(false)
  const [sprintToStart, setSprintToStart] = useState(null)
  const [sprintForm, setSprintForm] = useState({
    name: '',
    duration: '2 weeks',
    startDate: '',
    endDate: '',
    goal: ''
  })

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
    onSuccess: () => {
      setStartSprintModalOpen(false)
      setSprintToStart(null)
      invalidate()
    },
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
        description: '',
        status: initialState,
        labels: ['board:scrum'],
        issue_type: 'task',
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

  // Pre-fill Start Sprint Form
  const handleOpenStartSprint = (sprint) => {
    const today = new Date().toISOString().split('T')[0]
    
    // Calculate default end date based on 2 weeks
    const end = new Date()
    end.setDate(end.getDate() + 14)
    const defaultEnd = end.toISOString().split('T')[0]

    setSprintToStart(sprint)
    setSprintForm({
      name: sprint.name || '',
      duration: '2 weeks',
      startDate: today,
      endDate: defaultEnd,
      goal: sprint.goal || ''
    })
    setStartSprintModalOpen(true)
  }

  // Auto-calculate dates based on duration select
  const handleDurationChange = (duration) => {
    const start = sprintForm.startDate ? new Date(sprintForm.startDate) : new Date()
    let daysToAdd = 14

    if (duration === '1 week') daysToAdd = 7
    else if (duration === '2 weeks') daysToAdd = 14
    else if (duration === '3 weeks') daysToAdd = 21
    else if (duration === '4 weeks') daysToAdd = 28
    
    if (duration !== 'custom') {
      start.setDate(start.getDate() + daysToAdd)
      setSprintForm((curr) => ({
        ...curr,
        duration,
        endDate: start.toISOString().split('T')[0]
      }))
    } else {
      setSprintForm((curr) => ({ ...curr, duration }))
    }
  }

  const handleStartDateChange = (startDate) => {
    const start = new Date(startDate)
    let daysToAdd = 14
    
    if (sprintForm.duration === '1 week') daysToAdd = 7
    else if (sprintForm.duration === '2 weeks') daysToAdd = 14
    else if (sprintForm.duration === '3 weeks') daysToAdd = 21
    else if (sprintForm.duration === '4 weeks') daysToAdd = 28

    if (sprintForm.duration !== 'custom') {
      start.setDate(start.getDate() + daysToAdd)
      setSprintForm((curr) => ({
        ...curr,
        startDate,
        endDate: start.toISOString().split('T')[0]
      }))
    } else {
      setSprintForm((curr) => ({ ...curr, startDate }))
    }
  }

  const handleStartSprintSubmit = (e) => {
    e.preventDefault()
    if (!sprintToStart) return

    startSprintMutation.mutate({
      projectId: selectedProjectId,
      sprintId: sprintToStart.id,
      payload: {
        name: sprintForm.name,
        goal: sprintForm.goal,
        start_date: sprintForm.startDate ? `${sprintForm.startDate}T00:00:00Z` : null,
        end_date: sprintForm.endDate ? `${sprintForm.endDate}T00:00:00Z` : null,
      }
    })
  }

  const getSprintStoryPoints = (issues = []) => {
    return issues.reduce((acc, curr) => acc + (curr.story_points || 0), 0)
  }

  if (!selectedProjectId) {
    return <p className="rounded bg-white border border-brand-border p-4 text-sm text-brand-slate">Select a project first.</p>
  }

  if (error) {
    return <p className="rounded bg-red-50 border border-red-200 p-4 text-sm text-red-600">{getApiErrorMessage(error)}</p>
  }

  return (
    <div className="space-y-5">
      
      {/* Header and Quick Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-border pb-4">
        <div>
          <h2 className="text-xl font-bold text-brand-navy">Backlog</h2>
          <p className="text-xs text-brand-slate mt-1">Organize your sprints, assign tasks, and plan product milestones.</p>
        </div>

        <div className="flex items-center gap-3">
          <input
            className="input-text py-1.5 px-3 text-xs w-48 md:w-64"
            value={filters.q}
            onChange={(event) => updateFilter('q', event.target.value)}
            placeholder="Filter issues..."
          />
          {filters.q && (
            <button
              onClick={() => updateFilter('q', '')}
              className="text-xs text-brand-slate hover:text-brand-navy"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Sprints Panel */}
      <div className="space-y-4">
        
        {/* Create Sprint quick block */}
        {sprints.length === 0 && (
          <div className="flex items-center justify-between gap-4 rounded border border-brand-border bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-brand-navy">Sprint Planner</span>
            </div>
            
            <div className="flex items-center gap-2.5">
              <input
                className="input-text py-1.5 px-3 text-xs w-40"
                value={newSprintName}
                onChange={(event) => setNewSprintName(event.target.value)}
                placeholder="e.g. Sprint 3"
              />
              <button
                className="btn-primary py-1.5 px-4 text-xs font-semibold"
                onClick={createSprintQuick}
                disabled={createSprintMutation.isPending || !newSprintName.trim()}
              >
                {createSprintMutation.isPending ? 'Adding...' : 'Create Sprint'}
              </button>
            </div>
          </div>
        )}

        {/* Sprint Lists */}
        <div className="space-y-4">
          {visibleSprintIssues.map((sprint) => {
            const isCollapsed = collapsedSprints[sprint.id]
            const points = getSprintStoryPoints(sprint.issues)
            
            return (
              <div key={sprint.id} className="rounded border border-brand-border bg-white overflow-hidden shadow-sm">
                
                {/* Sprint Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-brand-gray-light px-4 py-3 border-b border-brand-border">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCollapsedSprints((curr) => ({ ...curr, [sprint.id]: !curr[sprint.id] }))}
                      className="text-brand-slate hover:text-brand-navy text-sm mr-1.5"
                    >
                      {isCollapsed ? '▸' : '▾'}
                    </button>
                    <span className="text-sm font-bold text-brand-navy">{sprint.name}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      sprint.state === 'active' ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-brand-hover text-brand-slate border border-brand-border'
                    }`}>
                      {sprint.state}
                    </span>
                    <span className="text-brand-slate text-xs font-medium ml-2">
                      ({(sprint.issues || []).length} items · <span className="text-brand-blue font-bold">{points} SP</span>)
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {sprint.state !== 'active' && sprint.state !== 'completed' && (
                      <button
                        className="btn-primary py-1 px-3 text-xs"
                        onClick={() => handleOpenStartSprint(sprint)}
                      >
                        Start Sprint
                      </button>
                    )}
                    {sprint.state === 'active' && (
                      <button
                        className="btn-secondary py-1 px-3 text-xs"
                        onClick={() => {
                          if (confirm('Complete this sprint? Open issues will remain in backlog.')) {
                            completeSprintMutation.mutate({ projectId: selectedProjectId, sprintId: sprint.id })
                          }
                        }}
                      >
                        Complete Sprint
                      </button>
                    )}
                  </div>
                </div>

                {/* Sprint Issues List */}
                {!isCollapsed && (
                  <div className="divide-y divide-brand-border bg-white">
                    {(sprint.issues || []).length === 0 && (
                      <p className="px-5 py-4 text-xs text-brand-slate italic text-center">Plan sprint by dragging issues here, or assign them below.</p>
                    )}
                    {(sprint.issues || []).map((issue) => (
                      <div key={issue.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-xs hover:bg-brand-hover transition-colors">
                        
                        {/* Issue Info */}
                        <div className="flex items-center gap-3">
                          <IssueTypeBadge type={issue.work_type || issue.issue_type} showText={false} />
                          <button
                            className="text-brand-blue font-semibold hover:underline"
                            onClick={() => onOpenIssue?.(issue.id)}
                          >
                            {issue.issue_key}
                          </button>
                          <span className="text-brand-navy font-medium truncate max-w-sm md:max-w-md lg:max-w-lg">{issue.title}</span>
                        </div>

                        {/* Issue Actions & Metadata */}
                        <div className="flex items-center gap-3">
                          
                          {/* Story Points */}
                          {issue.story_points !== null && (
                            <span className="rounded-full bg-brand-hover border border-brand-border px-2 py-0.5 font-bold text-brand-slate text-[10px]" title="Story Points">
                              {issue.story_points}
                            </span>
                          )}

                          {/* Assignee Avatar */}
                          {issue.assignee ? (
                            <span
                              className="h-5 w-5 rounded-full bg-brand-blue text-white flex items-center justify-center font-bold text-[9px] cursor-help"
                              title={`Assignee: ${issue.assignee}`}
                            >
                              {issue.assignee.slice(0, 2).toUpperCase()}
                            </span>
                          ) : (
                            <span className="h-5 w-5 rounded-full border border-dashed border-brand-border text-brand-slate flex items-center justify-center text-[10px]" title="Unassigned">
                              👤
                            </span>
                          )}

                          {/* Status Tag */}
                          <span className="rounded bg-brand-hover border border-brand-border px-2 py-0.5 text-[9px] font-bold text-brand-slate uppercase tracking-wide">
                            {prettyLabel(issue.status)}
                          </span>

                          <select
                            className="input-text py-0.5 px-2 text-[10px]"
                            value={issue.status}
                            onChange={(event) => transitionIssueMutation.mutate({ issueId: issue.id, status: event.target.value })}
                          >
                            {workflowStates.map((state) => (
                              <option key={state.id} value={state.id}>{state.name}</option>
                            ))}
                          </select>

                          <button
                            className="btn-secondary py-0.5 px-2 text-[10px]"
                            onClick={() => removeIssueMutation.mutate({ issueId: issue.id })}
                          >
                            Move to Backlog
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Backlog Section */}
      <div className="rounded border border-brand-border bg-white p-4 shadow-sm">
        
        {/* Backlog Header */}
        <div className="flex items-center justify-between border-b border-brand-border pb-3 mb-3">
          <p className="text-sm font-bold text-brand-navy">Backlog ({visibleBacklogIssues.length})</p>
        </div>

        {/* Quick Create input inside Backlog */}
        <div className="flex gap-2 mb-4">
          <input
            className="flex-1 input-text py-1.5 px-3 text-xs"
            value={quickCreateTitle}
            onChange={(event) => setQuickCreateTitle(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && quickCreate()}
            placeholder="+ Create backlog issue (Summary)..."
          />
          <button className="btn-secondary py-1.5 px-4 text-xs" onClick={quickCreate}>
            Add Issue
          </button>
        </div>

        {/* Backlog Items List */}
        <div className="divide-y divide-brand-border">
          {isLoading && <p className="py-4 text-xs text-brand-slate italic text-center">Loading backlog list...</p>}
          {!isLoading && visibleBacklogIssues.length === 0 && (
            <p className="py-6 text-xs text-brand-slate italic text-center">Backlog is empty. Plan tasks here.</p>
          )}
          {visibleBacklogIssues.map((issue) => (
            <div key={issue.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-xs hover:bg-brand-hover transition-colors px-1">
              
              {/* Issue Info */}
              <div className="flex items-center gap-3">
                <IssueTypeBadge type={issue.work_type || issue.issue_type} showText={false} />
                <button className="text-brand-blue font-semibold hover:underline" onClick={() => onOpenIssue?.(issue.id)}>
                  {issue.issue_key}
                </button>
                <span className="text-brand-navy font-medium truncate max-w-sm md:max-w-md lg:max-w-lg">{issue.title}</span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3">
                
                {/* Story Points */}
                {issue.story_points !== null && (
                  <span className="rounded-full bg-brand-hover border border-brand-border px-2 py-0.5 font-bold text-brand-slate text-[10px]" title="Story Points">
                    {issue.story_points}
                  </span>
                )}

                {/* Assignee */}
                {issue.assignee ? (
                  <span
                    className="h-5 w-5 rounded-full bg-brand-blue text-white flex items-center justify-center font-bold text-[9px] cursor-help"
                    title={`Assignee: ${issue.assignee}`}
                  >
                    {issue.assignee.slice(0, 2).toUpperCase()}
                  </span>
                ) : (
                  <span className="h-5 w-5 rounded-full border border-dashed border-brand-border text-brand-slate flex items-center justify-center text-[10px]" title="Unassigned">
                    👤
                  </span>
                )}

                <span className="rounded bg-brand-hover border border-brand-border px-2 py-0.5 text-[9px] font-bold text-brand-slate uppercase tracking-wide">
                  {prettyLabel(issue.status)}
                </span>

                <select
                  className="input-text py-0.5 px-2 text-[10px]"
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

      {/* Start Sprint Modal */}
      {startSprintModalOpen && sprintToStart && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
          <div className="w-full max-w-lg rounded border border-brand-border bg-white p-5 text-brand-navy shadow-xl space-y-4">
            
            <div className="flex items-center justify-between border-b border-brand-border pb-3">
              <div>
                <h3 className="text-lg font-bold text-brand-navy">Start Sprint</h3>
                <p className="text-xs text-brand-slate">Activate sprint <span className="font-semibold text-brand-blue">{sprintToStart.name}</span> and plan workload.</p>
              </div>
              <button
                type="button"
                className="text-brand-slate hover:text-brand-navy"
                onClick={() => setStartSprintModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleStartSprintSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-slate">Sprint Name</label>
                <input
                  className="w-full input-text"
                  value={sprintForm.name}
                  onChange={(e) => setSprintForm((curr) => ({ ...curr, name: e.target.value }))}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-slate">Duration</label>
                  <select
                    className="w-full input-text"
                    value={sprintForm.duration}
                    onChange={(e) => handleDurationChange(e.target.value)}
                  >
                    <option value="1 week">1 week</option>
                    <option value="2 weeks">2 weeks</option>
                    <option value="3 weeks">3 weeks</option>
                    <option value="4 weeks">4 weeks</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-slate">Start Date</label>
                  <input
                    type="date"
                    className="w-full input-text"
                    value={sprintForm.startDate}
                    onChange={(e) => handleStartDateChange(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-slate">End Date</label>
                <input
                  type="date"
                  className="w-full input-text disabled:opacity-50"
                  value={sprintForm.endDate}
                  onChange={(e) => setSprintForm((curr) => ({ ...curr, endDate: e.target.value }))}
                  disabled={sprintForm.duration !== 'custom'}
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-slate">Sprint Goal</label>
                <textarea
                  className="w-full input-text h-16"
                  placeholder="What is the goal of this sprint?"
                  value={sprintForm.goal}
                  onChange={(e) => setSprintForm((curr) => ({ ...curr, goal: e.target.value }))}
                />
              </div>

              {startSprintMutation.error && (
                <p className="text-xs text-red-600">{getApiErrorMessage(startSprintMutation.error)}</p>
              )}

              <div className="flex justify-end gap-2 border-t border-brand-border pt-4">
                <button
                  type="button"
                  className="btn-secondary px-4 py-2 text-xs"
                  onClick={() => setStartSprintModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary px-5 py-2 text-xs"
                  disabled={startSprintMutation.isPending}
                >
                  {startSprintMutation.isPending ? 'Starting...' : 'Start'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}
