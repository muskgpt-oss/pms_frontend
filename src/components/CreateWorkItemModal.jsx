import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { createIssue } from '../services/projectApi'
import { getApiErrorMessage } from '../services/apiClient'

const defaultWorkTypes = ['epic', 'user story', 'task', 'subtask', 'bug']
const defaultStatuses = ['to do', 'in progress', 'in review', 'done']

const issueTypeMap = {
  epic: 'task',
  'user story': 'story',
  task: 'task',
  subtask: 'task',
  bug: 'bug',
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeStatus(status) {
  const value = status.trim().toLowerCase()
  if (!value) return 'backlog'
  if (['to do', 'to-do', 'todo'].includes(value)) return 'todo'
  if (['in progress', 'in-progress', 'in_progress'].includes(value)) return 'in_progress'
  if (['in review', 'in-review', 'in_review'].includes(value)) return 'in_review'
  if (value === 'done') return 'done'
  return value.replace(/\s+/g, '_').replace(/-/g, '_')
}

function buildDescription(payload) {
  const lines = [payload.description || '']
  lines.push('')
  lines.push(`Start date: ${payload.startDate || '-'}`)
  lines.push(`Due date: ${payload.dueDate || '-'}`)
  lines.push(`Labels: ${payload.labels?.length ? payload.labels.join(', ') : '-'}`)
  lines.push(`Work type (selected): ${payload.workType}`)
  lines.push(`Board source: ${payload.boardSource || 'kanban'}`)
  return lines.join('\n')
}

function RequiredLabel({ children }) {
  return (
    <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">
      {children} <span className="text-red-400">*</span>
    </label>
  )
}

export default function CreateWorkItemModal({ isOpen, onClose, selectedProjectId, selectedProjectName, onCreated, initialStatus = '', boardSource = 'kanban' }) {
  const [workTypes, setWorkTypes] = useState(defaultWorkTypes)
  const [statuses, setStatuses] = useState(defaultStatuses)
  const [workType, setWorkType] = useState('task')
  const [status, setStatus] = useState('to do')
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState('')
  const [selectedLabels, setSelectedLabels] = useState([])
  const [selectedLabelOption, setSelectedLabelOption] = useState('')
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')

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
    const found = statuses.find((entry) => entry.trim().toLowerCase() === mappedCandidate)
    return found || ''
  }, [initialStatus, statuses])

  useEffect(() => {
    if (!isOpen || !resolvedInitialStatus) return
    setStatus(resolvedInitialStatus)
  }, [isOpen, resolvedInitialStatus])

  const labelOptions = ['frontend', 'backend', 'api', 'ui', 'ux', 'bug', 'priority', 'design']

  const requiredSummaryValid = summary.trim().length >= 3
  const requiredWorkTypeValid = Boolean(workType.trim())
  const requiredStatusValid = Boolean(status.trim())
  const assigneeValid = !assignee.trim() || emailRegex.test(assignee.trim())
  const dateRangeValid = !startDate || !dueDate || startDate <= dueDate
  const formReady = Boolean(selectedProjectId && requiredSummaryValid && requiredWorkTypeValid && requiredStatusValid && assigneeValid && dateRangeValid)

  const createMutation = useMutation({
    mutationFn: ({ projectId, payload }) => createIssue({ projectId, payload }),
    onSuccess: () => {
      onCreated?.()
      onClose?.()
      setSummary('')
      setDescription('')
      setAssignee('')
      setStartDate('')
      setDueDate('')
      setStatus('to do')
      setSelectedLabels([])
      setSelectedLabelOption('')
    },
  })

  const onSubmit = (event) => {
    event.preventDefault()
    if (!selectedProjectId || !formReady) return

    const normalizedWorkType = workType.trim().toLowerCase()
    const backendIssueType = issueTypeMap[normalizedWorkType] || 'task'
    const boardLabel = `board:${boardSource}`
    const mergedLabels = Array.from(new Set([...selectedLabels, boardLabel]))

    createMutation.mutate({
      projectId: selectedProjectId,
      payload: {
        title: summary,
        description: buildDescription({
          description,
          startDate,
          dueDate,
          labels: selectedLabels,
          workType,
          boardSource,
        }),
        issue_type: backendIssueType,
        work_type: normalizedWorkType,
        status: normalizeStatus(status),
        assignee,
        labels: mergedLabels,
      },
    })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
      <div className="max-h-[95vh] w-full max-w-4xl overflow-auto rounded-xl border border-slate-700 bg-[#161b26] p-5 text-slate-100 shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-slate-700 pb-3">
          <div>
            <h2 className="text-xl font-semibold">Create Work Item</h2>
            <p className="text-sm text-slate-400">Simple issue form with optional details.</p>
          </div>
          <button className="rounded border border-slate-600 px-3 py-1 text-sm text-slate-300" onClick={onClose}>
            Close
          </button>
        </div>

        {!selectedProjectId && (
          <p className="mb-4 rounded border border-amber-700 bg-amber-900/30 px-3 py-2 text-sm text-amber-200">
            Select a project first. Space name will match that project.
          </p>
        )}

        <form className="grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Space Name</label>
            <input className="w-full rounded border border-slate-700 bg-[#0f1320] px-3 py-2 text-sm" value={selectedProjectName || ''} readOnly />
          </div>

          <div>
            <RequiredLabel>Work Type</RequiredLabel>
            <select className="w-full rounded border border-slate-700 bg-[#0f1320] px-3 py-2 text-sm" value={workType} onChange={(event) => setWorkType(event.target.value)}>
              {workTypes.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>

          <div>
            <RequiredLabel>Status</RequiredLabel>
            <select className="w-full rounded border border-slate-700 bg-[#0f1320] px-3 py-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}>
              {statuses.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Assignee (email)</label>
            <input
              className="w-full rounded border border-slate-700 bg-[#0f1320] px-3 py-2 text-sm"
              placeholder="alice@company.com"
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
            />
            {!assigneeValid && <p className="mt-1 text-xs text-red-400">Enter a valid email or keep empty</p>}
            {assigneeValid && assignee && <p className="mt-1 text-xs text-emerald-400">Check: valid email</p>}
          </div>

          <div className="md:col-span-2">
            <RequiredLabel>Summary</RequiredLabel>
            <input
              className="w-full rounded border border-slate-700 bg-[#0f1320] px-3 py-2 text-sm"
              placeholder="Short summary about project/task"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              minLength={3}
              required
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Description</label>
            <textarea
              className="h-24 w-full rounded border border-slate-700 bg-[#0f1320] px-3 py-2 text-sm"
              placeholder="Describe project/task in detail"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="md:col-span-2">
                <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Labels</label>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <select
                      className="flex-1 rounded border border-slate-700 bg-[#0f1320] px-3 py-2 text-sm"
                      value={selectedLabelOption}
                      onChange={(event) => setSelectedLabelOption(event.target.value)}
                    >
                      <option value="">Select a label</option>
                      {labelOptions.map((label) => (
                        <option key={label} value={label}>{label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="rounded bg-slate-700 px-3 py-1.5 text-sm"
                      onClick={() => {
                        if (!selectedLabelOption) return
                        setSelectedLabels((current) => (
                          current.includes(selectedLabelOption) ? current : [...current, selectedLabelOption]
                        ))
                        setSelectedLabelOption('')
                      }}
                    >
                      Add
                    </button>
                  </div>
                  <div className="min-h-[36px] w-full rounded border border-slate-700 bg-[#0f1320] px-2 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {selectedLabels.length === 0 && <span className="text-xs text-slate-500">No labels selected</span>}
                      {selectedLabels.map((label, index) => (
                        <span
                          key={`${label}-${index}`}
                          className="inline-flex items-center gap-1 rounded border border-blue-500 bg-blue-600/20 px-2 py-0.5 text-xs text-blue-200"
                        >
                          {label}
                          <button
                            type="button"
                            className="text-blue-100 hover:text-white"
                            onClick={() => setSelectedLabels((current) => current.filter((entry) => entry !== label))}
                          >
                            x
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
          </div>

          <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Start Date</label>
                <input
                  type="date"
                  className="w-full rounded border border-slate-700 bg-[#0f1320] px-3 py-2 text-sm"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
          </div>

          <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-slate-400">Due Date</label>
                <input
                  type="date"
                  className="w-full rounded border border-slate-700 bg-[#0f1320] px-3 py-2 text-sm"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
          </div>

          {!dateRangeValid && (
            <p className="md:col-span-2 rounded border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              Start date should be before or equal to due date.
            </p>
          )}

          {createMutation.error && (
            <p className="md:col-span-2 rounded border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {getApiErrorMessage(createMutation.error)}
            </p>
          )}

          <div className="md:col-span-2 flex items-center justify-end gap-2 border-t border-slate-700 pt-3">
            <button type="button" className="rounded border border-slate-600 px-4 py-2 text-sm" onClick={onClose}>Cancel</button>
            <button
              type="submit"
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
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
