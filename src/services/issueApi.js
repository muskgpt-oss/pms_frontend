import apiClient from './apiClient'

export const fetchIssue = async ({ issueId }) => {
  const { data } = await apiClient.get(`/api/issues/${issueId}`)
  return data
}

export const fetchIssueHistory = async ({ issueId }) => {
  const { data } = await apiClient.get(`/api/issues/${issueId}/history`)
  return data
}

export const fetchIssueComments = async ({ issueId }) => {
  const { data } = await apiClient.get(`/api/issues/${issueId}/comments`)
  return data
}

export const addIssueComment = async ({ issueId, payload }) => {
  const { data } = await apiClient.post(`/api/issues/${issueId}/comments`, payload)
  return data
}

export const updateIssue = async ({ issueId, payload }) => {
  const { data } = await apiClient.patch(`/api/issues/${issueId}`, payload)
  return data
}

export const transitionIssue = async ({ issueId, status }) => {
  const { data } = await apiClient.post(`/api/issues/${issueId}/transition/${status}`)
  return data
}

export const assignIssueToSprint = async ({ issueId, sprintId }) => {
  const { data } = await apiClient.post(`/api/issues/${issueId}/assign-sprint/${sprintId}`)
  return data
}

export const removeIssueFromSprint = async ({ issueId }) => {
  const { data } = await apiClient.post(`/api/issues/${issueId}/remove-sprint`)
  return data
}

export const archiveIssue = async ({ issueId }) => {
  const { data } = await apiClient.delete(`/api/issues/${issueId}`)
  return data
}

export const deleteIssueHard = async ({ issueId }) => {
  const { data } = await apiClient.delete(`/api/issues/${issueId}/hard`)
  return data
}

export const bulkUpdateIssues = async ({ issueIds, updates }) => {
  const { data } = await apiClient.post('/api/issues/bulk', {
    issue_ids: issueIds,
    updates,
  })
  return data
}
