import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMe } from './services/authApi'
import { forgotPassword } from './services/authApi'
import AuthOnboardingFlow from './components/AuthOnboardingFlow'
import BackNavigationButton from './components/BackNavigationButton'
import IssueDetailModal from './components/IssueDetailModal'
import CreateWorkItemModal from './components/CreateWorkItemModal'
import ProjectsPage from './pages/projects'
import BacklogPage from './pages/backlog'
import BoardPage from './pages/board'
import SprintsPage from './pages/sprints'
import { createProject, deleteProject, fetchProjectIssues, fetchProjects, inviteProjectMember } from './services/projectApi'
import { updateIssue } from './services/issueApi'
import { getApiErrorMessage } from './services/apiClient'

const BASE_TABS = [
  { key: 'summary', label: 'Summary' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'sprints', label: 'Sprint' },
  { key: 'board', label: 'Board' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'list', label: 'List' },
]

const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const helpLinks = [
  'Product updates',
  'How to use board and backlog',
  'Workflow setup guide',
  'Invite teammates',
  'Report a problem',
  'Keyboard shortcuts',
  'Get PMS mobile app',
]

const softwareTemplateOptions = [
  {
    id: 'kanban',
    label: 'Kanban',
    description: 'Continuous flow with To Do, In Progress, In Review, and Done columns.',
  },
  {
    id: 'scrum',
    label: 'Scrum',
    description: 'Sprint-based workflow with backlog and active sprint board.',
  },
]

const kanbanWorkflowTemplate = {
  states: [
    { id: 'todo', name: 'To Do', category: 'todo', color: '#0EA5E9', position: 0, is_initial: true },
    { id: 'in_progress', name: 'In Progress', category: 'in_progress', color: '#F59E0B', position: 1, is_initial: false },
    { id: 'in_review', name: 'In Review', category: 'in_progress', color: '#A855F7', position: 2, is_initial: false },
    { id: 'done', name: 'Done', category: 'done', color: '#22C55E', position: 3, is_initial: false },
  ],
  transitions: [
    { id: 'to_todo', name: 'Move to To Do', from_state_ids: ['*'], to_state_id: 'todo', conditions: [], post_functions: [], position: 0 },
    { id: 'to_in_progress', name: 'Move to In Progress', from_state_ids: ['*'], to_state_id: 'in_progress', conditions: [], post_functions: [], position: 1 },
    { id: 'to_in_review', name: 'Move to In Review', from_state_ids: ['*'], to_state_id: 'in_review', conditions: [], post_functions: [], position: 2 },
    { id: 'to_done', name: 'Move to Done', from_state_ids: ['*'], to_state_id: 'done', conditions: [], post_functions: [], position: 3 },
  ],
}

