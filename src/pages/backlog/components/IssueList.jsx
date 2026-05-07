export default function IssueList({
  title,
  issues,
  isLoading,
  sprints = [],
  workflowStates = [],
  selectedIssueIds = [],
  onToggleIssue,
  onOpenIssue,
  onTransition,
  onAssignSprint,
  onRemoveSprint,
}) {
  if (isLoading) {
    return <p className="text-sm text-slate-500">Loading issues...</p>
  }

  if (!issues.length) {
    return <p className="text-sm text-slate-500">No issues yet.</p>
  }

  return (
    <div>
      {title && <p className="mb-3 text-sm font-semibold text-slate-700">{title}</p>}
      <div className="space-y-3">
      {issues.map((issue) => (
        <div key={issue.id} className="rounded border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {onToggleIssue && (
                <input
                  type="checkbox"
                  checked={selectedIssueIds.includes(issue.id)}
                  onChange={() => onToggleIssue(issue.id)}
                />
              )}
              <button className="text-left text-sm font-semibold hover:underline" onClick={() => onOpenIssue?.(issue.id)}>
              {issue.issue_key} · {issue.title}
              </button>
            </div>
            <span className="rounded bg-slate-100 px-2 py-1 text-xs uppercase">{issue.status}</span>
          </div>
          <p className="mb-3 text-sm text-slate-600">{issue.description || 'No description'}</p>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs text-slate-500 uppercase">
              {issue.issue_type} · {issue.priority} {issue.story_points ? `· ${issue.story_points}sp` : ''}
            </p>
            <p className="text-xs text-slate-500">{issue.assignee || 'Unassigned'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!!workflowStates.length && (
              <select
                className="rounded border border-slate-300 px-2 py-1 text-xs"
                value={issue.status}
                onChange={(event) => onTransition(issue.id, event.target.value)}
              >
                {workflowStates.map((state) => (
                  <option key={state.id} value={state.id}>
                    Move to {state.name}
                  </option>
                ))}
              </select>
            )}
            <select
              className="rounded border border-slate-300 px-2 py-1 text-xs"
              value={issue.sprint_id || ''}
              onChange={(event) => {
                const sprintId = event.target.value
                if (!sprintId) {
                  onRemoveSprint(issue.id)
                  return
                }
                onAssignSprint(issue.id, sprintId)
              }}
            >
              <option value="">Backlog</option>
              {sprints.map((sprint) => (
                <option key={sprint.id} value={sprint.id}>
                  {sprint.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}
      </div>
    </div>
  )
}
