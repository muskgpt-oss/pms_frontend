import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createIssue, fetchSprints } from '../services/projectApi'
import { getApiErrorMessage } from '../services/apiClient'
import IssueTypeBadge from './IssueTypeBadge'

const defaultWorkTypes = ['epic', 'feature', 'story', 'task', 'subtask', 'bug', 'issue']
const defaultStatuses = ['to do', 'in progress', 'in review', 'done']

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeStatus(status) {
  const value = status.trim().toLowerCase()
  if (!value) return 'todo'
  if (['to do', 'to-do', 'todo'].includes(value)) return 'todo'
  if (['in progress', 'in-progress', 'in_progress'].includes(value)) return 'in_progress'
  if (['in review', 'in-review', 'in_review'].includes(value)) return 'in_review'
  if (value === 'done') return 'done'
  return value.replace(/\s+/g, '_').replace(/-/g, '_')
}

export default function CreateWorkItemModal({
  isOpen,
  onClose,
  selectedProjectId,
  selectedProjectName,
  onCreated,
  initialStatus = '',
  boardSource = 'kanban'
}) {
  const [workType, setWorkType] = useState('task')
  const [status, setStatus] = useState('to do')
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState('')
  const [storyPoints, setStoryPoints] = useState('')
  const [selectedLabels, setSelectedLabels] = useState([])
  const [selectedLabelOption, setSelectedLabelOption] = useState('')
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [sprintId, setSprintId] = useState('')

  const { data: sprints = [] } = useQuery({
    queryKey: ['sprints', selectedProjectId],
    queryFn: () => fetchSprints(selectedProjectId),
    enabled: Boolean(selectedProjectId),
  })

  const resolvedInitialStatus = useMemo(() => {
    const candidate = initialStatus.trim().toLowerCase()
    if (!candidate) return ''
    const aliases = {
      selected_for_development: 'to do',
      to_do: 'to do',
      todo: 'to do',
      backlog: 'to do',
      in_progress: 'in progress',
      in_review: 'in review',
      done: 'done',
    }
    const mappedCandidate = aliases[candidate] || candidate.replace(/[_-]/g, ' ')
    const found = defaultStatuses.find((entry) => entry.trim().toLowerCase() === mappedCandidate)
    return found || ''
  }, [initialStatus])

  useEffect(() => {
    if (!isOpen) return
    if (resolvedInitialStatus) {
      setStatus(resolvedInitialStatus)
    } else {
      setStatus('to do')
    }
  }, [isOpen, resolvedInitialStatus])

  const labelOptions = ['frontend', 'backend', 'api', 'ui', 'ux', 'bug', 'priority', 'design']

  const requiredSummaryValid = summary.trim().length >= 3
  const assigneeValid = !assignee.trim() || emailRegex.test(assignee.trim())
  const dateRangeValid = !startDate || !dueDate || startDate <= dueDate
  const storyPointsValid = !storyPoints || (Number(storyPoints) >= 0 && Number(storyPoints) <= 100)
  const formReady = Boolean(
    selectedProjectId &&
    requiredSummaryValid &&
    assigneeValid &&
    dateRangeValid &&
    storyPointsValid
  )

  const createMutation = useMutation({
    mutationFn: ({ projectId, payload }) => createIssue({ projectId, payload }),
    onSuccess: () => {
      onCreated?.()
      onClose?.()
      setSummary('')
      setDescription('')
      setAssignee('')
      setStoryPoints('')
      setStartDate('')
      setDueDate('')
      setStatus('to do')
      setWorkType('task')
      setSelectedLabels([])
      setSelectedLabelOption('')
      setSprintId('')
    },
  })

  const onSubmit = (event) => {
    event.preventDefault()
    if (!selectedProjectId || !formReady) return

    const normalizedWorkType = workType.trim().toLowerCase()
    const boardLabel = `board:${boardSource}`
    const mergedLabels = Array.from(new Set([...selectedLabels, boardLabel]))

    const payload = {
      title: summary,
      description: description.trim(),
      issue_type: normalizedWorkType === 'user story' ? 'story' : normalizedWorkType,
      work_type: normalizedWorkType,
      status: normalizeStatus(status),
      assignee: assignee.trim() || null,
      story_points: storyPoints ? Number(storyPoints) : null,
      start_date: startDate ? `${startDate}T00:00:00Z` : null,
      due_date: dueDate ? `${dueDate}T00:00:00Z` : null,
      labels: mergedLabels,
      sprint_id: sprintId || null,
    }

    createMutation.mutate({
      projectId: selectedProjectId,
      payload,
    })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
      <div className="max-h-[95vh] w-full max-w-3xl overflow-auto rounded border border-brand-border bg-white p-6 text-brand-navy shadow-2xl">
        <div className="mb-5 flex items-center justify-between border-b border-brand-border pb-3">
          <div>
            <h2 className="text-xl font-bold text-brand-navy">Create Issue</h2>
            <p className="text-xs text-brand-slate">Plan and structure new work items within <span className="font-semibold text-brand-blue">{selectedProjectName}</span>.</p>
          </div>
          <button className="text-brand-slate hover:text-brand-navy" onClick={onClose}>
            ✕
          </button>
        </div>

        {!selectedProjectId && (
          <p className="mb-4 rounded border border-amber-250 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Please select a project first.
          </p>
        )}

        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-slate">Issue Type</label>
              <div className="flex gap-2">
                <select
                  className="flex-1 input-text"
                  value={workType}
                  onChange={(e) => setWorkType(e.target.value)}
                >
                  {defaultWorkTypes.map((item) => (
                    <option key={item} value={item}>{item.toUpperCase()}</option>
                  ))}
                </select>
                <div className="flex items-center">
                  <IssueTypeBadge type={workType} showText={false} />
                </div>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-slate">Status</label>
              <select
                className="w-full input-text"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {defaultStatuses.map((item) => (
                  <option key={item} value={item}>{item.toUpperCase()}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-slate">Sprint</label>
              <select
                className="w-full input-text"
                value={sprintId}
                onChange={(e) => setSprintId(e.target.value)}
              >
                <option value="">Backlog (No Sprint)</option>
                {sprints.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.state})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-slate">
              Summary <span className="text-red-500">*</span>
            </label>
            <input
              className="w-full input-text"
              placeholder="e.g. Design responsive dashboards"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              minLength={3}
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-slate">Description</label>
            <textarea
              className="h-28 w-full input-text"
              placeholder="Provide a detailed description of the work..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-slate">Assignee (email)</label>
              <input
                className={`w-full input-text ${!assigneeValid ? 'border-red-550 focus:ring-red-550' : ''}`}
                placeholder="developer@company.com"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
              />
              {!assigneeValid && <p className="mt-1 text-[10px] text-red-600">Enter a valid email address</p>}
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-slate">Story Points</label>
              <input
                type="number"
                min="0"
                max="100"
                className="w-full input-text"
                placeholder="e.g. 5"
                value={storyPoints}
                onChange={(e) => setStoryPoints(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-slate">Labels</label>
              <div className="flex gap-2">
                <select
                  className="flex-1 input-text text-xs py-2"
                  value={selectedLabelOption}
                  onChange={(e) => setSelectedLabelOption(e.target.value)}
                >
                  <option value="">Choose Label</option>
                  {labelOptions.map((label) => (
                    <option key={label} value={label}>{label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-secondary py-1 px-3 text-xs"
                  onClick={() => {
                    if (!selectedLabelOption) return
                    setSelectedLabels((curr) => (curr.includes(selectedLabelOption) ? curr : [...curr, selectedLabelOption]))
                    setSelectedLabelOption('')
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          {selectedLabels.length > 0 && (
            <div className="flex flex-wrap gap-1.5 rounded border border-brand-border bg-brand-gray-light p-2">
              {selectedLabels.map((label) => (
                <span key={label} className="inline-flex items-center gap-1 rounded bg-blue-50 border border-blue-200 px-2 py-0.5 text-xs text-brand-blue">
                  {label}
                  <button type="button" className="text-brand-blue hover:text-brand-blue-hover font-bold ml-1" onClick={() => setSelectedLabels((curr) => curr.filter((l) => l !== label))}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-slate">Start Date</label>
              <input
                type="date"
                className="w-full input-text"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-slate">Due Date</label>
              <input
                type="date"
                className={`w-full input-text ${!dateRangeValid ? 'border-red-550 focus:ring-red-550' : ''}`}
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          {!dateRangeValid && (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              Start date should be before or equal to due date.
            </p>
          )}

          {createMutation.error && (
            <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {getApiErrorMessage(createMutation.error)}
            </p>
          )}

          <div className="flex items-center justify-end gap-2.5 border-t border-brand-border pt-4">
            <button type="button" className="btn-secondary px-4 py-2 text-sm" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary px-5 py-2 text-sm"
              disabled={!selectedProjectId || !formReady || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
