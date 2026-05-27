import { useState } from 'react'
import IssueTypeBadge from '../../../components/IssueTypeBadge'

// Reusable custom SVGs for priority levels
const PriorityIcon = ({ priority }) => {
  const p = String(priority || '').toLowerCase()
  if (p.includes('high') || p.includes('crit') || p.includes('block')) {
    return (
      <span title={`Priority: ${priority}`} className="inline-flex items-center text-rose-600">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4 15h6v7h4v-7h6L12 5z" />
        </svg>
      </span>
    )
  }
  if (p.includes('low') || p.includes('triv')) {
    return (
      <span title={`Priority: ${priority}`} className="inline-flex items-center text-sky-555">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 9h-6V2h-4v7H4l8 10z" />
        </svg>
      </span>
    )
  }
  // Medium or default
  return (
    <span title={`Priority: ${priority}`} className="inline-flex items-center text-amber-600">
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20 9H4v2h16V9zm0 4H4v2h16v-2z" />
      </svg>
    </span>
  )
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
  if (!name || name.toLowerCase() === 'unassigned') return 'bg-slate-100 text-slate-500 border-slate-200'
  const colors = [
    'bg-blue-100 text-blue-700 border-blue-200/60',
    'bg-emerald-100 text-emerald-700 border-emerald-200/60',
    'bg-indigo-100 text-indigo-700 border-indigo-200/60',
    'bg-violet-100 text-violet-700 border-violet-200/60',
    'bg-amber-100 text-amber-700 border-amber-200/60',
    'bg-rose-100 text-rose-700 border-rose-200/60',
    'bg-cyan-100 text-cyan-700 border-cyan-200/60',
  ]
  let sum = 0
  for (let i = 0; i < name.length; i++) {
    sum += name.charCodeAt(i)
  }
  return colors[sum % colors.length]
}

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
  const [isOver, setIsOver] = useState(false)

  const selectOptions = statusOptions.length
    ? statusOptions
    : allStates.map((state) => ({ value: state.id, label: state.name }))

  const handleDrop = (event) => {
    event.preventDefault()
    setIsOver(false)
    const sourceColumnStatusId = event.dataTransfer.getData('text/column-status-id')
    if (sourceColumnStatusId) {
      onColumnDrop?.(columnStatusId || columnId, sourceColumnStatusId)
      return
    }
    const issueId = event.dataTransfer.getData('text/plain') || draggedIssueId
    if (!issueId || !columnStatusId) return
    onDropIssue?.(issueId, columnStatusId)
  }

  const isDoneColumn = String(columnStatusId || columnId || '').trim().toLowerCase() === 'done'

  return (
    <div
      className={`rounded border p-3 shadow-xs transition-all duration-200 ${
        isOver
          ? 'border-brand-blue bg-[#deebff]/40 scale-[1.01]'
          : 'border-brand-border bg-[#f4f5f7]'
      } ${className}`}
      onDragOver={(event) => {
        event.preventDefault()
        setIsOver(true)
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={handleDrop}
    >
      {/* Column Header */}
      <div className="mb-3.5 flex items-center justify-between gap-2 border-b border-brand-border pb-2">
        <div
          className={`flex items-center gap-2 ${canManageColumn ? 'cursor-grab active:cursor-grabbing' : ''}`}
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
          <h3 className="text-xs font-bold uppercase tracking-wider text-brand-navy">{title}</h3>
          <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] rounded-full bg-[#ebecf0] border border-brand-border text-brand-slate text-[10px] font-bold px-1.5 select-none">
            {issues.length}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          {canManageColumn && (
            <div className="relative">
              <button
                type="button"
                className="p-1 rounded border border-brand-border bg-white hover:bg-brand-hover text-brand-slate transition-all cursor-pointer"
                onClick={() => setShowColumnMenu((current) => !current)}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="1" />
                  <circle cx="19" cy="12" r="1" />
                  <circle cx="5" cy="12" r="1" />
                </svg>
              </button>
              {showColumnMenu && (
                <div className="absolute right-0 z-20 mt-1.5 w-28 rounded border border-brand-border bg-white p-1 shadow-lg">
                  {!isDoneColumn && (
                    <button
                      type="button"
                      className="block w-full rounded px-2.5 py-1.5 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
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
                    className="block w-full rounded px-2.5 py-1.5 text-left text-xs font-semibold text-brand-slate hover:bg-brand-hover transition-colors cursor-pointer"
                    onClick={() => setShowColumnMenu(false)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
          {showCreateButton && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded border border-brand-border bg-white hover:bg-brand-hover px-2 py-1 text-xs font-semibold text-brand-slate hover:text-brand-blue transition-all shadow-sm cursor-pointer"
              onClick={() => onCreateIssue?.(columnStatusId)}
            >
              <svg className="w-3 h-3 text-brand-slate" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>Create</span>
            </button>
          )}
        </div>
      </div>

      {/* Issues list */}
      <div className="space-y-3 min-h-[150px]">
        {issues.length === 0 && (
          emptyContent || (
            <div className="flex flex-col items-center justify-center py-8 px-4 text-center border border-dashed border-brand-border rounded bg-white shadow-xs">
              <svg className="w-8 h-8 text-slate-300 mb-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="text-xs font-bold text-brand-navy">Empty Column</p>
              <p className="text-[10px] text-brand-slate mt-1 max-w-[150px] leading-normal">Drag tasks here or click the "+" button.</p>
            </div>
          )
        )}
        
        {issues.map((issue) => {
          const isDone = String(issue.status).toLowerCase().includes('done') || String(issue.status).toLowerCase().includes('completed')
          return (
            <div
              key={issue.id}
              className="group relative rounded-[3px] border border-brand-border bg-white p-3 shadow-sm hover:shadow-md transition-all duration-150 border-l-4 hover:border-l-brand-blue cursor-grab active:cursor-grabbing hover:scale-[1.01]"
              style={{
                borderLeftColor:
                  issue.work_type === 'epic' || issue.issue_type === 'epic' ? '#a855f7' :
                  issue.work_type === 'bug' || issue.issue_type === 'bug' ? '#f43f5e' :
                  issue.work_type === 'story' || issue.issue_type === 'story' || issue.work_type === 'user story' ? '#10b981' :
                  issue.work_type === 'feature' || issue.issue_type === 'feature' ? '#f59e0b' : '#3b82f6'
              }}
              draggable={canTransitionIssues}
              onDragStart={(event) => {
                if (!canTransitionIssues) return
                event.dataTransfer.setData('text/plain', issue.id)
                onDragStart?.(issue.id)
              }}
            >
              {/* Card top row */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5">
                  <IssueTypeBadge type={issue.work_type || issue.issue_type} showText={false} />
                  <span className="text-[10px] font-bold text-brand-slate tracking-wider uppercase select-none">
                    {issue.issue_key}
                  </span>
                </div>
                
                <div className="relative" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    className="p-0.5 rounded text-slate-400 hover:text-brand-navy hover:bg-brand-hover transition-colors cursor-pointer"
                    onClick={() => setOpenMenuIssueId((current) => (current === issue.id ? '' : issue.id))}
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="1" />
                      <circle cx="19" cy="12" r="1" />
                      <circle cx="5" cy="12" r="1" />
                    </svg>
                  </button>
                  {openMenuIssueId === issue.id && (
                    <div className="absolute right-0 z-30 mt-1 w-32 rounded border border-brand-border bg-white p-1 shadow-lg">
                      <button
                        type="button"
                        className="block w-full rounded px-2 py-1 text-left text-xs font-semibold text-brand-navy hover:bg-brand-hover transition-colors cursor-pointer"
                        onClick={() => {
                          onOpenIssueLink?.(issue.id)
                          setOpenMenuIssueId('')
                        }}
                      >
                        Open link
                      </button>
                      <button
                        type="button"
                        className="block w-full rounded px-2 py-1 text-left text-xs font-semibold text-brand-navy hover:bg-brand-hover transition-colors cursor-pointer"
                        onClick={() => {
                          onCopyIssueLink?.(issue.id)
                          setOpenMenuIssueId('')
                        }}
                      >
                        Copy link
                      </button>
                      {showIssueActions && (
                        <>
                          <div className="my-1 border-t border-brand-border" />
                          <button
                            type="button"
                            className="block w-full rounded px-2 py-1 text-left text-xs font-semibold text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer"
                            onClick={() => {
                              onArchiveIssue?.(issue.id)
                              setOpenMenuIssueId('')
                            }}
                          >
                            Archive
                          </button>
                          <button
                            type="button"
                            className="block w-full rounded px-2 py-1 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
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

              {/* Title / Summary */}
              <div className="mb-2">
                <button
                  type="button"
                  className={`text-left text-[13px] font-semibold hover:text-brand-blue block w-full transition-colors leading-snug ${
                    isDone
                      ? 'text-[#7a869a] line-through decoration-slate-400'
                      : 'text-brand-navy'
                  }`}
                  onClick={() => onOpenIssue?.(issue.id)}
                >
                  {issue.title}
                </button>
              </div>

              {/* Labels (if any) */}
              {issue.labels?.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2.5">
                  {issue.labels.map((lbl) => (
                    <span
                      key={lbl}
                      className="rounded-[3px] bg-brand-gray-light border border-brand-border text-brand-slate px-1.5 py-0.5 text-[9px] font-semibold select-none"
                    >
                      {lbl}
                    </span>
                  ))}
                </div>
              )}

              {/* Bottom row: priority, story points, assignee */}
              <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-brand-border">
                <div className="flex items-center gap-2">
                  <PriorityIcon priority={issue.priority} />
                  {issue.story_points !== undefined && issue.story_points !== null && (
                    <span
                      title="Story Points"
                      className="inline-flex items-center justify-center min-w-[20px] h-[20px] rounded-full bg-brand-gray-light border border-brand-border text-brand-navy text-[10px] font-bold px-1 select-none"
                    >
                      {issue.story_points}
                    </span>
                  )}
                </div>
                
                <div
                  title={issue.assignee || 'Unassigned'}
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border shadow-sm ${getAvatarColorClass(
                    issue.assignee
                  )}`}
                >
                  {getInitials(issue.assignee)}
                </div>
              </div>

              {/* Transition Dropdown */}
              {canTransitionIssues && (
                <div className="mt-2.5">
                  <select
                    className="w-full rounded border border-brand-border bg-white px-2 py-1 text-[11px] font-semibold text-brand-slate hover:border-[#a5adba] hover:text-brand-navy transition-all cursor-pointer focus:outline-none"
                    value={issue.status}
                    disabled={!canTransitionIssues}
                    onChange={(event) => onTransition(issue.id, event.target.value)}
                  >
                    {selectOptions.map((option) => (
                      <option key={option.value} value={option.value} className="bg-white text-brand-navy">
                        Status: {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
