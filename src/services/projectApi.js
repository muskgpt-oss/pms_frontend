import apiClient from './apiClient'

export const fetchProjects = async () => {
  const { data } = await apiClient.get('/api/projects')
  return data
}

export const createProject = async (payload) => {
  const { data } = await apiClient.post('/api/projects', payload)
  return data
}

export const archiveProject = async ({ projectId }) => {
  const { data } = await apiClient.post(`/api/projects/${projectId}/archive`)
  return data
}

export const deleteProject = async ({ projectId }) => {
  const { data } = await apiClient.delete(`/api/projects/${projectId}`)
  return data
}

export const inviteProjectMember = async ({ projectId, email, role = 'restricted' }) => {
  const { data } = await apiClient.post(`/api/projects/${projectId}/invite`, { email, role })
  return data
}

export const fetchProjectIssues = async ({ projectId, status }) => {
  const { data } = await apiClient.get(`/api/projects/${projectId}/issues`, {
    params: status ? { status } : undefined,
  })
  return data
}

export const fetchProjectIssueSearch = async ({ projectId, filters }) => {
  const { data } = await apiClient.get(`/api/projects/${projectId}/issues`, {
    params: filters,
  })
  return data
}

export const fetchBacklog = async (projectId) => {
  const { data } = await apiClient.get(`/api/projects/${projectId}/backlog`)
  return data
}

export const fetchBoard = async ({ projectId, sprintId }) => {
  const { data } = await apiClient.get(`/api/projects/${projectId}/board`, {
    params: sprintId ? { sprint_id: sprintId } : undefined,
  })
  return data
}

export const fetchWorkflow = async ({ projectId }) => {
  const { data } = await apiClient.get(`/api/projects/${projectId}/workflow`)
  return data
}

export const updateWorkflow = async ({ projectId, payload }) => {
  const { data } = await apiClient.put(`/api/projects/${projectId}/workflow`, payload)
  return data
}

export const createIssue = async ({ projectId, payload }) => {
  const { data } = await apiClient.post(`/api/projects/${projectId}/issues`, payload)
  return data
}

export const fetchSprints = async (projectId) => {
  const { data } = await apiClient.get(`/api/projects/${projectId}/sprints`)
  return data
}

export const createSprint = async ({ projectId, payload }) => {
  const { data } = await apiClient.post(`/api/projects/${projectId}/sprints`, payload)
  return data
}

export const startSprint = async ({ projectId, sprintId }) => {
  const { data } = await apiClient.post(`/api/projects/${projectId}/sprints/${sprintId}/start`)
  return data
}

export const completeSprint = async ({ projectId, sprintId }) => {
  const { data } = await apiClient.post(`/api/projects/${projectId}/sprints/${sprintId}/complete`)
  return data
}

export const createEpic = async ({ projectId, payload }) => {
  const { data } = await apiClient.post(`/api/projects/${projectId}/epics`, payload)
  return data
}

export const fetchSprintHierarchy = async ({ projectId, sprintId }) => {
  const { data } = await apiClient.get(`/api/projects/${projectId}/sprint-hierarchy`, {
    params: sprintId ? { sprint_id: sprintId } : undefined,
  })
  return data
}

export const includeEpicInSprint = async ({ projectId, sprintId, epicId, payload }) => {
  const { data } = await apiClient.post(`/api/projects/${projectId}/sprints/${sprintId}/epics/${epicId}/include`, payload)
  return data
}
