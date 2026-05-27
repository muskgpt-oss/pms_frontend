import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createEpic, createSprint, fetchSprintHierarchy, fetchSprints, includeEpicInSprint } from '../../services/projectApi'
import { getApiErrorMessage } from '../../services/apiClient'
import IssueTypeBadge from '../../components/IssueTypeBadge'

// Reusable status badge helper
const StatusBadge = ({ status }) => {
  const normalized = String(status || '').trim().toLowerCase()
  let style = 'bg-brand-hover border-brand-border text-brand-slate'
  
  if (['todo', 'to_do', 'backlog'].includes(normalized)) {
    style = 'bg-gray-100 border-gray-200 text-brand-slate'
  } else if (['in_progress', 'doing', 'in_review', 'review', 'qa', 'testing'].includes(normalized)) {
    style = 'bg-blue-50 border-blue-200 text-brand-blue'
  } else if (['done', 'completed', 'closed'].includes(normalized)) {
    style = 'bg-green-50 border-green-200 text-green-700'
  }
  
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${style}`}>
      {status}
    </span>
  )
}

export default function SprintsPage({ selectedProjectId }) {
  const queryClient = useQueryClient()
  const [newSprintName, setNewSprintName] = useState('')
  const [newEpicTitle, setNewEpicTitle] = useState('')
  const [selectedSprintId, setSelectedSprintId] = useState('')
  const [expandedEpicIds, setExpandedEpicIds] = useState({})
  const [selection, setSelection] = useState({})

  const { data: sprints = [] } = useQuery({
    queryKey: ['sprints', selectedProjectId],
    queryFn: () => fetchSprints(selectedProjectId),
    enabled: Boolean(selectedProjectId),
  })

  const activeSprintId = useMemo(() => {
    if (selectedSprintId) return selectedSprintId
    const active = sprints.find((entry) => entry.state === 'active')
    return active?.id || sprints[0]?.id || ''
  }, [selectedSprintId, sprints])

  const { data: hierarchy, isLoading, error } = useQuery({
    queryKey: ['sprint-hierarchy', selectedProjectId, activeSprintId],
    queryFn: () => fetchSprintHierarchy({ projectId: selectedProjectId, sprintId: activeSprintId || undefined }),
    enabled: Boolean(selectedProjectId),
  })

  const createSprintMutation = useMutation({
    mutationFn: createSprint,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sprints', selectedProjectId] })
      queryClient.invalidateQueries({ queryKey: ['sprint-hierarchy', selectedProjectId] })
      setNewSprintName('')
    },
  })

  const createEpicMutation = useMutation({
    mutationFn: createEpic,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sprint-hierarchy', selectedProjectId] })
      setNewEpicTitle('')
    },
  })

  const includeMutation = useMutation({
    mutationFn: includeEpicInSprint,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sprint-hierarchy', selectedProjectId, activeSprintId] })
      queryClient.invalidateQueries({ queryKey: ['issues', selectedProjectId] })
      queryClient.invalidateQueries({ queryKey: ['backlog', selectedProjectId] })
      queryClient.invalidateQueries({ queryKey: ['board', selectedProjectId] })
    },
  })

  const toggleEpicExpanded = (epicId) => {
    setExpandedEpicIds((current) => ({ ...current, [epicId]: !current[epicId] }))
  }

  const toggleSelection = (epicId, key, value) => {
    setSelection((current) => {
      const next = { ...current }
      const epicSelection = { ...(next[epicId] || { tasks: {}, subtasks: {} }) }
      epicSelection[key] = {
        ...(epicSelection[key] || {}),
        [value]: !epicSelection[key]?.[value],
      }
      next[epicId] = epicSelection
      return next
    })
  }

  if (!selectedProjectId) {
    return (
      <div className="rounded border border-brand-border bg-white p-6 text-center shadow-sm max-w-md mx-auto mt-8">
        <svg className="w-12 h-12 text-brand-slate mx-auto mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12h8m-4-4v8" />
        </svg>
        <h3 className="text-sm font-bold text-brand-navy">No Project Selected</h3>
        <p className="mt-1.5 text-xs text-brand-slate leading-relaxed">
          Please pick a project from the workspace sidebar navigation to manage and plan sprints.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Configuration Panel */}
      <div className="rounded border border-brand-border bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3 border-b border-brand-border pb-3.5 mb-4">
          <div className="w-9 h-9 rounded bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-650">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-bold text-brand-navy">Sprint & Epic Scope Planning</h2>
            <p className="text-xs text-brand-slate mt-0.5">Link and allocate tasks/subtasks of epics to planned or active sprints.</p>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {/* Create Sprint */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-brand-slate">Create Sprint</label>
            <div className="flex gap-2">
              <input
                className="w-full input-text"
                value={newSprintName}
                onChange={(event) => setNewSprintName(event.target.value)}
                placeholder="e.g. Sprint 3"
              />
              <button
                type="button"
                className="btn-primary text-xs font-bold px-4 py-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => createSprintMutation.mutate({ projectId: selectedProjectId, payload: { name: newSprintName, goal: '' } })}
                disabled={!newSprintName.trim() || createSprintMutation.isPending}
              >
                Create
              </button>
            </div>
          </div>

          {/* Create Epic */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-brand-slate">Create Epic</label>
            <div className="flex gap-2">
              <input
                className="w-full input-text"
                value={newEpicTitle}
                onChange={(event) => setNewEpicTitle(event.target.value)}
                placeholder="e.g. User Authentication"
              />
              <button
                type="button"
                className="rounded bg-purple-650 hover:bg-purple-700 text-xs font-bold text-white px-4 py-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => createEpicMutation.mutate({ projectId: selectedProjectId, payload: { title: newEpicTitle } })}
                disabled={!newEpicTitle.trim() || createEpicMutation.isPending}
              >
                Add
              </button>
            </div>
          </div>

          {/* Target Sprint Dropdown */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-brand-slate">Target Sprint</label>
            <select
              className="w-full input-text cursor-pointer"
              value={activeSprintId}
              onChange={(event) => setSelectedSprintId(event.target.value)}
            >
              <option value="">Select Target Sprint</option>
              {sprints.map((sprint) => (
                <option key={sprint.id} value={sprint.id}>
                  {sprint.name} ({sprint.state})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600 font-medium">
          {getApiErrorMessage(error)}
        </div>
      )}

      {/* Hierarchy Section */}
      <div className="rounded border border-brand-border bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold text-brand-navy border-b border-brand-border pb-3 mb-4">Epic Scope Hierarchy</h3>
        
        {isLoading && (
          <p className="text-center text-xs text-brand-slate py-12">Loading project scope...</p>
        )}

        {!isLoading && (hierarchy?.epics || []).length === 0 && (
          <div className="text-center py-12 border border-dashed border-brand-border rounded">
            <p className="text-xs text-brand-slate">No epics exist inside this project.</p>
          </div>
        )}

        <div className="space-y-4">
          {(hierarchy?.epics || []).map((epic) => {
            const isEpicExpanded = expandedEpicIds[epic.id]
            const epicSelection = selection[epic.id] || { tasks: {}, subtasks: {} }
            const selectedTaskIds = Object.entries(epicSelection.tasks).filter(([, checked]) => checked).map(([taskId]) => taskId)
            const selectedSubtaskIds = Object.entries(epicSelection.subtasks).filter(([, checked]) => checked).map(([subtaskId]) => subtaskId)

            return (
              <div key={epic.id} className="rounded border border-brand-border overflow-hidden bg-brand-gray-light/20">
                {/* Epic Node Row */}
                <div className="flex flex-wrap items-center justify-between gap-3 bg-brand-gray-light px-4 py-3 border-b border-brand-border">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="p-1 rounded text-brand-slate hover:bg-brand-hover hover:text-brand-navy transition-colors cursor-pointer"
                      onClick={() => toggleEpicExpanded(epic.id)}
                    >
                      <svg
                        className={`w-3.5 h-3.5 transform transition-transform ${isEpicExpanded ? 'rotate-90' : ''}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                    
                    <div className="flex items-center gap-2">
                      <IssueTypeBadge type="epic" showText={false} />
                      <span className="text-xs font-bold text-brand-navy">{epic.title}</span>
                      <StatusBadge status={epic.status} />
                      {epic.included_in_sprint && (
                        <span className="rounded bg-green-50 border border-green-200 text-green-700 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                          In Sprint
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="btn-secondary text-[10px] font-bold px-3 py-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={!activeSprintId || includeMutation.isPending}
                      onClick={() => includeMutation.mutate({
                        projectId: selectedProjectId,
                        sprintId: activeSprintId,
                        epicId: epic.id,
                        payload: { include_mode: 'full' },
                      })}
                    >
                      Add Full Epic
                    </button>
                    <button
                      type="button"
                      className="btn-secondary text-[10px] font-bold px-3 py-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={!activeSprintId || includeMutation.isPending || (selectedTaskIds.length === 0 && selectedSubtaskIds.length === 0)}
                      onClick={() => includeMutation.mutate({
                        projectId: selectedProjectId,
                        sprintId: activeSprintId,
                        epicId: epic.id,
                        payload: { include_mode: 'selected', task_ids: selectedTaskIds, subtask_ids: selectedSubtaskIds },
                      })}
                    >
                      Add Selected
                    </button>
                  </div>
                </div>

                {/* Indented tasks tree section */}
                {isEpicExpanded && (
                  <div className="px-4 py-3.5 space-y-3.5 bg-white">
                    {epic.tasks.length === 0 && (
                      <p className="text-center text-xs text-brand-slate py-3">No tasks link to this epic.</p>
                    )}

                    {epic.tasks.map((task) => {
                      const hasSubtasks = task.subtasks && task.subtasks.length > 0
                      return (
                        <div key={task.id} className="space-y-2">
                          {/* Task Node */}
                          <div className="flex items-center justify-between gap-3 p-2.5 rounded border border-brand-border hover:bg-brand-hover transition-colors">
                            <label className="flex items-center gap-3 text-xs text-brand-navy font-medium cursor-pointer">
                              <input
                                type="checkbox"
                                className="w-3.5 h-3.5 rounded border-brand-border bg-white text-brand-blue focus:ring-brand-blue cursor-pointer"
                                  checked={Boolean(epicSelection.tasks[task.id])}
                                  onChange={() => toggleSelection(epic.id, 'tasks', task.id)}
                              />
                              <div className="flex items-center gap-2">
                                <IssueTypeBadge type={task.work_type} showText={false} />
                                <span>{task.title}</span>
                                <StatusBadge status={task.status} />
                                {task.included_in_sprint && (
                                  <span className="rounded bg-green-50 border border-green-200 text-green-700 px-1.5 py-0.5 text-[8px] font-bold uppercase select-none">
                                    In Sprint
                                  </span>
                                )}
                              </div>
                            </label>
                          </div>

                          {/* Subtask nested node under parent task */}
                          {hasSubtasks && (
                            <div className="pl-6 ml-4 border-l-2 border-brand-border space-y-2 pt-1.5 pb-0.5">
                              {task.subtasks.map((subtask) => (
                                <div key={subtask.id} className="flex items-center justify-between gap-3 p-2 rounded border border-brand-border bg-brand-gray-light/30 hover:bg-brand-hover transition-colors relative before:absolute before:left-[-16px] before:top-[16px] before:w-[12px] before:h-0.5 before:bg-brand-border">
                                  <label className="flex items-center gap-3 text-[11px] text-brand-slate font-medium cursor-pointer">
                                    <input
                                      type="checkbox"
                                      className="w-3 h-3 rounded border-brand-border bg-white text-brand-blue focus:ring-brand-blue cursor-pointer"
                                      checked={Boolean(epicSelection.subtasks[subtask.id])}
                                      onChange={() => toggleSelection(epic.id, 'subtasks', subtask.id)}
                                    />
                                    <div className="flex items-center gap-2">
                                      <IssueTypeBadge type="subtask" showText={false} />
                                      <span>{subtask.title}</span>
                                      <StatusBadge status={subtask.status} />
                                      {subtask.included_in_sprint && (
                                        <span className="rounded bg-green-50 border border-green-100 text-green-700 px-1.5 py-0.2 text-[8px] font-bold uppercase select-none">
                                          In Sprint
                                        </span>
                                      )}
                                    </div>
                                  </label>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {includeMutation.error && (
          <p className="mt-4 text-xs font-semibold text-red-600 font-medium">
            {getApiErrorMessage(includeMutation.error)}
          </p>
        )}
        {includeMutation.data && (
          <div className="mt-4 p-3 rounded bg-green-50 border border-green-200 text-xs font-semibold text-green-700">
            {includeMutation.data.comment}
          </div>
        )}
      </div>
    </div>
  )
}

