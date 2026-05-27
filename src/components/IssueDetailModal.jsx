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
import { inviteProjectMember, fetchProjects } from '../services/projectApi'
import IssueTypeBadge from './IssueTypeBadge'

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

function displayTransitionName(value = '') {
  return String(value).replace(/^move to\s+/i, '')
}

function prettyLabel(value = '') {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (part) => part.toUpperCase())
}

export default function IssueDetailModal({ issueId, onClose }) {
  const queryClient = useQueryClient()
  
  // Local drafts for fields
  const [titleDraft, setTitleDraft] = useState('')
  const [descriptionDraft, setDescriptionDraft] = useState('')
  const [commentBody, setCommentBody] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [activeActivityTab, setActiveActivityTab] = useState('all') // all, comments, history
  
  // Queries
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

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    enabled: Boolean(issueId),
  })

  const issue = issueQuery.data
  const project = useMemo(() => {
    if (!issue || !projects.length) return null
    return projects.find((p) => p.id === issue.project_id)
  }, [issue, projects])

  const projectMembers = useMemo(() => {
    if (!project) return []
    // Combine lead and members
    const list = []
    if (project.lead) list.push(project.lead)
    if (Array.isArray(project.members)) {
      project.members.forEach((m) => {
        if (!list.includes(m)) list.push(m)
      })
    }
    return list
  }, [project])

  // Sync drafts when issue loads
  useEffect(() => {
    if (!issue) return
    setTitleDraft(issue.title || '')
    setDescriptionDraft(issue.description || '')
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

  // Format activity timeline
  const timeline = useMemo(() => {
    const historyItems = (historyQuery.data || []).map((item) => ({
      id: `h-${item.id}`,
      type: 'history',
      created_at: item.created_at,
      data: item,
    }))
    const commentItems = (commentsQuery.data || []).map((item) => ({
      id: `c-${item.id}`,
      type: 'comment',
      created_at: item.created_at,
      data: item,
    }))

    return [...historyItems, ...commentItems]
      .filter((item) => {
        if (activeActivityTab === 'comments') return item.type === 'comment'
        if (activeActivityTab === 'history') return item.type === 'history'
        return true
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) // Sort newest first
  }, [historyQuery.data, commentsQuery.data, activeActivityTab])

  if (!issueId) return null

  const handleTitleBlur = () => {
    if (titleDraft.trim() && titleDraft !== issue?.title) {
      patchMutation.mutate({
        issueId,
        payload: {
          title: titleDraft.trim(),
          expected_updated_at: issue.updated_at,
        },
      })
    }
  }

  const handleDescriptionBlur = () => {
    if (descriptionDraft !== issue?.description) {
      patchMutation.mutate({
        issueId,
        payload: {
          description: descriptionDraft,
          expected_updated_at: issue.updated_at,
        },
      })
    }
  }

  const handleFieldChange = (field, value) => {
    patchMutation.mutate({
      issueId,
      payload: {
        [field]: value,
        expected_updated_at: issue.updated_at,
      },
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-black/60 backdrop-blur-xs">
      <div className="ml-auto h-full w-full max-w-5xl overflow-y-auto bg-white border-l border-brand-border shadow-2xl flex flex-col text-brand-navy">
        
        {/* Modal Header */}
        <header className="flex items-center justify-between border-b border-brand-border bg-white px-6 py-4 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <IssueTypeBadge type={issue?.work_type || issue?.issue_type} showText={true} />
            <span className="text-brand-slate">/</span>
            <span className="text-sm font-semibold text-brand-blue">{issue?.issue_key}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="rounded bg-red-650 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
              onClick={() => {
                if (confirm('Are you sure you want to archive this issue?')) {
                  archiveMutation.mutate({ issueId })
                }
              }}
            >
              Archive
            </button>
            <button className="btn-secondary py-1.5 px-3 text-xs" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        {issueQuery.error && (
          <div className="m-6 rounded border border-red-200 bg-red-55/5 p-4 text-sm text-red-600">
            {getApiErrorMessage(issueQuery.error)}
          </div>
        )}

        {!issue ? (
          <div className="flex-1 grid place-items-center">
            <p className="text-xs text-brand-slate">Loading work item details...</p>
          </div>
        ) : (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 overflow-hidden">
            
            {/* Left Column: Title, Description */}
            <div className="lg:col-span-2 p-6 overflow-y-auto space-y-6 border-r border-brand-border bg-white">
              
              {/* Title Input */}
              <div>
                <input
                  className="w-full text-2xl font-bold text-brand-navy bg-transparent border-none rounded px-2 py-1 focus:outline-none focus:bg-brand-gray-light focus:ring-1 focus:ring-brand-blue placeholder:text-slate-400"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={handleTitleBlur}
                  onKeyDown={(e) => e.key === 'Enter' && handleTitleBlur()}
                  placeholder="Summary of work"
                />
              </div>

              {/* Description Input */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-brand-slate block">Description</label>
                <textarea
                  className="w-full input-text"
                  rows={10}
                  value={descriptionDraft}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  onBlur={handleDescriptionBlur}
                  placeholder="Describe this issue in detail..."
                />
              </div>
            </div>

            {/* Right Column: Settings, Details & Activity Stream */}
            <div className="p-6 bg-brand-gray-light/40 border-l border-brand-border overflow-y-auto space-y-4">
              
              {/* Transitions Dropdown */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-brand-slate block">Status</label>
                <div className="relative">
                  <div className="flex flex-wrap gap-1">
                    <span className="rounded bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs font-semibold text-brand-blue uppercase tracking-wide inline-block shadow-sm">
                      {prettyLabel(issue.status)}
                    </span>
                  </div>
                  
                  {issue.available_transitions?.length > 0 && (
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {issue.available_transitions.map((tr) => (
                        <button
                          key={tr.id}
                          className="btn-secondary px-2.5 py-1.5 text-[11px] font-medium text-brand-slate hover:text-brand-navy text-left truncate shadow-sm"
                          onClick={() => transitionMutation.mutate({ issueId, status: tr.to_state_id })}
                          disabled={transitionMutation.isPending}
                        >
                          → {displayTransitionName(tr.name)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Sidebar properties list */}
              <div className="space-y-3.5 pt-4 border-t border-brand-border">
                <h4 className="text-xs font-bold uppercase tracking-wider text-brand-slate">Details</h4>

                {/* Work Type */}
                <div className="grid grid-cols-3 items-center text-xs">
                  <span className="text-brand-slate font-medium">Work Type</span>
                  <select
                    className="col-span-2 input-text py-1 px-2 text-xs"
                    value={issue.work_type || issue.issue_type}
                    onChange={(e) => handleFieldChange('issue_type', e.target.value)}
                  >
                    <option value="epic">EPIC</option>
                    <option value="feature">FEATURE</option>
                    <option value="story">STORY</option>
                    <option value="task">TASK</option>
                    <option value="subtask">SUBTASK</option>
                    <option value="bug">BUG</option>
                    <option value="issue">ISSUE</option>
                  </select>
                </div>

                {/* Assignee */}
                <div className="grid grid-cols-3 items-center text-xs">
                  <span className="text-brand-slate font-medium">Assignee</span>
                  <select
                    className="col-span-2 input-text py-1 px-2 text-xs"
                    value={issue.assignee || ''}
                    onChange={(e) => handleFieldChange('assignee', e.target.value || null)}
                  >
                    <option value="">Unassigned</option>
                    {projectMembers.map((email) => (
                      <option key={email} value={email}>{email}</option>
                    ))}
                  </select>
                </div>

                {/* Reporter */}
                <div className="grid grid-cols-3 items-center text-xs">
                  <span className="text-brand-slate font-medium">Reporter</span>
                  <input
                    className="col-span-2 input-text py-1 px-2 text-xs"
                    value={issue.reporter || ''}
                    onChange={(e) => handleFieldChange('reporter', e.target.value || null)}
                    placeholder="None"
                  />
                </div>

                {/* Story Points */}
                <div className="grid grid-cols-3 items-center text-xs">
                  <span className="text-brand-slate font-medium">Story Points</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    className="col-span-2 input-text py-1 px-2 text-xs"
                    value={issue.story_points ?? ''}
                    onChange={(e) => handleFieldChange('story_points', e.target.value ? Number(e.target.value) : null)}
                    placeholder="Unestimated"
                  />
                </div>

                {/* Start Date */}
                <div className="grid grid-cols-3 items-center text-xs">
                  <span className="text-brand-slate font-medium">Start Date</span>
                  <input
                    type="date"
                    className="col-span-2 input-text py-1 px-2 text-xs"
                    value={issue.start_date ? issue.start_date.split('T')[0] : ''}
                    onChange={(e) => handleFieldChange('start_date', e.target.value ? `${e.target.value}T00:00:00Z` : null)}
                  />
                </div>

                {/* Due Date */}
                <div className="grid grid-cols-3 items-center text-xs">
                  <span className="text-brand-slate font-medium">Due Date</span>
                  <input
                    type="date"
                    className="col-span-2 input-text py-1 px-2 text-xs"
                    value={issue.due_date ? issue.due_date.split('T')[0] : ''}
                    onChange={(e) => handleFieldChange('due_date', e.target.value ? `${e.target.value}T00:00:00Z` : null)}
                  />
                </div>

                {/* Labels */}
                <div className="grid grid-cols-3 items-start text-xs pt-1">
                  <span className="text-brand-slate mt-1 font-medium">Labels</span>
                  <div className="col-span-2 space-y-1.5">
                    <div className="flex flex-wrap gap-1">
                      {issue.labels?.filter(l => !l.startsWith('board:')).map((l, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1 rounded bg-blue-50 border border-blue-100 px-2 py-0.5 text-[10px] text-brand-blue font-medium shadow-sm">
                          {l}
                          <button
                            type="button"
                            className="text-brand-slate hover:text-brand-navy font-bold"
                            onClick={() => {
                              const nextLabels = issue.labels.filter((item) => item !== l)
                              handleFieldChange('labels', nextLabels)
                            }}
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        className="flex-1 input-text text-xs py-1 px-2"
                        placeholder="Add tag"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.target.value.trim()) {
                            const trimmed = e.target.value.trim().toLowerCase()
                            if (!issue.labels?.includes(trimmed)) {
                              handleFieldChange('labels', [...(issue.labels || []), trimmed])
                            }
                            e.target.value = ''
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Invite project members section */}
              <div className="pt-4 border-t border-brand-border space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-brand-slate block">Project Invites</label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 input-text text-xs py-1.5 px-2.5"
                    placeholder="email@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-primary py-1.5 px-3 text-xs"
                    disabled={!issue?.project_id || !inviteEmail.trim() || inviteMutation.isPending}
                    onClick={() => {
                      inviteMutation.mutate({ projectId: issue.project_id, email: inviteEmail.trim() }, {
                        onSuccess: () => {
                          setInviteEmail('')
                          alert('Invitation link sent via email!')
                        }
                      })
                    }}
                  >
                    Invite
                  </button>
                </div>
                {inviteMutation.error && (
                  <p className="text-[10px] text-red-650 font-semibold">{getApiErrorMessage(inviteMutation.error)}</p>
                )}
              </div>

              {/* Comments & Activity Stream */}
              <div className="space-y-4 pt-4 border-t border-brand-border">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-brand-slate">Activity</h3>
                    
                    <div className="inline-flex rounded border border-brand-border bg-brand-gray-light p-0.5 text-[10px] text-brand-slate">
                      <button
                        className={`px-2 py-0.5 rounded-sm ${activeActivityTab === 'all' ? 'bg-white text-brand-blue font-semibold shadow-sm' : 'hover:text-brand-navy'}`}
                        onClick={() => setActiveActivityTab('all')}
                      >
                        All
                      </button>
                      <button
                        className={`px-2 py-0.5 rounded-sm ${activeActivityTab === 'comments' ? 'bg-white text-brand-blue font-semibold shadow-sm' : 'hover:text-brand-navy'}`}
                        onClick={() => setActiveActivityTab('comments')}
                      >
                        Comments
                      </button>
                      <button
                        className={`px-2 py-0.5 rounded-sm ${activeActivityTab === 'history' ? 'bg-white text-brand-blue font-semibold shadow-sm' : 'hover:text-brand-navy'}`}
                        onClick={() => setActiveActivityTab('history')}
                      >
                        History
                      </button>
                    </div>
                  </div>
                </div>

                {/* Add Comment Input */}
                <div className="flex gap-2">
                  <div className="h-6 w-6 rounded-full bg-brand-blue flex items-center justify-center font-bold text-white text-[10px] select-none flex-shrink-0">
                    U
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <textarea
                      className="w-full input-text text-xs py-1.5 px-2"
                      rows={2}
                      value={commentBody}
                      onChange={(e) => setCommentBody(e.target.value)}
                      placeholder="Add a comment..."
                    />
                    {commentBody.trim() && (
                      <button
                        className="btn-primary py-1 px-2.5 text-[10px]"
                        onClick={() => commentMutation.mutate({ issueId, payload: { body: commentBody, author_id: 'current-user' } })}
                        disabled={commentMutation.isPending}
                      >
                        {commentMutation.isPending ? 'Saving...' : 'Save'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Stream list */}
                <div className="space-y-2.5 pt-2">
                  {timeline.length === 0 && (
                    <p className="text-xs text-brand-slate italic">No activity logs yet.</p>
                  )}
                  {timeline.map((item) => (
                    <div key={item.id} className="flex gap-2 text-[11px] border border-brand-border bg-brand-gray-light/20 p-2.5 rounded">
                      <div className="h-5 w-5 rounded-full bg-brand-blue flex items-center justify-center font-semibold text-white text-[9px] select-none flex-shrink-0">
                        {String(item.type === 'comment' ? item.data.author_id : (item.data.user_id || 'S')).slice(0, 1).toUpperCase()}
                      </div>
                      
                      <div className="flex-1 space-y-0.5 min-w-0">
                        <div className="flex justify-between items-center text-brand-slate text-[10px]">
                          <span className="font-semibold text-brand-navy truncate max-w-[120px]">
                            {item.type === 'comment' ? item.data.author_id : (item.data.user_id || 'System')}
                          </span>
                          <span className="flex-shrink-0">{timeAgo(item.created_at)}</span>
                        </div>
                        
                        {item.type === 'comment' ? (
                          <p className="text-brand-navy whitespace-pre-wrap mt-0.5 leading-relaxed break-words">{item.data.body}</p>
                        ) : (
                          <div className="text-brand-slate mt-0.5 break-words">
                            {item.data.event_type === 'issue_created' && (
                              <p>Created this issue</p>
                            )}
                            {item.data.event_type === 'transition' && (
                              <p>
                                Changed status from <span className="text-brand-navy font-semibold">{prettyLabel(item.data.payload.from_status)}</span> to <span className="text-brand-blue font-semibold">{prettyLabel(item.data.payload.to_status)}</span>
                              </p>
                            )}
                            {item.data.event_type === 'field_changed' && (
                              <div className="space-y-0.5">
                                {(item.data.payload?.changes || []).map((ch, idx) => (
                                  <p key={idx} className="break-words">
                                    Updated <span className="font-semibold text-brand-navy">{prettyLabel(ch.field)}</span> from <span className="line-through text-brand-slate">"{ch.from || 'None'}"</span> to <span className="text-green-700">"{ch.to || 'None'}"</span>
                                  </p>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

          </div>
        )}
      </div>
    </div>
  )
}
