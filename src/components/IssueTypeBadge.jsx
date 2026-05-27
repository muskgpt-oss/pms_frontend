import React from 'react'

export default function IssueTypeBadge({ type, showText = true, className = '' }) {
  const normalized = String(type || '').trim().toLowerCase()

  let style = 'bg-slate-800/80 text-slate-300 border-slate-700'
  let label = 'Task'
  let symbol = '✓'

  if (normalized === 'epic') {
    style = 'bg-purple-950/40 text-purple-300 border-purple-800/60'
    label = 'Epic'
    symbol = '⚡'
  } else if (normalized === 'feature') {
    style = 'bg-amber-950/40 text-amber-300 border-amber-800/60'
    label = 'Feature'
    symbol = '★'
  } else if (normalized === 'story' || normalized === 'user story') {
    style = 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60'
    label = 'Story'
    symbol = '📗'
  } else if (normalized === 'bug') {
    style = 'bg-rose-950/40 text-rose-300 border-rose-800/60'
    label = 'Bug'
    symbol = '🐞'
  } else if (normalized === 'subtask' || normalized === 'sub-task' || normalized === 'sub tasks') {
    style = 'bg-sky-950/40 text-sky-300 border-sky-800/60'
    label = 'Subtask'
    symbol = '⤏'
  } else if (normalized === 'task' || normalized === 'issue') {
    style = 'bg-blue-950/40 text-blue-300 border-blue-800/60'
    label = normalized === 'issue' ? 'Issue' : 'Task'
    symbol = '✓'
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${style} ${className}`}>
      <span className="text-xs leading-none select-none">{symbol}</span>
      {showText && <span>{label}</span>}
    </span>
  )
}
