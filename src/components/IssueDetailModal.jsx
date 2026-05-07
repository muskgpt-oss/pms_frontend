import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addIssueComment,
  archiveIssue,
  fetchIssue,
  fetchIssueComments,
  fetchIssueHistory,
  transitionIssue,
  updateIssue,
} from '../services/issueApi'
import { getApiErrorMessage } from '../services/apiClient'
import { inviteProjectMember } from '../services/projectApi'

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function toTimeline(history = [], comments = []) {
  const historyItems = history.map((item) => ({
    id: `h-${item.id}`,
    type: 'history',
    created_at: item.created_at,
    data: item,
  }))
  const commentItems = comments.map((item) => ({
    id: `c-${item.id}`,
    type: 'comment',
    created_at: item.created_at,
    data: item,
  }))

  return [...historyItems, ...commentItems].sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  )
}

function buildFieldPattern(fieldName = '') {
  return String(fieldName)
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '[\\s_-]*')
}

function parseDetailField(description = '', fieldName = '', aliases = []) {
  const normalized = String(description).replace(/\r\n/g, '\n')
  const candidates = [fieldName, ...aliases].filter(Boolean)

  for (const candidate of candidates) {
    const regex = new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?${buildFieldPattern(candidate)}(?:\\*\\*)?\\s*[:=-]\\s*([^\\n]+)`, 'i')
    const match = normalized.match(regex)
    if (match?.[1]) {
      return match[1].trim()
    }
  }

  return ''
}

function displayTransitionName(value = '') {
  return String(value).replace(/^move to\s+/i, '')
}

function prettyLabel(value = '') {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (part) => part.toUpperCase())
}

function timeAgo(value) {
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return ''
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function renderHistoryItem(item) {
  const event = item?.data || {}
  const actor = event.user_id || 'System'
  const payload = event.payload || {}

  if (event.event_type === 'issue_created') {
    return (
      <>
        <p className="text-sm font-semibold text-slate-900">{actor} created the Work item</p>
        <p className="mt-1 text-xs text-slate-600">{timeAgo(item.created_at)}</p>
      </>
    )
  }

  if (event.event_type === 'transition') {
    return (
      <>
        <p className="text-sm font-semibold text-slate-900">{actor} changed the Status</p>
        <p className="mt-1 text-xs text-slate-600">{timeAgo(item.created_at)}</p>
        <div className="mt-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
          <span className="rounded border border-slate-300 bg-white px-2 py-0.5 text-slate-700">{prettyLabel(payload.from_status)}</span>
          <span className="text-slate-500">-&gt;</span>
          <span className="rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-blue-700">{prettyLabel(payload.to_status)}</span>
        </div>
      </>
    )
  }

  if (event.event_type === 'field_changed') {
    const firstChange = event.payload?.changes?.[0]
    return (
      <>
        <p className="text-sm font-semibold text-slate-900">{actor} updated {prettyLabel(firstChange?.field || 'fields')}</p>
        <p className="mt-1 text-xs text-slate-600">{timeAgo(item.created_at)}</p>
      </>
    )
  }

  return (
    <>
      <p className="text-sm font-semibold text-slate-900">{actor} updated the issue</p>
      <p className="mt-1 text-xs text-slate-600">{timeAgo(item.created_at)}</p>
    </>
  )
}

export default function IssueDetailModal({ issueId, onClose }) {
  const queryClient = useQueryClient()
  const [commentBody, setCommentBody] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [assigneeDraft, setAssigneeDraft] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')

  const issueQuery = useQuery({
    queryKey: ['issue', issueId],
    queryFn: () => fetchIssue({ issueId }),
    enabled: Boolean(issueId),
  })

  const historyQuery = useQuery({
    queryKey: ['issue-history', issueId],
    queryFn: () => fetchIssueHistory({ issueId }),
    enabled: Boolean(issueId),
  })

  const commentsQuery = useQuery({
    queryKey: ['issue-comments', issueId],
    queryFn: () => fetchIssueComments({ issueId }),
    enabled: Boolean(issueId),
  })

  const issue = issueQuery.data

  useEffect(() => {
    if (!issue) return
    setDescriptionDraft(issue.description || '')
    setAssigneeDraft(issue.assignee || '')
  }, [issue])

  const refreshRelated = () => {
    if (!issue?.project_id) return
    queryClient.invalidateQueries({ queryKey: ['issue', issueId] })
    queryClient.invalidateQueries({ queryKey: ['issue-history', issueId] })
    queryClient.invalidateQueries({ queryKey: ['issue-comments', issueId] })
    queryClient.invalidateQueries({ queryKey: ['backlog', issue.project_id] })
    queryClient.invalidateQueries({ queryKey: ['board', issue.project_id] })
    queryClient.invalidateQueries({ queryKey: ['issues', issue.project_id] })
  }

  const patchMutation = useMutation({
    mutationFn: updateIssue,
    onSuccess: refreshRelated,
  })

  const transitionMutation = useMutation({
    mutationFn: transitionIssue,
    onSuccess: refreshRelated,
  })

  const commentMutation = useMutation({
    mutationFn: addIssueComment,
    onSuccess: () => {
      setCommentBody('')
      refreshRelated()
    },
  })

  const archiveMutation = useMutation({
    mutationFn: archiveIssue,
    onSuccess: () => {
      refreshRelated()
      onClose()
    },
  })

  const inviteMutation = useMutation({
    mutationFn: ({ projectId, email }) => inviteProjectMember({ projectId, email }),
  })

  const timeline = useMemo(
    () => toTimeline(historyQuery.data || [], commentsQuery.data || []),
    [historyQuery.data, commentsQuery.data]
  )

  const derivedDetails = useMemo(() => {
    const description = issue?.description || ''
    return {
      parent: parseDetailField(description, 'Parent'),
      team: parseDetailField(description, 'Team'),
      version: parseDetailField(description, 'Version'),
      reporter: parseDetailField(description, 'Reporter') || issue?.reporter || '',
      startDate: parseDetailField(description, 'Start date', ['Start Date', 'start_date']),
      dueDate: parseDetailField(description, 'Due date', ['Due Date', 'due_date']),
      linked: parseDetailField(description, 'Linked work item'),
      workType: parseDetailField(description, 'Work type (selected)') || issue?.work_type || issue?.issue_type || '',
    }
  }, [issue])

  if (!issueId) return null

  return (
    <div className="fixed inset-0 z-50 flex bg-black/50">
      <div className="ml-auto h-full w-full max-w-5xl overflow-y-auto bg-[#0b1220] p-6 text-slate-100 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{issue?.issue_key || 'Loading...'}</p>
            <h2 className="text-3xl font-bold text-slate-100">{issue?.title || 'Issue detail'}</h2>
          </div>
          <button className="rounded border border-slate-600 bg-[#111827] px-3 py-1 text-sm font-semibold text-slate-200" onClick={onClose}>
            Close
          </button>
        </div>

        {issueQuery.error && <p className="mb-3 text-sm text-red-600">{getApiErrorMessage(issueQuery.error)}</p>}

        {!issue ? (
          <p className="text-sm text-slate-500">Loading issue...</p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <div className="rounded border border-slate-700 bg-[#111827] p-4">
                <p className="mb-2 text-sm font-bold text-slate-100">Description</p>
                <textarea
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  rows={6}
                  value={descriptionDraft}
                  onChange={(event) => setDescriptionDraft(event.target.value)}
                  onBlur={() =>
                    patchMutation.mutate({
                      issueId,
                      payload: {
                        description: descriptionDraft,
                        expected_updated_at: issue.updated_at,
                      },
                    })
                  }
                />
              </div>

              <div className="mt-4 rounded border border-slate-700 bg-[#111827] p-4">
                <p className="mb-3 text-sm font-bold text-slate-100">Details</p>
                <div className="grid gap-2 text-sm md:grid-cols-2">
                  <p><span className="font-semibold text-slate-300">Work Type:</span> <span className="text-slate-100">{formatValue(derivedDetails.workType)}</span></p>
                  <p><span className="font-semibold text-slate-300">Assignee:</span> <span className="text-slate-100">{formatValue(issue.assignee)}</span></p>
                  <p><span className="font-semibold text-slate-300">Reporter:</span> <span className="text-slate-100">{formatValue(derivedDetails.reporter)}</span></p>
                  <p><span className="font-semibold text-slate-300">Parent:</span> <span className="text-slate-100">{formatValue(derivedDetails.parent)}</span></p>
                  <p><span className="font-semibold text-slate-300">Start Date:</span> <span className="text-slate-100">{formatValue(derivedDetails.startDate)}</span></p>
                  <p><span className="font-semibold text-slate-300">Due Date:</span> <span className="text-slate-100">{formatValue(derivedDetails.dueDate)}</span></p>
                  <p><span className="font-semibold text-slate-300">Team:</span> <span className="text-slate-100">{formatValue(derivedDetails.team)}</span></p>
                  <p><span className="font-semibold text-slate-300">Version:</span> <span className="text-slate-100">{formatValue(derivedDetails.version)}</span></p>
                  <p className="md:col-span-2"><span className="font-semibold text-slate-300">Labels:</span> <span className="text-slate-100">{formatValue(issue.labels)}</span></p>
                  <p className="md:col-span-2"><span className="font-semibold text-slate-300">Linked Work Item:</span> <span className="text-slate-100">{formatValue(derivedDetails.linked)}</span></p>
                </div>
              </div>

              <div className="mt-6 rounded border border-slate-700 bg-[#111827] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-bold text-slate-100">Activity</p>
                  <div className="inline-flex items-center gap-2 text-xs font-medium">
                    <span className="rounded border border-blue-300 bg-blue-50 px-2 py-1 text-blue-700">All</span>
                    <span className="text-slate-500">Comments</span>
                    <span className="text-slate-500">History</span>
                  </div>
                </div>
                <div className="space-y-3">
                  {timeline.length === 0 && <p className="text-sm text-slate-500">No activity yet.</p>}
                  {timeline.map((item) => (
                    <div key={item.id} className="rounded border border-slate-700 bg-[#0f172a] p-3 text-sm">
                      {item.type === 'comment' ? (
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{item.data.author_id} commented</p>
                          <p className="mt-1 text-xs text-slate-600">{timeAgo(item.created_at)}</p>
                          <p className="mt-2 whitespace-pre-wrap text-slate-800">{item.data.body}</p>
                        </div>
                      ) : (
                        <div>{renderHistoryItem(item)}</div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-4 border-t border-slate-200 pt-4">
                  <p className="mb-2 text-sm font-bold text-slate-100">Add comment</p>
                  <textarea
                    className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    rows={3}
                    value={commentBody}
                    onChange={(event) => setCommentBody(event.target.value)}
                    placeholder="Write a comment..."
                  />
                  <button
                    className="mt-2 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
                    onClick={() => commentMutation.mutate({ issueId, payload: { body: commentBody, author_id: 'current-user' } })}
                    disabled={!commentBody.trim() || commentMutation.isPending}
                  >
                    {commentMutation.isPending ? 'Posting...' : 'Post comment'}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded border border-slate-700 bg-[#111827] p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Status</p>
                <p className="text-sm font-semibold text-blue-700">{prettyLabel(issue.status)}</p>
              </div>
              <div className="rounded border border-slate-700 bg-[#111827] p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Assignee</p>
                <input
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                  value={assigneeDraft}
                  onChange={(event) => setAssigneeDraft(event.target.value)}
                  onBlur={(event) =>
                    patchMutation.mutate({
                      issueId,
                      payload: {
                        assignee: event.target.value || null,
                        expected_updated_at: issue.updated_at,
                      },
                    })
                  }
                  placeholder="Unassigned"
                />
                <div className="mt-3 border-t border-slate-200 pt-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Invite Member by Email</p>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="member@company.com"
                    />
                    <button
                      type="button"
                      className="rounded bg-blue-600 px-2 py-1 text-xs font-semibold text-white"
                      disabled={!issue?.project_id || !inviteEmail.trim() || inviteMutation.isPending}
                      onClick={() => inviteMutation.mutate({ projectId: issue.project_id, email: inviteEmail.trim() })}
                    >
                      {inviteMutation.isPending ? 'Sending...' : 'Invite'}
                    </button>
                  </div>
                  {inviteMutation.error && (
                    <p className="mt-2 text-xs text-red-600">{getApiErrorMessage(inviteMutation.error)}</p>
                  )}
                  {inviteMutation.data && (
                    <p className="mt-2 text-xs text-emerald-700">
                      {inviteMutation.data.already_member ? 'Member already exists in project.' : 'Invite email sent successfully.'}
                    </p>
                  )}
                </div>
              </div>
              <div className="rounded border border-slate-700 bg-[#111827] p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Priority</p>
                <select
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                  value={issue.priority}
                  onChange={(event) =>
                    patchMutation.mutate({
                      issueId,
                      payload: {
                        priority: event.target.value,
                        expected_updated_at: issue.updated_at,
                      },
                    })
                  }
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div className="rounded border border-slate-700 bg-[#111827] p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Transitions</p>
                <div className="space-y-2">
                  {issue.available_transitions?.length ? (
                    issue.available_transitions.map((transition) => (
                      <button
                        key={transition.id}
                        className="w-full rounded bg-slate-900 px-2 py-1.5 text-xs font-semibold text-white"
                        onClick={() => transitionMutation.mutate({ issueId, status: transition.to_state_id })}
                      >
                        {displayTransitionName(transition.name)}
                      </button>
                    ))
                  ) : (
                    <p className="text-xs text-slate-500">No transitions</p>
                  )}
                </div>
              </div>
              <button
                className="w-full rounded bg-red-600 px-3 py-2 text-sm font-medium text-white"
                onClick={() => archiveMutation.mutate({ issueId })}
              >
                Archive issue
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
