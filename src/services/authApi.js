import apiClient from './apiClient'

export const signUp = async (payload) => {
  const { data } = await apiClient.post('/api/auth/signup', payload)
  return data
}

export const verifySignUpOtp = async (payload) => {
  const { data } = await apiClient.post('/api/auth/signup/verify', payload)
  return data
}

export const signIn = async (payload) => {
  const { data } = await apiClient.post('/api/auth/signin', payload)
  return data
}

export const forgotPassword = async (payload) => {
  const { data } = await apiClient.post('/api/auth/forgot-password', payload)
  return data
}

export const fetchMe = async () => {
  const { data } = await apiClient.get('/api/auth/me')
  return data
}

export const fetchInvite = async (inviteToken) => {
  const { data } = await apiClient.get(`/api/auth/invites/${inviteToken}`)
  return data
}

export const acceptInvite = async (inviteToken) => {
  const { data } = await apiClient.post(`/api/auth/invites/${inviteToken}/accept`)
  return data
}

export const rejectInvite = async (inviteToken) => {
  const { data } = await apiClient.post(`/api/auth/invites/${inviteToken}/reject`)
  return data
}

export const completeOnboarding = async (payload) => {
  const { data } = await apiClient.post('/api/auth/onboarding', payload)
  return data
}
