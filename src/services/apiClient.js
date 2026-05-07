import axios from 'axios'

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',
  headers: {
    'Content-Type': 'application/json',
  },
})

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('pms_auth_token')
  const projectRole = localStorage.getItem('pms_project_role') || 'lead'
  if (token) {
    config.headers['X-Auth-Token'] = token
  }
  config.headers['X-Project-Role'] = projectRole
  return config
})

export const getApiErrorMessage = (error) => {
  const detail = error?.response?.data?.detail

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && item.msg) return item.msg
        return null
      })
      .filter(Boolean)

    if (messages.length > 0) {
      return messages.join(', ')
    }
  }

  if (typeof detail === 'string' && detail.trim()) {
    return detail
  }

  return 'Request failed. Please try again.'
}

export default apiClient