const buildWorkflowFromColumns = (columns = []) => {
  const fallback = ['To Do', 'In Progress', 'Done']
  const cleaned = (Array.isArray(columns) ? columns : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  const unique = []
  const seen = new Set()
  cleaned.forEach((entry) => {
    const normalized = entry.toLowerCase()
    if (seen.has(normalized)) return
    seen.add(normalized)
    unique.push(entry)
  })

  const finalColumns = unique.length >= 3 ? unique : fallback
  const states = finalColumns.map((name, index) => {
    const normalized = name.toLowerCase()
    const id = normalized
      .replace(/[^a-z0-9\s_-]/g, '')
      .trim()
      .replace(/[\s-]+/g, '_') || `state_${index + 1}`

    let category = 'in_progress'
    if (index === 0 || normalized.includes('todo') || normalized.includes('backlog')) category = 'todo'
    if (index === finalColumns.length - 1 || normalized.includes('done')) category = 'done'

    return {
      id,
      name,
      category,
      color: category === 'todo' ? '#0EA5E9' : category === 'done' ? '#22C55E' : '#F59E0B',
      position: index,
      is_initial: index === 0,
    }
  })

  const transitions = states.map((state, index) => ({
    id: `to_${state.id}_${index}`,
    name: `Move to ${state.name}`,
    from_state_ids: ['*'],
    to_state_id: state.id,
    conditions: [],
    post_functions: [],
    position: index,
  }))

  return { states, transitions }
}

const buildFieldPattern = (fieldName) => fieldName
  .trim()
  .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  .replace(/\s+/g, '[\\s_-]*')

const parseFieldFromDescription = (description, ...fieldNames) => {
  if (!description || typeof description !== 'string') return ''
  const normalized = description.replace(/\r\n/g, '\n')

  for (const fieldName of fieldNames) {
    if (!fieldName) continue
    const pattern = buildFieldPattern(fieldName)
    const regex = new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?${pattern}(?:\\*\\*)?\\s*[:=-]\\s*([^\\n]+)`, 'i')
    const match = normalized.match(regex)
    if (match?.[1]) {
      return match[1].trim()
    }
  }

  return ''
}

const parseDateValue = (value) => {
  if (!value || value === '-') return null
  const stringValue = String(value).trim()

  // Prefer explicit ISO token if mixed content exists (e.g. "2025-04-20, target").
  const isoMatch = stringValue.match(/(\d{4}-\d{2}-\d{2})/)
  if (isoMatch?.[1]) {
    const date = new Date(`${isoMatch[1]}T00:00:00`)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const parsed = new Date(stringValue)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const getIssueDate = (issue, primaryField, secondaryField) => {
  // Support potential future structured fields from API first.
  const directKeys = [
    primaryField?.replace(/\s+/g, '_').toLowerCase(),
    secondaryField?.replace(/\s+/g, '_').toLowerCase(),
  ].filter(Boolean)

  for (const key of directKeys) {
    const direct = issue?.[key]
    const directDate = parseDateValue(direct)
    if (directDate) return directDate
  }

  const normalizedPrimary = String(primaryField || '').toLowerCase()
  const aliases = normalizedPrimary.includes('start')
    ? ['Start Date', 'start_date', 'startdate']
    : ['Due Date', 'due_date', 'duedate']

  const value = parseFieldFromDescription(issue?.description, primaryField, secondaryField, ...aliases)

  return parseDateValue(value)
}

const formatIsoDate = (value) => {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const setDescriptionField = (description, key, value) => {
  const safeDescription = typeof description === 'string' ? description : ''
  const lines = safeDescription.split('\n').filter((line) => line.trim().length > 0)
  const fieldRegex = new RegExp(`^\\s*(?:[-*]\\s*)?${buildFieldPattern(key)}\\s*[:=-]`, 'i')
  let updated = false

  const nextLines = lines.map((line) => {
    if (fieldRegex.test(line)) {
      updated = true
      return `${key}: ${value}`
    }
    return line
  })

  if (!updated) {
    nextLines.push(`${key}: ${value}`)
  }

  return nextLines.join('\n')
}

export default function App() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('board')
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [openedIssueId, setOpenedIssueId] = useState('')
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createInitialStatus, setCreateInitialStatus] = useState('')
  const [showCreateProjectMenu, setShowCreateProjectMenu] = useState(false)
  const [showCreateProjectModal, setShowCreateProjectModal] = useState(false)
  const [currentBoardMode, setCurrentBoardMode] = useState('kanban')
  const [createBoardSource, setCreateBoardSource] = useState('kanban')
  const [openProjectActionMenuId, setOpenProjectActionMenuId] = useState('')
  const [selectedProjectTemplate, setSelectedProjectTemplate] = useState('scrum')
  const [projectForm, setProjectForm] = useState({
    name: '',
    key: '',
    description: '',
    lead: '',
  })
  const [zoomPercent, setZoomPercent] = useState(100)
  const [timelineSearch, setTimelineSearch] = useState('')
  const [boardSearch, setBoardSearch] = useState('')
  const [checkedTimelineItems, setCheckedTimelineItems] = useState({})
  const [timelineStartMonth, setTimelineStartMonth] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [calendarMonthDate, setCalendarMonthDate] = useState(() => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), 1)
  })
  const [calendarAssigneeFilter, setCalendarAssigneeFilter] = useState('')
  const [calendarStatusFilter, setCalendarStatusFilter] = useState('')
  const [draggingIssueId, setDraggingIssueId] = useState('')
  const [activeUtilityPanel, setActiveUtilityPanel] = useState('')
  const [notificationTab, setNotificationTab] = useState('actions')
  const [showSettingsMenu, setShowSettingsMenu] = useState(false)
  const [authPreferredMode, setAuthPreferredMode] = useState('signin')
  const isApplyingTabFromHistoryRef = useRef(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteProjectId, setInviteProjectId] = useState('')
  const [inviteRole, setInviteRole] = useState('')
  const [projectSearch, setProjectSearch] = useState('')
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [changePasswordValue, setChangePasswordValue] = useState('')
  const [changePasswordConfirm, setChangePasswordConfirm] = useState('')
  const [changePasswordMessage, setChangePasswordMessage] = useState('')

  const tabs = useMemo(() => {
    if (currentBoardMode === 'scrum') {
      return [...BASE_TABS, { key: 'backlog', label: 'Backlog' }]
    }
    return BASE_TABS
  }, [currentBoardMode])

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    enabled: Boolean(user),
  })

  const { data: issuesResponse = [] } = useQuery({
    queryKey: ['issues', selectedProjectId, 'dashboard-analytics'],
    queryFn: () => fetchProjectIssues({ projectId: selectedProjectId }),
    enabled: Boolean(selectedProjectId),
  })

  const createProjectMutation = useMutation({
    mutationFn: createProject,
    onSuccess: (createdProject) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setSelectedProjectId(createdProject.id)
      setActiveTab('board')
      setShowCreateProjectModal(false)
      setShowCreateProjectMenu(false)
      setProjectForm({ name: '', key: '', description: '', lead: '' })
    },
  })

  const deleteProjectMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      if (selectedProjectId === variables.projectId) {
        setSelectedProjectId('')
        setActiveTab('summary')
      }
    },
  })

  const updateIssueMutation = useMutation({
    mutationFn: updateIssue,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', selectedProjectId] })
      queryClient.invalidateQueries({ queryKey: ['backlog', selectedProjectId] })
      queryClient.invalidateQueries({ queryKey: ['board', selectedProjectId] })
    },
  })

  const inviteMemberMutation = useMutation({
    mutationFn: inviteProjectMember,
    onSuccess: () => {
      setInviteEmail('')
      setInviteRole('')
      setShowInviteModal(false)
    },
  })

  const changePasswordMutation = useMutation({
    mutationFn: forgotPassword,
    onSuccess: (response) => {
      setChangePasswordMessage(response?.message || 'Password updated successfully')
      setChangePasswordValue('')
      setChangePasswordConfirm('')
    },
  })

  const issues = useMemo(() => {
    if (Array.isArray(issuesResponse)) return issuesResponse
    if (Array.isArray(issuesResponse?.items)) return issuesResponse.items
    if (Array.isArray(issuesResponse?.results)) return issuesResponse.results
    return []
  }, [issuesResponse])

  const selectedProject = projects.find((project) => project.id === selectedProjectId)
  const projectMembers = useMemo(() => {
    if (!selectedProject) return []
    const list = []
    if (selectedProject.lead) {
      list.push(selectedProject.lead)
    }
    if (Array.isArray(selectedProject.members)) {
      selectedProject.members.forEach((m) => {
        if (m && !list.includes(m)) list.push(m)
      })
    }
    if (Array.isArray(selectedProject.member_roles)) {
      selectedProject.member_roles.forEach((m) => {
        if (m && m.email && !list.includes(m.email)) list.push(m.email)
      })
    }
    return list
  }, [selectedProject])
  const currentProjectRole = useMemo(() => {
    const email = String(user?.email || '').toLowerCase()
    if (!selectedProject || !email) return 'lead'

    if (String(selectedProject.lead || '').toLowerCase() === email) return 'lead'

    const roleMatch = (selectedProject.member_roles || []).find(
      (entry) => String(entry?.email || '').toLowerCase() === email
    )
    if (roleMatch?.role) return roleMatch.role

    const members = Array.isArray(selectedProject.members)
      ? selectedProject.members.map((entry) => String(entry).toLowerCase())
      : []
    if (members.includes(email)) return 'developer'
    return 'viewer'
  }, [selectedProject, user?.email])

  const recentSpaces = projects
  const projectTitle = selectedProject?.name || user?.space_name || 'Workspace'
  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase()
    if (!query) return projects
    return projects.filter((project) => {
      const target = `${project.name} ${project.key}`.toLowerCase()
      return target.includes(query)
    })
  }, [projectSearch, projects])
  const hasProjects = projects.length > 0
  const showNewDashboard = !hasProjects
  const profileInitial = (user?.username || user?.email || 'P').trim().charAt(0).toUpperCase() || 'P'
  const profileDescription = user?.space_name
    ? `Managing delivery and quality for ${user.space_name}.`
    : 'Managing delivery, blockers, and release quality across active projects.'

  useEffect(() => {
    if (!projects.length) {
      if (selectedProjectId) {
        setSelectedProjectId('')
      }
      return
    }

    const selectedProjectExists = projects.some((project) => project.id === selectedProjectId)
    if (selectedProjectExists) return

    const preferred = localStorage.getItem('pms_last_project_id')
    const match = preferred ? projects.find((project) => project.id === preferred) : null
    setSelectedProjectId(match?.id || projects[0].id)
    if (match) {
      localStorage.removeItem('pms_last_project_id')
    }
  }, [projects, selectedProjectId])

  useEffect(() => {
    localStorage.setItem('pms_project_role', currentProjectRole || 'viewer')
  }, [currentProjectRole])

  const summaryStats = useMemo(() => {
    const total = issues.length
    const completed = issues.filter((issue) => (issue.status || '').toLowerCase().includes('done')).length
    const updated = issues.filter((issue) => {
      const created = new Date(issue.created_at).getTime()
      const changed = new Date(issue.updated_at).getTime()
      return changed > created
    }).length
    const createdThisWeek = issues.filter((issue) => {
      const created = new Date(issue.created_at)
      const diffDays = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24)
      return diffDays <= 7
    }).length
    const dueSoon = issues.filter((issue) => {
      const dueDate = getIssueDate(issue, 'Due date', 'due date')
      if (!dueDate) return false
      const diffDays = (dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      return diffDays >= 0 && diffDays <= 7
    }).length

    const statusOverview = issues.reduce((acc, issue) => {
      const key = issue.status || 'unknown'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})

    const workType = issues.reduce((acc, issue) => {
      const key = issue.issue_type || 'task'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})

    const priority = issues.reduce((acc, issue) => {
      const key = issue.priority || 'medium'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})

    const assigneeLoad = issues.reduce((acc, issue) => {
      const key = issue.assignee || 'Unassigned'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})

    return {
      total,
      completed,
      updated,
      createdThisWeek,
      dueSoon,
      completionPercent: total ? Math.round((completed / total) * 100) : 0,
      statusOverview,
      workType,
      priority,
      assigneeLoad,
      epicProgress: workType.epic ? Math.min(100, Math.round((completed / workType.epic) * 100)) : 0,
    }
  }, [issues])

  const notificationItems = useMemo(() => {
    const items = []

    if (!projects.length) {
      items.push({
        id: 'setup-first-project',
        kind: 'actions',
        title: 'Set up your first project',
        detail: 'Start by creating a project and selecting a workflow template.',
        action: 'create-project',
        priority: 'high',
      })
    }

    const dueSoon = summaryStats.dueSoon || 0
    if (dueSoon > 0) {
      items.push({
        id: 'due-soon',
        kind: 'alerts',
        title: `${dueSoon} work item${dueSoon > 1 ? 's are' : ' is'} due in 7 days`,
        detail: 'Review due dates from the calendar and update priorities.',
        action: 'open-calendar',
        priority: 'high',
      })
    }

    const unassignedCount = issues.filter((issue) => !issue.assignee).length
    if (unassignedCount > 0) {
      items.push({
        id: 'unassigned-work',
        kind: 'actions',
        title: `${unassignedCount} unassigned item${unassignedCount > 1 ? 's' : ''}`,
        detail: 'Assign ownership to avoid work getting blocked.',
        action: 'open-list',
        priority: 'medium',
      })
    }

    const reviewCount = issues.filter((issue) => (issue.status || '').toLowerCase().includes('review')).length
    if (reviewCount > 0) {
      items.push({
        id: 'review-pending',
        kind: 'alerts',
        title: `${reviewCount} item${reviewCount > 1 ? 's are' : ' is'} pending review`,
        detail: 'Move reviewed work to done or request changes.',
        action: 'open-board',
        priority: 'medium',
      })
    }

    if (!items.length) {
      items.push({
        id: 'all-caught-up',
        kind: 'alerts',
        title: 'All clear for now',
        detail: 'No urgent actions detected. Keep shipping.',
        action: '',
        priority: 'low',
      })
    }

    return items
  }, [issues, projects.length, summaryStats.dueSoon])

  const timelineData = useMemo(() => {
    const months = monthLabels.map((label, index) => ({
      label,
      monthIndex: index,
      issues: [],
    }))

    issues.forEach((issue) => {
      const dueDate = getIssueDate(issue, 'Due date', 'due date')
      const startDate = getIssueDate(issue, 'Start date', 'start date')
      const baseDate = dueDate || startDate || new Date(issue.created_at)
      const monthIndex = baseDate.getMonth()
      months[monthIndex].issues.push(issue)
    })

    return months
  }, [issues])

  const timelineMonths = useMemo(() => {
    return Array.from({ length: 5 }).map((_, index) => {
      const current = new Date(timelineStartMonth.getFullYear(), timelineStartMonth.getMonth() + index, 1)
      return {
        key: `${current.getFullYear()}-${current.getMonth()}`,
        label: monthLabels[current.getMonth()],
        year: current.getFullYear(),
        monthIndex: current.getMonth(),
        start: current,
        end: new Date(current.getFullYear(), current.getMonth() + 1, 0),
      }
    })
  }, [timelineStartMonth])

  const timelineStart = timelineMonths[0]?.start
  const timelineEnd = timelineMonths[timelineMonths.length - 1]?.end

  const timelineRows = useMemo(() => {
    if (!timelineStart || !timelineEnd) return []
    const rangeStart = timelineStart.getTime()
    const rangeEnd = timelineEnd.getTime()
    const totalDays = Math.max(1, Math.round((rangeEnd - rangeStart) / (1000 * 60 * 60 * 24)) + 1)

    return issues
      .filter((issue) => {
        if (!timelineSearch.trim()) return true
        const target = `${issue.issue_key} ${issue.title}`.toLowerCase()
        return target.includes(timelineSearch.toLowerCase())
      })
      .map((issue) => {
        const startDate = getIssueDate(issue, 'Start date', 'start date')
        const dueDate = getIssueDate(issue, 'Due date', 'due date')
        if (!startDate || !dueDate) {
          return {
            issue,
            bar: null,
          }
        }

        const normalizedStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())
        const normalizedEnd = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate())
        const barStart = Math.max(normalizedStart.getTime(), rangeStart)
        const barEnd = Math.min(normalizedEnd.getTime(), rangeEnd)
        if (barEnd < rangeStart || barStart > rangeEnd || barStart > barEnd) {
          return { issue, bar: null }
        }

        const startOffsetDays = Math.round((barStart - rangeStart) / (1000 * 60 * 60 * 24))
        const durationDays = Math.max(1, Math.round((barEnd - barStart) / (1000 * 60 * 60 * 24)) + 1)

        return {
          issue,
          bar: {
            left: (startOffsetDays / totalDays) * 100,
            width: (durationDays / totalDays) * 100,
            startDate: normalizedStart,
            dueDate: normalizedEnd,
          },
        }
      })
  }, [issues, timelineEnd, timelineSearch, timelineStart])

  const filteredTimelineData = useMemo(() => {
    if (!timelineSearch.trim()) return timelineData
    const query = timelineSearch.toLowerCase()
    return timelineData.map((month) => ({
      ...month,
      issues: month.issues.filter((issue) => `${issue.issue_key} ${issue.title}`.toLowerCase().includes(query)),
    }))
  }, [timelineData, timelineSearch])

  const calendarData = useMemo(() => {
    const year = calendarMonthDate.getFullYear()
    const month = calendarMonthDate.getMonth()
    const firstDayOfMonth = new Date(year, month, 1)
    const lastDayOfMonth = new Date(year, month + 1, 0)
    const firstWeekdayMondayBased = (firstDayOfMonth.getDay() + 6) % 7
    const gridStartDate = new Date(year, month, 1 - firstWeekdayMondayBased)
    const totalCells = 42

    const eligibleIssues = issues.filter((issue) => {
      if (calendarAssigneeFilter && (issue.assignee || '') !== calendarAssigneeFilter) return false
      if (calendarStatusFilter && (issue.status || '') !== calendarStatusFilter) return false
      return true
    })

    const dayMap = {}
    const unscheduled = []

    eligibleIssues.forEach((issue) => {
      const due = getIssueDate(issue, 'Due date', 'due date')
      if (!due) {
        unscheduled.push(issue)
        return
      }

      const key = formatIsoDate(new Date(due.getFullYear(), due.getMonth(), due.getDate()))
      if (!dayMap[key]) dayMap[key] = []
      dayMap[key].push(issue)
    })

    return {
      year,
      month,
      firstDayOfMonth,
      lastDayOfMonth,
      gridStartDate,
      totalCells,
      dayMap,
      unscheduled,
    }
  }, [calendarAssigneeFilter, calendarMonthDate, calendarStatusFilter, issues])

  const availableAssignees = useMemo(() => {
    return Array.from(new Set(issues.map((issue) => issue.assignee).filter(Boolean)))
  }, [issues])

  const availableStatuses = useMemo(() => {
    return Array.from(new Set(issues.map((issue) => issue.status).filter(Boolean)))
  }, [issues])

  const filteredBoardSearch = boardSearch.trim().toLowerCase()

  useEffect(() => {
    let isMounted = true
    const authGuard = window.setTimeout(() => {
      if (isMounted) {
        setAuthLoading(false)
      }
    }, 5000)

    const authIntent = localStorage.getItem('pms_auth_intent')
    if (authIntent === 'signup') {
      localStorage.removeItem('pms_auth_token')
      localStorage.removeItem('pms_last_project_id')
      localStorage.removeItem('pms_auth_intent')
      setAuthPreferredMode('signup')
      setAuthLoading(false)
      window.clearTimeout(authGuard)
      return () => {
        isMounted = false
      }
    }

    const token = localStorage.getItem('pms_auth_token')
    if (!token) {
      setAuthLoading(false)
      window.clearTimeout(authGuard)
      return () => {
        isMounted = false
      }
    }

    fetchMe()
      .then((resolvedUser) => setUser(resolvedUser))
      .catch(() => {
        localStorage.removeItem('pms_auth_token')
      })
      .finally(() => {
        if (isMounted) {
          setAuthLoading(false)
        }
        window.clearTimeout(authGuard)
      })

    return () => {
      isMounted = false
      window.clearTimeout(authGuard)
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setOpenedIssueId(params.get('issue') || '')
    setSelectedProjectId((current) => current || params.get('project') || '')

    const onPopState = () => {
      const nextParams = new URLSearchParams(window.location.search)
      setOpenedIssueId(nextParams.get('issue') || '')
      setSelectedProjectId(nextParams.get('project') || '')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (!selectedProjectId) return undefined

    const eventSource = new EventSource(
      `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'}/api/events/projects/${selectedProjectId}`
    )

    const onIssueUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ['board', selectedProjectId] })
      queryClient.invalidateQueries({ queryKey: ['backlog', selectedProjectId] })
      queryClient.invalidateQueries({ queryKey: ['issues', selectedProjectId] })
      if (openedIssueId) {
        queryClient.invalidateQueries({ queryKey: ['issue', openedIssueId] })
        queryClient.invalidateQueries({ queryKey: ['issue-history', openedIssueId] })
        queryClient.invalidateQueries({ queryKey: ['issue-comments', openedIssueId] })
      }
    }

    eventSource.addEventListener('issue.updated', onIssueUpdated)
    eventSource.addEventListener('issue.created', onIssueUpdated)
    eventSource.addEventListener('issue.archived', onIssueUpdated)

    return () => {
      eventSource.close()
    }
  }, [openedIssueId, queryClient, selectedProjectId])

  useEffect(() => {
    if (activeTab === 'backlog' && currentBoardMode === 'kanban') {
      setActiveTab('board')
    }
  }, [activeTab, currentBoardMode])

  useEffect(() => {
    if (!user) return undefined

    const onPopState = (event) => {
      const historyTab = event.state?.pms_tab
      if (typeof historyTab === 'string') {
        isApplyingTabFromHistoryRef.current = true
        setActiveTab(historyTab)
      }
    }

    const currentState = window.history.state || {}
    if (currentState.pms_tab !== activeTab) {
      window.history.replaceState({ ...currentState, pms_tab: activeTab }, '')
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [user])

  useEffect(() => {
    if (!user || showNewDashboard) return
    if (isApplyingTabFromHistoryRef.current) {
      isApplyingTabFromHistoryRef.current = false
      return
    }

    const currentState = window.history.state || {}
    if (currentState.pms_tab === activeTab) return
    window.history.pushState({ ...currentState, pms_tab: activeTab }, '')
  }, [activeTab, showNewDashboard, user])

  const openIssue = (issueId) => {
    const params = new URLSearchParams(window.location.search)
    params.set('issue', issueId)
    window.history.pushState({ ...(window.history.state || {}) }, '', `${window.location.pathname}?${params.toString()}`)
    setOpenedIssueId(issueId)
  }

  const closeIssue = () => {
    const params = new URLSearchParams(window.location.search)
    params.delete('issue')
    const query = params.toString()
    window.history.pushState({ ...(window.history.state || {}) }, '', query ? `${window.location.pathname}?${query}` : window.location.pathname)
    setOpenedIssueId('')
  }

  const openCreateModal = (status = '', source = currentBoardMode) => {
    setCreateInitialStatus(status)
    setCreateBoardSource(source)
    setShowCreateModal(true)
  }

  const closeCreateModal = () => {
    setShowCreateModal(false)
    setCreateInitialStatus('')
  }

  const openCreateProjectModal = (templateId = 'scrum') => {
    setSelectedProjectTemplate(templateId)
    setShowCreateProjectModal(true)
    setShowCreateProjectMenu(false)
  }

  const submitCreateProject = (event) => {
    event.preventDefault()
    const workflowFromOnboarding = buildWorkflowFromColumns(user?.board_columns || [])
    const normalizedLead = String(projectForm.lead || '').trim() || String(user?.email || '').trim()
    const payload = {
      name: projectForm.name,
      key: projectForm.key || undefined,
      description: projectForm.description,
      lead: normalizedLead || undefined,
      project_type: 'software',
      workflow: selectedProjectTemplate === 'kanban' ? workflowFromOnboarding || kanbanWorkflowTemplate : undefined,
    }
    createProjectMutation.mutate(payload)
  }

  const assignIssueDueDate = (issue, targetDate) => {
    const formatted = formatIsoDate(targetDate)
    const nextDescription = setDescriptionField(issue.description || '', 'Due date', formatted)
    const existingStart = getIssueDate(issue, 'Start date', 'start date')
    const withStartDate = existingStart
      ? nextDescription
      : setDescriptionField(nextDescription, 'Start date', formatted)

    updateIssueMutation.mutate({
      issueId: issue.id,
      payload: {
        description: withStartDate,
        due_date: `${formatted}T00:00:00Z`,
        start_date: existingStart ? `${formatIsoDate(existingStart)}T00:00:00Z` : `${formatted}T00:00:00Z`,
      },
    })
  }

  const toggleUtilityPanel = (panel) => {
    setShowSettingsMenu(false)
    setActiveUtilityPanel((current) => (current === panel ? '' : panel))
  }

  const handleLogout = () => {
    localStorage.removeItem('pms_auth_token')
    localStorage.removeItem('pms_last_project_id')
    setUser(null)
  }

  if (authLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-white text-slate-900">
        <p className="rounded-xl border border-slate-300 bg-slate-50 px-5 py-3 text-sm">Loading workspace...</p>
      </div>
    )
  }

  if (!user) {
    return <AuthOnboardingFlow onAuthenticated={setUser} initialMode={authPreferredMode} />
  }

  return (
    <div className="h-screen flex flex-col bg-[#f6f7fb] text-slate-900 overflow-hidden">
      {showSettingsMenu && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-30 cursor-default"
            aria-label="Close settings"
            onClick={() => setShowSettingsMenu(false)}
          />
          <aside className="fixed right-3 top-14 z-40 w-[340px] rounded-lg border border-slate-300 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">Personal PMS settings</p>
            </div>
            <button type="button" className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50">
              <span className="mt-0.5 h-2 w-2 rounded-full bg-slate-500" />
              <span>
                <span className="block text-sm text-slate-900">General settings</span>
                <span className="block text-xs text-slate-600">Manage language, time zone, and personal preferences</span>
              </span>
            </button>
            <button type="button" className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50">
              <span className="mt-0.5 h-2 w-2 rounded-full bg-slate-500" />
              <span>
                <span className="block text-sm text-slate-900">Notification settings</span>
                  <span className="block text-xs text-slate-600">Manage email and in-app notifications from PMS</span>
              </span>
            </button>
            <div className="m-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              You do not have access to PMS settings admin. Contact your workspace admin to grant access.
            </div>
          </aside>
        </>
      )}

      {activeUtilityPanel && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-30 bg-black/20"
            aria-label="Close panel"
            onClick={() => setActiveUtilityPanel('')}
          />
          <aside className="fixed right-0 top-[49px] z-40 h-[calc(100vh-49px)] w-full max-w-[360px] border-l border-slate-300 bg-white shadow-xl">
            {activeUtilityPanel === 'notifications' && (
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <h2 className="text-xl font-semibold text-slate-900">Notifications</h2>
                  <button className="text-sm text-slate-600" onClick={() => setActiveUtilityPanel('')}>Close</button>
                </div>
                <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2 text-sm">
                  <button
                    type="button"
                      className={`rounded px-2 py-1 ${notificationTab === 'actions' ? 'bg-blue-100 text-blue-800' : 'text-slate-600'}`}
                      onClick={() => setNotificationTab('actions')}
                  >
                      Actions
                  </button>
                  <button
                    type="button"
                      className={`rounded px-2 py-1 ${notificationTab === 'alerts' ? 'bg-blue-100 text-blue-800' : 'text-slate-600'}`}
                      onClick={() => setNotificationTab('alerts')}
                  >
                      Alerts
                  </button>
                    <span className="ml-auto text-xs text-slate-500">PMS activity</span>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                    {notificationItems
                      .filter((item) => item.kind === notificationTab)
                      .map((item) => (
                    <article
                      key={item.id}
                        className={`mb-2 rounded border px-3 py-2 ${item.priority === 'high' ? 'border-rose-200 bg-rose-50' : item.priority === 'medium' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}
                    >
                        <p className="text-sm font-medium text-slate-900">{item.title}</p>
                        <p className="mt-0.5 text-xs text-slate-600">{item.detail}</p>
                        {item.action && (
                          <button
                            className="mt-1 text-xs text-blue-700 hover:underline"
                            onClick={() => {
                              if (item.action === 'create-project') {
                                openCreateProjectModal('scrum')
                              }
                              if (item.action === 'open-calendar') {
                                setActiveTab('calendar')
                                setActiveUtilityPanel('')
                              }
                              if (item.action === 'open-list') {
                                setActiveTab('list')
                                setActiveUtilityPanel('')
                              }
                              if (item.action === 'open-board') {
                                setActiveTab('board')
                                setActiveUtilityPanel('')
                              }
                            }}
                          >
                            Open
                          </button>
                        )}
                    </article>
                    ))}
                    {!notificationItems.some((item) => item.kind === notificationTab) && (
                      <p className="mt-6 text-center text-xs text-slate-500">No items in this section.</p>
                    )}
                </div>
              </div>
            )}

            {activeUtilityPanel === 'help' && (
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <h2 className="text-xl font-semibold text-slate-900">Help</h2>
                  <button className="text-sm text-slate-600" onClick={() => setActiveUtilityPanel('')}>Close</button>
                </div>
                <div className="space-y-1 p-3">
                  {helpLinks.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="flex w-full items-center justify-between rounded border border-transparent px-3 py-2 text-left text-sm text-slate-700 hover:border-slate-200 hover:bg-slate-50"
                    >
                      <span>{item}</span>
                        <span className="text-slate-400">↗</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeUtilityPanel === 'profile' && (
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <h2 className="text-xl font-semibold text-slate-900">Profile</h2>
                  <button className="text-sm text-slate-600" onClick={() => setActiveUtilityPanel('')}>Close</button>
                </div>
                <div className="border-b border-slate-200 px-4 py-4">
                  <div className="flex items-center gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-cyan-500 text-sm font-semibold text-white">{profileInitial}</span>
                    <div>
                      <p className="text-base font-semibold text-slate-900">{user?.username || 'User'}</p>
                      <p className="text-sm text-slate-600">{user?.email || 'No email available'}</p>
                    </div>
                  </div>
                  <p className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">{profileDescription}</p>
                </div>
                <div className="p-3">
                  <button
                    type="button"
                    className="mb-2 block w-full rounded px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
                    onClick={() => {
                      setChangePasswordOpen(true)
                      setChangePasswordMessage('')
                    }}
                  >
                    Change password
                  </button>
                  <button
                    type="button"
                    className="block w-full rounded px-3 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-50"
                    onClick={handleLogout}
                  >
                    Log out
                  </button>
                </div>
              </div>
            )}
          </aside>
        </>
      )}

      {changePasswordOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
          <div className="w-full max-w-md rounded-xl border border-slate-300 bg-white p-5 text-slate-900 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <h2 className="text-lg font-semibold">Change password</h2>
                <p className="text-xs text-slate-600">Set a new password for {user?.email || 'your account'}.</p>
              </div>
              <button
                type="button"
                className="rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700"
                onClick={() => setChangePasswordOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">New password</label>
                <input
                  type="password"
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  value={changePasswordValue}
                  onChange={(event) => setChangePasswordValue(event.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">Confirm password</label>
                <input
                  type="password"
                  className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  value={changePasswordConfirm}
                  onChange={(event) => setChangePasswordConfirm(event.target.value)}
                />
              </div>

              {changePasswordMessage && <p className="text-sm text-emerald-700">{changePasswordMessage}</p>}
              {changePasswordMutation.error && <p className="text-sm text-red-600">{getApiErrorMessage(changePasswordMutation.error)}</p>}

              <button
                type="button"
                className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                disabled={
                  !changePasswordValue.trim()
                  || changePasswordValue !== changePasswordConfirm
                  || changePasswordMutation.isPending
                  || !user?.email
                }
                onClick={() => {
                  setChangePasswordMessage('')
                  changePasswordMutation.mutate({ email: user.email, new_password: changePasswordValue })
                }}
              >
                {changePasswordMutation.isPending ? 'Updating...' : 'Update password'}
              </button>
              {changePasswordValue && changePasswordConfirm && changePasswordValue !== changePasswordConfirm && (
                <p className="text-xs text-red-600">Passwords do not match.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <aside className={`relative border-r border-brand-border bg-brand-gray-light transition-all duration-200 flex flex-col justify-between overflow-y-auto ${sidebarCollapsed ? 'w-16' : 'w-[240px]'}`}>
          <div className="p-3">
            <div className="flex items-center justify-between mb-4 gap-2">
              {!sidebarCollapsed ? (
                <div className="flex items-center gap-2.5 px-1">
                  <div className="h-9 w-9 rounded bg-[#deebff] border border-brand-border flex items-center justify-center font-bold text-brand-blue text-sm shadow-sm">
                    {selectedProject?.key?.slice(0, 2) || 'DS'}
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-sm font-bold text-brand-navy truncate leading-normal">{selectedProject?.name || 'Design System'}</p>
                    <p className="text-[10px] font-semibold text-brand-slate uppercase tracking-wider leading-none">Software Project</p>
                  </div>
                </div>
              ) : (
                <div className="mx-auto h-9 w-9 rounded bg-[#deebff] border border-brand-border flex items-center justify-center font-bold text-brand-blue text-sm shadow-sm" title={selectedProject?.name || 'Project'}>
                  {selectedProject?.key?.slice(0, 2) || 'DS'}
                </div>
              )}
            </div>

            <button
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="absolute -right-3 top-12 z-20 bg-white border border-brand-border text-brand-slate hover:text-brand-navy rounded-full h-6 w-6 flex items-center justify-center text-xs shadow-md transition-colors hover:shadow"
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? '»' : '«'}
            </button>

            {!sidebarCollapsed && (
              <div className="mb-4 rounded-lg border border-brand-border bg-white p-2.5 shadow-xs">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-brand-slate">Workspace Spaces</span>
                  {!hasProjects && (
                    <button
                      type="button"
                      className="text-xs text-brand-blue hover:text-brand-blue-hover font-semibold"
                      onClick={() => setShowCreateProjectMenu((v) => !v)}
                      title="Add project"
                    >
                      + New
                    </button>
                  )}
                </div>
                
                {showCreateProjectMenu && (
                  <div className="mb-3 rounded border border-brand-border bg-brand-gray-light p-2 space-y-1">
                    <p className="text-[10px] uppercase font-bold text-brand-slate tracking-wider mb-1.5">Create template</p>
                    {softwareTemplateOptions.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        className="mb-1 block w-full rounded border border-brand-border bg-white px-2 py-1 text-left text-xs text-brand-navy hover:border-brand-blue hover:bg-[#deebff]"
                        onClick={() => openCreateProjectModal(template.id)}
                      >
                        {template.label}
                      </button>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded border border-brand-border bg-[#fafbfc] px-2.5 py-1.5 text-left text-xs text-brand-navy hover:border-[#a5adba] transition-colors"
                  onClick={() => setShowProjectPicker(true)}
                >
                  <span className="truncate">{selectedProject ? `${selectedProject.key} - ${selectedProject.name}` : 'Select space'}</span>
                  <span className="text-slate-400">▾</span>
                </button>
              </div>
            )}

            <nav className="space-y-1">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.key
                return (
                  <button
                    key={tab.key}
                    type="button"
                    className={`flex items-center gap-3 w-full rounded px-3 py-2 text-left text-sm font-medium transition-colors ${
                      isActive ? 'bg-[#deebff] text-brand-blue font-bold border-l-[3px] border-brand-blue shadow-sm' : 'text-brand-slate hover:bg-brand-hover hover:text-brand-navy'
                    }`}
                    onClick={() => setActiveTab(tab.key)}
                    title={tab.label}
                  >
                    <span className={`flex-shrink-0 ${isActive ? 'text-brand-blue' : 'text-brand-slate'}`}>
                      {tab.key === 'summary' && (
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2" />
                        </svg>
                      )}
                      {tab.key === 'timeline' && (
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      )}
                      {tab.key === 'sprints' && (
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                        </svg>
                      )}
                      {tab.key === 'board' && (
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                        </svg>
                      )}
                      {tab.key === 'calendar' && (
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      )}
                      {tab.key === 'list' && (
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                        </svg>
                      )}
                      {tab.key === 'backlog' && (
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                      )}
                    </span>
                    {!sidebarCollapsed && <span className="font-semibold text-[13px]">{tab.label}</span>}
                  </button>
                )
              })}
            </nav>
          </div>

          <div className="p-3 border-t border-brand-border">
            <button
              type="button"
              className={`flex items-center gap-3 w-full rounded px-3 py-2 text-left text-sm font-medium transition-colors text-brand-slate hover:bg-brand-hover hover:text-brand-navy`}
              onClick={() => {
                setInviteProjectId(selectedProjectId || projects[0]?.id || '')
                setInviteRole('')
                setShowInviteModal(true)
              }}
              title="Invite members"
            >
              <svg className="h-5 w-5 text-brand-slate" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              {!sidebarCollapsed && <span className="font-semibold text-[13px]">Invite members</span>}
            </button>
          </div>
        </aside>

        {showProjectPicker && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 bg-black/40"
              aria-label="Close project picker"
              onClick={() => setShowProjectPicker(false)}
            />
            <div className="fixed left-[14px] top-[150px] z-50 w-[calc(250px-28px)] rounded-xl border border-slate-300 bg-white p-2 shadow-2xl">
              <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">All projects</p>
              <div className="max-h-64 overflow-auto">
                {filteredProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className={`mb-1 w-full rounded px-2 py-2 text-left text-sm ${
                      project.id === selectedProjectId ? 'bg-blue-100 text-blue-800' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                    onClick={() => {
                      setSelectedProjectId(project.id)
                      setActiveTab('board')
                      setShowProjectPicker(false)
                    }}
                  >
                    <span className="font-medium">{project.key}</span> <span className="text-slate-500">-</span> {project.name}
                  </button>
                ))}
                {filteredProjects.length === 0 && (
                  <p className="px-2 py-2 text-sm text-slate-500">No projects found.</p>
                )}
              </div>
            </div>
          </>
        )}

        <main className="flex-1 bg-[#f5f6fb] px-5 py-5 overflow-y-auto" style={{ zoom: `${zoomPercent}%` }}>
          <header className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-6">
              <button className="rounded bg-brand-blue px-3.5 py-1.5 font-semibold text-white shadow-sm hover:bg-brand-blue-hover transition-colors text-sm" onClick={() => !hasProjects ? openCreateProjectModal('scrum') : openCreateModal()}>
                Create
              </button>
            </div>

            <div className="relative flex items-center gap-3 text-sm">
              <div className="relative hidden md:block w-48 lg:w-64">
                <input
                  className="w-full rounded border border-brand-border bg-white hover:bg-[#ebecf0] px-3 py-1.5 text-xs text-brand-navy focus:outline-none focus:bg-white focus:border-brand-blue focus:ring-1 focus:ring-brand-blue placeholder:text-slate-400 transition-all shadow-sm"
                  placeholder="Search..."
                  value={boardSearch}
                  onChange={(e) => setBoardSearch(e.target.value)}
                />
                <span className="absolute right-2.5 top-2 text-slate-400">🔍</span>
              </div>

              <button
                type="button"
                className="p-1.5 rounded text-brand-slate hover:bg-brand-hover hover:text-brand-navy relative transition bg-white shadow-sm border border-brand-border"
                title="Notifications"
                onClick={() => toggleUtilityPanel('notifications')}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {notificationItems.length > 0 && (
                  <span className="absolute top-1 right-1 block h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />
                )}
              </button>

              <button
                type="button"
                className="p-1.5 rounded text-brand-slate hover:bg-brand-hover hover:text-brand-navy transition bg-white shadow-sm border border-brand-border"
                title="Help"
                onClick={() => toggleUtilityPanel('help')}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>

              <button
                type="button"
                className="p-1.5 rounded text-brand-slate hover:bg-brand-hover hover:text-brand-navy transition bg-white shadow-sm border border-brand-border"
                title="Settings"
                onClick={() => setShowSettingsMenu((curr) => !curr)}
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>

              <button
                type="button"
                className="flex items-center gap-2 rounded-full hover:ring-2 hover:ring-brand-blue/30 p-0.5 transition shadow-sm"
                title="Profile"
                onClick={() => toggleUtilityPanel('profile')}
              >
                <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-blue text-sm font-semibold text-white">{profileInitial}</span>
              </button>
            </div>
          </header>

          <div className="mb-3 flex justify-between items-center">
            <BackNavigationButton onFallback={() => setActiveTab('board')} />
          </div>

          {showNewDashboard ? (
            <section className="rounded-xl border border-slate-200 bg-white p-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">New workspace</p>
              <h1 className="mt-2 text-3xl font-semibold text-slate-900">Create your new dashboard</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                This is your fresh account workspace. Start by creating your first project and then plan your backlog, board, and timeline from here.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white"
                  onClick={() => openCreateProjectModal('scrum')}
                >
                  Create first project
                </button>
                <button
                  className="rounded border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700"
                  onClick={() => toggleUtilityPanel('help')}
                >
                  Open setup help
                </button>
              </div>
              <div className="mt-6 grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-600">Step 1</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">Set project structure</p>
                  <p className="mt-1 text-xs text-slate-600">Choose Scrum or Kanban workflow.</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-600">Step 2</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">Invite your team</p>
                  <p className="mt-1 text-xs text-slate-600">Add collaborators from project settings.</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-600">Step 3</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">Create work items</p>
                  <p className="mt-1 text-xs text-slate-600">Track status using board, list, and calendar views.</p>
                </div>
              </div>
            </section>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="text-4xl font-bold leading-tight text-slate-900">{projectTitle}</h1>
                  <p className="mt-1 text-base text-slate-500">Manage active tasks and workflow</p>
                </div>
              </div>

            </>
          )}

          {!showNewDashboard && activeTab !== 'board' && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <input
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800"
                placeholder="Search board/timeline"
                value={boardSearch}
                onChange={(event) => setBoardSearch(event.target.value)}
              />
              <button className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700">Filter</button>
            </div>
            <div className="flex items-center gap-2">
              <button className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white">Complete sprint</button>
              <button className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700">Group</button>
            </div>
            </div>
          )}

          {!showNewDashboard && activeTab === 'summary' && (
            <div className="space-y-4">
              <div className="flex items-center justify-end">
                <button className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700">Filter</button>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-slate-300 bg-white p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-600">Completed</p>
                  <p className="mt-1 text-xl font-semibold text-emerald-600">{summaryStats.completed}</p>
                  <p className="text-xs text-slate-600">in the last 7 days</p>
                </div>
                <div className="rounded-lg border border-slate-300 bg-white p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-600">Updated</p>
                  <p className="mt-1 text-xl font-semibold text-sky-600">{summaryStats.updated}</p>
                  <p className="text-xs text-slate-600">in the last 7 days</p>
                </div>
                <div className="rounded-lg border border-slate-300 bg-white p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-600">Created</p>
                  <p className="mt-1 text-xl font-semibold text-violet-600">{summaryStats.createdThisWeek}</p>
                  <p className="text-xs text-slate-600">in the last 7 days</p>
                </div>
                <div className="rounded-lg border border-slate-300 bg-white p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-600">Due soon</p>
                  <p className="mt-1 text-xl font-semibold text-amber-600">{summaryStats.dueSoon}</p>
                  <p className="text-xs text-slate-600">in the next 7 days</p>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-slate-300 bg-white p-4">
                  <h2 className="text-base font-semibold text-slate-900">Status overview</h2>
                  <p className="text-xs text-slate-600">A quick snapshot of current work item status.</p>
                  <div className="mt-4 flex items-center gap-5">
                    <div
                      className="grid h-28 w-28 place-items-center rounded-full"
                      style={{ background: `conic-gradient(#3b82f6 ${summaryStats.completionPercent}%, #334155 0%)` }}
                    >
                      <div className="grid h-20 w-20 place-items-center rounded-full bg-white text-center border border-slate-300">
                        <p className="text-lg font-semibold text-slate-900">{summaryStats.total}</p>
                        <p className="text-[10px] uppercase tracking-wide text-slate-600">items</p>
                      </div>
                    </div>
                    <div className="space-y-1 text-sm text-slate-800">
                      {Object.entries(summaryStats.statusOverview).length === 0 && <p>No activity yet</p>}
                      {Object.entries(summaryStats.statusOverview).map(([key, value]) => (
                        <p key={key}>{key}: {value}</p>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-300 bg-white p-4">
                  <h2 className="text-base font-semibold text-slate-900">Recent activity</h2>
                  {issues.length === 0 ? (
                    <p className="mt-4 text-sm text-slate-600">No activity yet. Create work items to begin tracking.</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {issues.slice(0, 4).map((issue) => (
                        <div key={issue.id} className="rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
                          <p className="text-slate-900">{issue.issue_key} - {issue.title}</p>
                          <p className="text-xs text-slate-600">Updated {new Date(issue.updated_at).toLocaleDateString()}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-slate-300 bg-white p-4">
                  <h2 className="text-base font-semibold text-slate-900">Priority breakdown</h2>
                  <div className="mt-3 space-y-2">
                    {Object.entries(summaryStats.priority).map(([key, value]) => (
                      <div key={key}>
                        <div className="mb-1 flex items-center justify-between text-xs text-slate-700">
                          <span>{key}</span>
                          <span>{value}</span>
                        </div>
                        <div className="h-2 rounded bg-slate-200">
                          <div
                            className="h-2 rounded bg-indigo-600"
                            style={{ width: `${summaryStats.total ? Math.round((value / summaryStats.total) * 100) : 0}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-300 bg-white p-4">
                  <h2 className="text-base font-semibold text-slate-900">Types of work</h2>
                  <div className="mt-3 space-y-2 text-sm text-slate-800">
                    {Object.entries(summaryStats.workType).length === 0 && <p className="text-slate-600">No work items yet.</p>}
                    {Object.entries(summaryStats.workType).map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between rounded border border-slate-300 bg-slate-50 px-3 py-2">
                        <span>{key}</span>
                        <span>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {!showNewDashboard && activeTab === 'timeline' && (
            <div className="rounded-lg border border-slate-300 bg-white p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-slate-900">Timeline</h2>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700"
                    onClick={() => setTimelineStartMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                  >
                    Prev
                  </button>
                  <button
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700"
                    onClick={() => setTimelineStartMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                  >
                    Next
                  </button>
                  <input
                    className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800"
                    placeholder="Search timeline"
                    value={timelineSearch}
                    onChange={(event) => setTimelineSearch(event.target.value)}
                  />
                </div>
              </div>

              <p className="mb-4 text-sm text-brand-slate">
                Create tasks with Start date and Due date to view duration bars across months. Overlapping bars help plan workload.
              </p>

              <div className="overflow-x-auto">
                <div className="min-w-[840px]">
                  <div className="mb-2 grid grid-cols-[220px_1fr] gap-2">
                    <div className="text-xs font-bold uppercase tracking-wide text-brand-navy">Work</div>
                    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${timelineMonths.length}, minmax(0, 1fr))` }}>
                      {timelineMonths.map((month) => (
                        <div key={month.key} className="rounded border border-brand-border bg-brand-gray-light px-2 py-1 text-center text-xs font-semibold text-brand-navy shadow-sm">
                          {month.label}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {timelineRows.length === 0 && (
                      <p className="rounded border border-brand-border bg-brand-gray-light p-3 text-sm text-brand-slate">No work items available.</p>
                    )}

                    {timelineRows.map(({ issue, bar }) => (
                      <div key={issue.id} className="grid grid-cols-[220px_1fr] items-center gap-2">
                        <div className="truncate rounded border border-brand-border bg-brand-gray-light px-2 py-2 text-xs font-semibold text-brand-navy">
                          {issue.issue_key} - {issue.title}
                        </div>
                        <div className="relative h-9 rounded border border-brand-border bg-white">
                          <div
                            className="absolute inset-0 grid"
                            style={{ gridTemplateColumns: `repeat(${timelineMonths.length}, minmax(0, 1fr))` }}
                          >
                            {timelineMonths.map((month) => (
                              <div key={`${issue.id}-${month.key}`} className="border-r border-brand-border/40 last:border-r-0" />
                            ))}
                          </div>
                          {bar ? (
                            <div
                              className="absolute top-1 h-7 rounded-md bg-brand-blue px-2 text-[11px] font-semibold leading-7 text-white shadow-sm"
                              style={{ left: `${bar.left}%`, width: `${Math.max(2, bar.width)}%` }}
                              title={`${bar.startDate.toLocaleDateString()} - ${bar.dueDate.toLocaleDateString()}`}
                            >
                              {issue.issue_key}
                            </div>
                          ) : (
                            <div className="absolute inset-0 grid place-items-center text-[11px] font-medium text-slate-400">Missing start or due date</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {!showNewDashboard && activeTab === 'list' && (
            <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white p-4">
              <h2 className="mb-2 text-lg font-semibold text-slate-900">List</h2>
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-700">
                  <tr>
                    <th className="pb-2">Checklist</th>
                    <th className="pb-2">Work</th>
                    <th className="pb-2">Assignee</th>
                    <th className="pb-2">Reporter</th>
                    <th className="pb-2">Priority</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Resolution</th>
                    <th className="pb-2">Created</th>
                    <th className="pb-2">Updated</th>
                    <th className="pb-2">Due Date</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((issue) => (
                    <tr key={issue.id} className="border-t border-slate-200 text-slate-800">
                      <td className="py-2">
                        <input
                          type="checkbox"
                          checked={Boolean(checkedTimelineItems[issue.id])}
                          onChange={() => setCheckedTimelineItems((current) => ({
                            ...current,
                            [issue.id]: !current[issue.id],
                          }))}
                        />
                      </td>
                      <td className="py-2">{issue.issue_key} - {issue.title}</td>
                      <td className="py-2">{issue.assignee || 'Unassigned'}</td>
                      <td className="py-2">{issue.reporter || '-'}</td>
                      <td className="py-2">{issue.priority}</td>
                      <td className="py-2">{issue.status}</td>
                      <td className="py-2">{(issue.status || '').toLowerCase().includes('done') ? 'Resolved' : 'Unresolved'}</td>
                      <td className="py-2">{new Date(issue.created_at).toLocaleDateString()}</td>
                      <td className="py-2">{new Date(issue.updated_at).toLocaleDateString()}</td>
                      <td className="py-2">{getIssueDate(issue, 'Due date', 'due date')?.toLocaleDateString() || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!showNewDashboard && activeTab === 'calendar' && (
            <div className="rounded-lg border border-slate-300 bg-white p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-slate-900">Calendar - {monthLabels[calendarData.month]} {calendarData.year}</h2>
              </div>

              <div className="mb-4 grid gap-2 md:grid-cols-2 lg:grid-cols-4">
                <input
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800"
                  placeholder="Search calendar"
                  value={timelineSearch}
                  onChange={(event) => setTimelineSearch(event.target.value)}
                />
                <select
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800"
                  value={calendarAssigneeFilter}
                  onChange={(event) => setCalendarAssigneeFilter(event.target.value)}
                >
                  <option value="">All assignees</option>
                  {availableAssignees.map((assignee) => (
                    <option key={assignee} value={assignee}>{assignee}</option>
                  ))}
                </select>
                <select
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800"
                  value={calendarStatusFilter}
                  onChange={(event) => setCalendarStatusFilter(event.target.value)}
                >
                  <option value="">All statuses</option>
                  {availableStatuses.map((statusValue) => (
                    <option key={statusValue} value={statusValue}>{statusValue}</option>
                  ))}
                </select>
              </div>

              <div className="grid gap-4 xl:grid-cols-[1fr_250px]">
                <div>
                  <div className="mb-2 grid grid-cols-7 gap-2 text-center text-xs uppercase text-slate-700">
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                      <div key={day}>{day}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-2">
                    {Array.from({ length: calendarData.totalCells }).map((_, index) => {
                      const currentDate = new Date(
                        calendarData.gridStartDate.getFullYear(),
                        calendarData.gridStartDate.getMonth(),
                        calendarData.gridStartDate.getDate() + index
                      )
                      const dateKey = formatIsoDate(currentDate)
                      const inMonth = currentDate.getMonth() === calendarData.month
                      const items = (calendarData.dayMap[dateKey] || []).filter((issue) => {
                        if (!timelineSearch.trim()) return true
                        const target = `${issue.issue_key} ${issue.title}`.toLowerCase()
                        return target.includes(timelineSearch.toLowerCase())
                      })

                      return (
                        <div
                          key={dateKey}
                          className={`min-h-[120px] rounded border p-2 ${inMonth ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50'}`}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault()
                            const issueId = event.dataTransfer.getData('text/issue-id') || draggingIssueId
                            const issue = issues.find((entry) => entry.id === issueId)
                            if (!issue) return
                            assignIssueDueDate(issue, currentDate)
                            setDraggingIssueId('')
                          }}
                        >
                          <p className="text-xs text-slate-700">{currentDate.getDate()}</p>
                          <div className="mt-1 space-y-1">
                            {items.slice(0, 3).map((issue) => (
                              <button
                                key={issue.id}
                                className="w-full rounded bg-blue-100 px-1.5 py-1 text-left text-[10px] text-blue-800"
                                onClick={() => openIssue(issue.id)}
                              >
                                {issue.issue_key} - {issue.title}
                              </button>
                            ))}
                            {items.length > 3 && <p className="text-[10px] text-slate-600">+{items.length - 3} more</p>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <aside className="rounded border border-slate-300 bg-white p-3">
                  <h3 className="text-sm font-semibold text-slate-900">Unscheduled work</h3>
                  <p className="mt-1 text-xs text-slate-600">Drag items onto a calendar date to assign due date.</p>
                  <div className="mt-3 space-y-2">
                    {calendarData.unscheduled.length === 0 && (
                      <p className="text-xs text-slate-600">No unscheduled tasks.</p>
                    )}
                    {calendarData.unscheduled
                      .filter((issue) => {
                        if (!timelineSearch.trim()) return true
                        const target = `${issue.issue_key} ${issue.title}`.toLowerCase()
                        return target.includes(timelineSearch.toLowerCase())
                      })
                      .map((issue) => (
                        <div
                          key={issue.id}
                          className="cursor-grab rounded border border-slate-300 bg-slate-50 px-2 py-2 text-xs text-slate-800"
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData('text/issue-id', issue.id)
                            setDraggingIssueId(issue.id)
                          }}
                          onDragEnd={() => setDraggingIssueId('')}
                        >
                          <p className="font-medium text-slate-900">{issue.issue_key}</p>
                          <p className="truncate">{issue.title}</p>
                          <p className="mt-1 text-[10px] text-slate-600">{issue.status || 'No status'}{issue.assignee ? ` - ${issue.assignee}` : ''}</p>
                        </div>
                      ))}
                  </div>
                </aside>
              </div>
            </div>
          )}

          {!showNewDashboard && activeTab === 'sprints' && (
            <SprintsPage selectedProjectId={selectedProjectId} />
          )}
          {!showNewDashboard && activeTab === 'backlog' && <BacklogPage selectedProjectId={selectedProjectId} onOpenIssue={openIssue} projectMembers={projectMembers} />}
          {!showNewDashboard && activeTab === 'board' && (
            <BoardPage
              selectedProjectId={selectedProjectId}
              onOpenIssue={openIssue}
              searchTerm={filteredBoardSearch}
              onRequestCreate={(status, mode) => openCreateModal(status, mode)}
              onGoBacklog={() => setActiveTab('backlog')}
              onBoardModeChange={setCurrentBoardMode}
              currentProjectRole={currentProjectRole}
              projectMembers={projectMembers}
            />
          )}
        </main>
      </div>

      {showCreateProjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
          <div className="w-full max-w-xl rounded-xl border border-brand-border bg-white p-5 text-brand-navy shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3 border-b border-brand-border pb-3">
              <div>
                <h2 className="text-lg font-semibold text-brand-navy">Create Project</h2>
                <p className="text-xs text-brand-slate">Domain templates with Software Development support.</p>
              </div>
              <button
                type="button"
                className="rounded border border-brand-border bg-white px-3 py-1 text-sm text-brand-slate hover:bg-brand-hover hover:text-brand-navy"
                onClick={() => setShowCreateProjectModal(false)}
              >
                Close
              </button>
            </div>

            <div className="mb-4 rounded-lg border border-brand-border bg-brand-gray-light p-3 text-xs">
              <p className="mb-2 uppercase tracking-wide text-brand-slate font-bold">Domains</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded border border-[#b3d4ff] bg-[#deebff] px-2 py-1.5 text-brand-blue font-bold">Software Development</div>
                <div className="rounded border border-brand-border bg-white px-2 py-1.5 text-brand-slate">Business (soon)</div>
                <div className="rounded border border-brand-border bg-white px-2 py-1.5 text-brand-slate">Marketing (soon)</div>
              </div>
            </div>

            <form className="space-y-3" onSubmit={submitCreateProject}>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-brand-slate font-bold">Template (Software Development)</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {softwareTemplateOptions.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      className={`rounded border px-3 py-2 text-left ${selectedProjectTemplate === template.id ? 'border-brand-blue bg-[#deebff]' : 'border-brand-border bg-white'}`}
                      onClick={() => setSelectedProjectTemplate(template.id)}
                    >
                      <p className="text-sm font-semibold text-brand-navy">{template.label}</p>
                      <p className="text-xs text-brand-slate">{template.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-brand-slate font-bold">Project Name</label>
                <input
                  className="w-full input-text"
                  value={projectForm.name}
                  onChange={(event) => setProjectForm((current) => ({ ...current, name: event.target.value }))}
                  required
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wide text-brand-slate font-bold">Project Key (optional)</label>
                  <input
                    className="w-full input-text uppercase"
                    value={projectForm.key}
                    onChange={(event) => setProjectForm((current) => ({ ...current, key: event.target.value.toUpperCase() }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs uppercase tracking-wide text-brand-slate font-bold">Lead (optional)</label>
                  <input
                    className="w-full input-text"
                    value={projectForm.lead}
                    onChange={(event) => setProjectForm((current) => ({ ...current, lead: event.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-brand-slate font-bold">Description</label>
                <textarea
                  rows={3}
                  className="w-full input-text"
                  value={projectForm.description}
                  onChange={(event) => setProjectForm((current) => ({ ...current, description: event.target.value }))}
                />
              </div>

              {createProjectMutation.error && (
                <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {getApiErrorMessage(createProjectMutation.error)}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-brand-border pt-3">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowCreateProjectModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={createProjectMutation.isPending}
                >
                  {createProjectMutation.isPending ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
          <div className="w-full max-w-lg rounded-xl border border-brand-border bg-white p-6 text-brand-navy shadow-2xl">
            <div className="mb-5 flex items-center justify-between border-b border-brand-border pb-3">
              <div>
                <h2 className="text-lg font-bold text-brand-navy">Invite Team Member</h2>
                <p className="text-xs text-brand-slate">Collaborators will receive a project invitation link via Gmail.</p>
              </div>
              <button
                type="button"
                className="rounded-md border border-brand-border bg-white px-3 py-1 text-sm text-brand-slate hover:bg-brand-hover hover:text-brand-navy"
                onClick={() => setShowInviteModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-slate">Invitee Email</label>
                <input
                  className="w-full input-text py-2"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="e.g. developer@company.com"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-slate">Project Workspace</label>
                <select
                  className="w-full input-text py-2"
                  value={inviteProjectId}
                  onChange={(event) => setInviteProjectId(event.target.value)}
                >
                  <option value="" className="bg-white text-slate-400">Select project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id} className="bg-white text-brand-navy">{project.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand-slate">Project Role</label>
                <select
                  className="w-full input-text py-2"
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value)}
                >
                  <option value="" className="bg-white text-slate-400">Select role</option>
                  <option value="restricted" className="bg-white text-brand-navy">Restricted (view, comment, limited transitions)</option>
                  <option value="viewer" className="bg-white text-brand-navy">Viewer (read-only and comment)</option>
                  <option value="developer" className="bg-white text-brand-navy">Developer (full transition and issue access)</option>
                </select>
              </div>

              {inviteMemberMutation.error && (
                <p className="text-xs font-medium text-rose-800 p-2.5 rounded-lg border border-rose-200 bg-rose-50">
                  {getApiErrorMessage(inviteMemberMutation.error)}
                </p>
              )}
              {inviteMemberMutation.data && (
                <p className="text-xs font-medium text-emerald-800 p-2.5 rounded-lg border border-emerald-200 bg-emerald-50">
                  {inviteMemberMutation.data.already_member ? 'User is already in this project.' : 'Invitation email sent successfully.'}
                </p>
              )}

              <div className="flex items-center justify-end gap-2.5 border-t border-brand-border pt-4 mt-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowInviteModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!inviteEmail.trim() || !inviteProjectId || !inviteRole || inviteMemberMutation.isPending}
                  onClick={() => inviteMemberMutation.mutate({ projectId: inviteProjectId, email: inviteEmail.trim(), role: inviteRole })}
                >
                  {inviteMemberMutation.isPending ? 'Sending...' : 'Send Invitation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <CreateWorkItemModal
        isOpen={showCreateModal}
        onClose={closeCreateModal}
        selectedProjectId={selectedProjectId}
        selectedProjectName={selectedProject?.name || ''}
        initialStatus={createInitialStatus}
        boardSource={createBoardSource}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ['board', selectedProjectId] })
          queryClient.invalidateQueries({ queryKey: ['backlog', selectedProjectId] })
          queryClient.invalidateQueries({ queryKey: ['issues', selectedProjectId] })
        }}
      />

      <IssueDetailModal issueId={openedIssueId} onClose={closeIssue} />
    </div>
  )
}
