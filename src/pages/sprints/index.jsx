import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createEpic, createSprint, fetchSprintHierarchy, fetchSprints, includeEpicInSprint } from '../../services/projectApi'
import { getApiErrorMessage } from '../../services/apiClient'

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
      const target = { ...epicSelection[key], [value]: !epicSelection[key]?.[value] }
      epicSelection[key] = target
      next[epicId] = epicSelection
      return next
    })
  }

  if (!selectedProjectId) {
    return <p className="rounded-lg border border-slate-300 bg-white p-4 text-sm text-slate-700">Select a project first.</p>
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-300 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Sprint</h2>
        <p className="mt-1 text-sm text-slate-600">Sprint → Epic → Task → Subtask hierarchy with selective inclusion.</p>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Create Sprint</label>
            <div className="flex gap-2">
              <input
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                value={newSprintName}
                onChange={(event) => setNewSprintName(event.target.value)}
                placeholder="Sprint name"
              />
              <button
                type="button"
                className="rounded bg-slate-900 px-3 py-2 text-xs font-medium text-white"
                onClick={() => createSprintMutation.mutate({ projectId: selectedProjectId, payload: { name: newSprintName, goal: '' } })}
                disabled={!newSprintName.trim() || createSprintMutation.isPending}
              >
                Create
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Create Epic</label>
            <div className="flex gap-2">
              <input
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                value={newEpicTitle}
                onChange={(event) => setNewEpicTitle(event.target.value)}
                placeholder="Epic title"
              />
              <button
                type="button"
                className="rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white"
                onClick={() => createEpicMutation.mutate({ projectId: selectedProjectId, payload: { title: newEpicTitle } })}
                disabled={!newEpicTitle.trim() || createEpicMutation.isPending}
              >
                Add Epic
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Target Sprint</label>
            <select
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              value={activeSprintId}
              onChange={(event) => setSelectedSprintId(event.target.value)}
            >
              <option value="">Select sprint</option>
              {sprints.map((sprint) => (
                <option key={sprint.id} value={sprint.id}>{sprint.name} ({sprint.state})</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{getApiErrorMessage(error)}</p>}

      <div className="rounded-lg border border-slate-300 bg-white p-4">
        <h3 className="text-base font-semibold text-slate-900">Hierarchy Selection</h3>
        {isLoading && <p className="mt-3 text-sm text-slate-600">Loading hierarchy...</p>}

        {!isLoading && (hierarchy?.epics || []).length === 0 && (
          <p className="mt-3 text-sm text-slate-600">No epics available yet.</p>
        )}

        <div className="mt-3 space-y-3">
          {(hierarchy?.epics || []).map((epic) => {
            const epicSelection = selection[epic.id] || { tasks: {}, subtasks: {} }
            const selectedTaskIds = Object.entries(epicSelection.tasks).filter(([, checked]) => checked).map(([taskId]) => taskId)
            const selectedSubtaskIds = Object.entries(epicSelection.subtasks).filter(([, checked]) => checked).map(([subtaskId]) => subtaskId)

            return (
              <div key={epic.id} className="rounded border border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-3 py-2">
                  <button
                    type="button"
                    className="text-left text-sm font-semibold text-slate-900"
                    onClick={() => toggleEpicExpanded(epic.id)}
                  >
                    {expandedEpicIds[epic.id] ? '▾' : '▸'} {epic.title} ({epic.status})
                    {epic.included_in_sprint && <span className="ml-2 rounded bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700">Included</span>}
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
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
                      className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
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

                {expandedEpicIds[epic.id] && (
                  <div className="space-y-2 px-4 py-3">
                    {epic.tasks.length === 0 && <p className="text-xs text-slate-600">No tasks linked to this epic yet.</p>}

                    {epic.tasks.map((task) => (
                      <div key={task.id} className="rounded border border-slate-200 p-2">
                        <label className="flex items-center gap-2 text-sm text-slate-800">
                          <input
                            type="checkbox"
                            checked={Boolean(epicSelection.tasks[task.id])}
                            onChange={() => toggleSelection(epic.id, 'tasks', task.id)}
                          />
                          Task: {task.title} ({task.status})
                          {task.included_in_sprint && <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700">Included</span>}
                        </label>

                        <div className="ml-6 mt-2 space-y-1">
                          {task.subtasks.map((subtask) => (
                            <label key={subtask.id} className="flex items-center gap-2 text-xs text-slate-700">
                              <input
                                type="checkbox"
                                checked={Boolean(epicSelection.subtasks[subtask.id])}
                                onChange={() => toggleSelection(epic.id, 'subtasks', subtask.id)}
                              />
                              Subtask: {subtask.title} ({subtask.status})
                              {subtask.included_in_sprint && <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700">Included</span>}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {includeMutation.error && <p className="mt-3 text-sm text-red-600">{getApiErrorMessage(includeMutation.error)}</p>}
        {includeMutation.data && <p className="mt-3 text-sm text-emerald-700">{includeMutation.data.comment}</p>}
      </div>
    </div>
  )
}
