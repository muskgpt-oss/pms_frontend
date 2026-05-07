import { useState } from 'react'

export default function BoardColumn({
  className = '',
  columnId,
  title,
  issues,
  allStates = [],
  statusOptions = [],
  onTransition,
  onOpenIssue,
  onCreateIssue,
  columnStatusId,
  draggedIssueId,
  onDragStart,
  onDropIssue,
  onArchiveIssue,
  onDeleteIssue,
  onOpenIssueLink,
  onCopyIssueLink,
  showCreateButton = true,
  canTransitionIssues = true,
  showIssueActions = true,
  canManageColumn = false,
  onDeleteColumn,
  onColumnDragStart,
  onColumnDrop,
  emptyContent = null,
}) {
  const [openMenuIssueId, setOpenMenuIssueId] = useState('')
  const [showColumnMenu, setShowColumnMenu] = useState(false)

  const selectOptions = statusOptions.length
    ? statusOptions
    : allStates.map((state) => ({ value: state.id, label: state.name }))

  const handleDrop = (event) => {
    event.preventDefault()
    const sourceColumnStatusId = event.dataTransfer.getData('text/column-status-id')
    if (sourceColumnStatusId) {
      onColumnDrop?.(columnStatusId || columnId, sourceColumnStatusId)
      return
    }
    const issueId = event.dataTransfer.getData('text/plain') || draggedIssueId
    if (!issueId || !columnStatusId) return
    onDropIssue?.(issueId, columnStatusId)
  }

  const formatWorkType = (value) => {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) return 'Task'
    if (normalized === 'user story') return 'User Story'
    if (normalized === 'subtask') return 'Subtask'
    if (normalized === 'epic') return 'Epic'
    if (normalized === 'bug') return 'Bug'
    if (normalized === 'task') return 'Task'
    return normalized
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join(' ')
  }

  const isDoneColumn = String(columnStatusId || columnId || '').trim().toLowerCase() === 'done'

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-[#f3f5fa] p-3 shadow-sm ${className}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div
          className={`flex items-center gap-2 ${canManageColumn ? 'cursor-grab' : ''}`}
          draggable={canManageColumn && !isDoneColumn}
          onDragStart={(event) => {
            if (!canManageColumn || isDoneColumn) return
            event.dataTransfer.setData('text/column-status-id', columnStatusId || columnId)
            event.dataTransfer.effectAllowed = 'move'
            onColumnDragStart?.(columnStatusId || columnId)
          }}
          onDrop={(event) => {
            event.preventDefault()
            const sourceStatusId = event.dataTransfer.getData('text/column-status-id')
            onColumnDrop?.(columnStatusId || columnId, sourceStatusId)
          }}
          onDragOver={(event) => event.preventDefault()}
        >
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-800">{title}</h3>
          <span className="text-xs text-slate-500">{issues.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {canManageColumn && (
            <div className="relative">
              <button
                type="button"
                className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] text-slate-700 hover:border-blue-500"
                onClick={() => setShowColumnMenu((current) => !current)}
              >
                ...
              </button>
              {showColumnMenu && (
                <div className="absolute right-0 z-20 mt-1 w-28 rounded border border-slate-300 bg-white p-1 shadow-lg">
                  {!isDoneColumn && (
                    <button
                      type="button"
                      className="block w-full rounded px-2 py-1 text-left text-xs text-red-700 hover:bg-red-50"
                      onClick={() => {
                        onDeleteColumn?.(columnStatusId || columnId)
                        setShowColumnMenu(false)
                      }}
                    >
                      Delete
                    </button>
                  )}
                  <button
                    type="button"
                    className="block w-full rounded px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100"
                    onClick={() => setShowColumnMenu(false)}
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          )}
          {showCreateButton && (
            <button
              type="button"
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-blue-500 hover:text-blue-700"
              onClick={() => onCreateIssue?.(columnStatusId)}
            >
              + Create
            </button>
          )}
        </div>
      </div>
      <div className="space-y-3">
        {issues.length === 0 && (emptyContent || <p className="text-sm text-slate-600">No issues.</p>)}
        {issues.map((issue) => (
          <div
            key={issue.id}
            className="rounded-md border border-slate-200 bg-white p-3 shadow-sm"
            draggable={canTransitionIssues}
            onDragStart={(event) => {
              if (!canTransitionIssues) return
              event.dataTransfer.setData('text/plain', issue.id)
              onDragStart?.(issue.id)
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <button
                className={`text-left text-sm font-medium hover:text-blue-700 ${String(issue.status).toLowerCase().includes('done') ? 'text-slate-500 line-through' : 'text-slate-900'}`}
                onClick={() => onOpenIssue?.(issue.id)}
              >
                {issue.title}
              </button>
              <div className="relative" onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-[10px] text-slate-700 hover:border-blue-500"
                  onClick={() => setOpenMenuIssueId((current) => (current === issue.id ? '' : issue.id))}
                >
                  ...
                </button>
                {openMenuIssueId === issue.id && (
                  <div className="absolute right-0 z-10 mt-1 w-32 rounded border border-slate-300 bg-white p-1 shadow-lg">
                    <button
                      type="button"
                      className="block w-full rounded px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100"
                      onClick={() => {
                        onOpenIssueLink?.(issue.id)
                        setOpenMenuIssueId('')
                      }}
                    >
                      Open link
                    </button>
                    <button
                      type="button"
                      className="block w-full rounded px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100"
                      onClick={() => {
                        onCopyIssueLink?.(issue.id)
                        setOpenMenuIssueId('')
                      }}
                    >
                      Copy link
                    </button>
                    {showIssueActions && (
                      <>
                        <button
                          type="button"
                          className="block w-full rounded px-2 py-1 text-left text-xs text-amber-300 hover:bg-amber-900/40"
                          onClick={() => {
                            onArchiveIssue?.(issue.id)
                            setOpenMenuIssueId('')
                          }}
                        >
                          Archive
                        </button>
                        <button
                          type="button"
                          className="block w-full rounded px-2 py-1 text-left text-xs text-red-300 hover:bg-red-900/40"
                          onClick={() => {
                            onDeleteIssue?.(issue.id)
                            setOpenMenuIssueId('')
                          }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-2">
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                {formatWorkType(issue.work_type || issue.issue_type)}
              </span>
            </div>
            <p className="mt-2 text-xs uppercase tracking-wide text-slate-400">
              {issue.issue_key}
            </p>
            <p className="mt-1 text-xs text-slate-600">{issue.priority} - {issue.assignee || 'Unassigned'}</p>
            {issue.labels?.length > 0 && (
              <p className="mt-1 text-xs text-slate-600">{issue.labels.join(', ')}</p>
            )}
            <select
              className="mt-3 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
              value={issue.status}
              disabled={!canTransitionIssues}
              onChange={(event) => onTransition(issue.id, event.target.value)}
            >
              {selectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}
