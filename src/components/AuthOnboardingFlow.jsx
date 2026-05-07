import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { completeOnboarding, fetchInvite, forgotPassword, rejectInvite, signIn, signUp, verifySignUpOtp } from '../services/authApi'
import { getApiErrorMessage } from '../services/apiClient'
import BackNavigationButton from './BackNavigationButton'

const domainOptions = [
  {
    label: 'Software Development',
    value: 'software development',
    description: 'Agile workflows, sprint planning, and code integration for tech teams.',
    icon: '⌨️',
  },
  {
    label: 'Marketing',
    value: 'marketing',
    description: 'Campaign tracking, content calendars, and performance analytics.',
    icon: '📣',
  },
  {
    label: 'HR & Recruitment',
    value: 'hr',
    description: 'Onboarding pipelines, talent sourcing, and employee engagement.',
    icon: '👥',
  },
  {
    label: 'Operations',
    value: 'operations',
    description: 'Process optimization, supply chain, and internal infrastructure.',
    icon: '⚙️',
  },
  {
    label: 'Sales',
    value: 'sales',
    description: 'CRM management, deal pipelines, and revenue forecasting.',
    icon: '📈',
  },
  {
    label: 'Customer Support',
    value: 'support',
    description: 'Ticketing systems, knowledge base, and client satisfaction.',
    icon: '🎧',
  },
]

const useCaseOptions = ['Work in progress', 'Run sprints', 'Manage disks', 'Track bugs', 'Prioritize work']

const defaultColumns = ['To Do', 'In Progress', 'In Review', 'Done']
const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

const generateStrongPassword = (length = 14) => {
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lowercase = 'abcdefghijkmnopqrstuvwxyz'
  const numbers = '23456789'
  const symbols = '!@#$%^&*()-_=+[]{};:,.?'
  const all = `${uppercase}${lowercase}${numbers}${symbols}`
  const bytes = new Uint32Array(length)
  window.crypto.getRandomValues(bytes)

  const chars = [
    uppercase[bytes[0] % uppercase.length],
    lowercase[bytes[1] % lowercase.length],
    numbers[bytes[2] % numbers.length],
    symbols[bytes[3] % symbols.length],
  ]

  for (let index = 4; index < length; index += 1) {
    chars.push(all[bytes[index] % all.length])
  }

  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = bytes[index % bytes.length] % (index + 1)
    const next = chars[index]
    chars[index] = chars[swapIndex]
    chars[swapIndex] = next
  }

  return chars.join('')
}

const getPasswordStrength = (value) => {
  const hasUpper = /[A-Z]/.test(value)
  const hasLower = /[a-z]/.test(value)
  const hasNumber = /\d/.test(value)
  const hasSpecial = /[^A-Za-z0-9]/.test(value)
  const hasLength = value.length >= 10
  const score = [hasUpper, hasLower, hasNumber, hasSpecial, hasLength].filter(Boolean).length

  if (score <= 2) return { label: 'Weak', tone: 'text-red-600' }
  if (score <= 4) return { label: 'Medium', tone: 'text-amber-600' }
  return { label: 'Strong', tone: 'text-emerald-600' }
}

export default function AuthOnboardingFlow({ onAuthenticated, initialMode = 'signin' }) {
  const inviteParams = new URLSearchParams(window.location.search)
  const inviteToken = inviteParams.get('invite_token') || ''
  const inviteAction = inviteParams.get('invite_action') || 'accept'
  const queryAuthMode = inviteParams.get('auth_mode') || ''
  const [mode, setMode] = useState(initialMode === 'signup' ? 'signup' : 'signin')
  const [step, setStep] = useState('auth')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [domain, setDomain] = useState('software development')
  const [useCases, setUseCases] = useState([])
  const [spaceName, setSpaceName] = useState('')
  const [columns, setColumns] = useState(defaultColumns)
  const [newColumn, setNewColumn] = useState('')
  const [inviteText, setInviteText] = useState('')
  const [oauthMessage, setOauthMessage] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [suggestedPassword, setSuggestedPassword] = useState('')
  const [showPasswordHelper, setShowPasswordHelper] = useState(false)
  const [signupOtp, setSignupOtp] = useState('')
  const [signupNeedsOtp, setSignupNeedsOtp] = useState(false)
  const [otpRequestedEmail, setOtpRequestedEmail] = useState('')
  const [signupMessage, setSignupMessage] = useState('')
  const [signupDevOtp, setSignupDevOtp] = useState('')
  const [signupValidationError, setSignupValidationError] = useState('')
  const [inviteStatusMessage, setInviteStatusMessage] = useState('')
  const [inviteCopyStatus, setInviteCopyStatus] = useState('')
  const [showForgotPasswordForm, setShowForgotPasswordForm] = useState(false)
  const [forgotPasswordMessage, setForgotPasswordMessage] = useState('')
  const isSoftwareDomain = domain === 'software development'

  const inviteQuery = useMutation({
    mutationFn: fetchInvite,
    onSuccess: (details) => {
      if (details?.email) {
        setEmail(details.email)
      }
    },
  })

  const rejectInviteMutation = useMutation({
    mutationFn: rejectInvite,
    onSuccess: (details) => {
      setInviteStatusMessage(`Invitation rejected for project ${details.project_name}.`)
    },
  })

  useEffect(() => {
    if (!inviteToken) return
    if (inviteAction === 'reject') {
      if (!rejectInviteMutation.isPending && !rejectInviteMutation.isSuccess && !rejectInviteMutation.error) {
        rejectInviteMutation.mutate(inviteToken)
      }
      return
    }
    if (inviteQuery.isSuccess || inviteQuery.isPending || inviteQuery.error) return
    inviteQuery.mutate(inviteToken)
  }, [inviteAction, inviteQuery, inviteToken, rejectInviteMutation])

  useEffect(() => {
    if (queryAuthMode === 'signup' || queryAuthMode === 'signin') {
      setMode(queryAuthMode)
      return
    }
    setMode(initialMode === 'signup' ? 'signup' : 'signin')
  }, [initialMode, queryAuthMode])

  useEffect(() => {
    if (step === 'usage') {
      setStep('space')
    }
  }, [step])

  useEffect(() => {
    if (mode !== 'signup') {
      setSignupNeedsOtp(false)
      setOtpRequestedEmail('')
      setSignupOtp('')
      setSignupMessage('')
      setSignupDevOtp('')
      setSignupValidationError('')
      setShowPasswordHelper(false)
      setInviteCopyStatus('')
    }
  }, [mode])

  const signInMutation = useMutation({
    mutationFn: signIn,
    onSuccess: (response) => {
      localStorage.setItem('pms_auth_token', response.token)
      if (response.invited_project_id) {
        localStorage.setItem('pms_last_project_id', response.invited_project_id)
      }
      if (response.user.onboarding_completed) {
        onAuthenticated(response.user)
      } else {
        setUsername(response.user.username || username)
        setStep('domain')
      }
    },
  })

  const forgotPasswordMutation = useMutation({
    mutationFn: forgotPassword,
    onSuccess: (response) => {
      setForgotPasswordMessage(response?.message || 'Password updated successfully')
      setShowForgotPasswordForm(false)
      setPassword('')
    },
  })

  const signUpMutation = useMutation({
    mutationFn: signUp,
    onSuccess: (response) => {
      if (response?.verification_required) {
        setOtpRequestedEmail(email.trim().toLowerCase())
        setSignupNeedsOtp(true)
        setSignupMessage(response.message || 'Verification code sent to your email')
        setSignupDevOtp(response.dev_otp || '')
        return
      }

      localStorage.setItem('pms_auth_token', response.token)
      if (response.invited_project_id) {
        localStorage.setItem('pms_last_project_id', response.invited_project_id)
      }
      if (response.user.onboarding_completed) {
        onAuthenticated(response.user)
      } else {
        setUsername(response.user.username || username)
        setStep('domain')
      }
    },
  })

  const verifyOtpMutation = useMutation({
    mutationFn: verifySignUpOtp,
    onSuccess: (response) => {
      localStorage.setItem('pms_auth_token', response.token)
      if (response.invited_project_id) {
        localStorage.setItem('pms_last_project_id', response.invited_project_id)
      }
      if (response.user.onboarding_completed) {
        onAuthenticated(response.user)
      } else {
        setUsername(response.user.username || username)
        setStep('domain')
      }
    },
  })

  const onboardingMutation = useMutation({
    mutationFn: completeOnboarding,
    onSuccess: (user) => {
      onAuthenticated(user)
    },
  })

  const inviteEmails = useMemo(() => inviteText.split(',').map((item) => item.trim()).filter(Boolean), [inviteText])

  const toggleUseCase = (value) => {
    setUseCases((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]))
  }

  const addColumn = () => {
    const trimmed = newColumn.trim()
    if (!trimmed) return
    setColumns((current) => [...current, trimmed])
    setNewColumn('')
  }

  const removeColumn = (indexToRemove) => {
    setColumns((current) => current.filter((_, index) => index !== indexToRemove))
  }

  const submitSignIn = (event) => {
    event.preventDefault()
    setForgotPasswordMessage('')
    signInMutation.mutate({ email, password, invite_token: inviteToken || undefined })
  }

  const submitForgotPassword = (event) => {
    event.preventDefault()
    setForgotPasswordMessage('')
    forgotPasswordMutation.mutate({ email, new_password: password })
  }

  const submitSignUp = (event) => {
    event.preventDefault()
    setSignupValidationError('')
    const normalizedEmail = email.trim().toLowerCase()

    if (!emailRegex.test(normalizedEmail)) {
      return
    }

    if (signupNeedsOtp && otpRequestedEmail === normalizedEmail) {
      verifyOtpMutation.mutate({ email, otp: signupOtp })
      return
    }

    signUpMutation.mutate({ email, password, username, invite_token: inviteToken || undefined })
  }

  const submitOnboarding = () => {
    onboardingMutation.mutate({
      domain,
      team_use_cases: useCases,
      space_name: spaceName,
      board_columns: columns,
      invite_emails: [],
    })
  }

  const authError = signInMutation.error || signUpMutation.error || verifyOtpMutation.error
  const forgotPasswordError = forgotPasswordMutation.error
  const passwordStrength = useMemo(() => getPasswordStrength(password), [password])
  const normalizedSignupEmail = email.trim().toLowerCase()
  const isSignupEmailValid = emailRegex.test(normalizedSignupEmail)
  const showSignupEmailError = mode === 'signup' && step === 'auth' && normalizedSignupEmail.length > 0 && !isSignupEmailValid
  const canRequestOtp = isSignupEmailValid && username.trim().length > 0 && password.trim().length > 0
  const canVerifyOtp = isSignupEmailValid && signupOtp.trim().length > 0 && otpRequestedEmail === normalizedSignupEmail
  const inviteLink = `${window.location.origin}/?auth_mode=signup`

  if (step === 'auth' && mode === 'signin') {
    return (
      <div className="min-h-screen bg-[#f3f4f8] text-slate-900">
        <div className="px-6 pt-4 lg:px-10">
          <BackNavigationButton className="bg-white/90" fallbackPath="/" />
        </div>

        <div className="grid min-h-[calc(100vh-64px)] grid-cols-1 lg:grid-cols-2">
          <section className="relative hidden lg:flex lg:flex-col lg:justify-end lg:overflow-hidden">
            <img
              src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1200&q=80"
              alt="Team collaborating"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent" />
            <div className="relative z-10 px-10 pb-14 text-white">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm backdrop-blur">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-pink-600 text-xs">⚡</span>
                PMS
              </div>
              <h2 className="mb-3 max-w-md text-5xl font-semibold leading-tight">Empower your team's creativity.</h2>
              <p className="max-w-md text-base text-white/85">The digital atelier for high-output projects and fluid collaboration.</p>
            </div>
          </section>

          <section className="flex items-center justify-center px-6 py-10 lg:px-10">
            <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-[#0b1220] p-8 shadow-sm">
              <h1 className="text-4xl font-semibold text-white">Welcome back</h1>
              <p className="mt-2 text-sm text-slate-300">Please enter your details to continue your work.</p>
              {inviteStatusMessage && <p className="mt-2 text-sm text-amber-700">{inviteStatusMessage}</p>}

              <div className="mt-6 grid grid-cols-2 rounded-xl bg-[#111827] p-1 text-sm">
                <button
                  type="button"
                  className="rounded-lg bg-[#1f2937] py-2 font-medium text-white shadow-sm"
                  onClick={() => setMode('signin')}
                >
                  Login
                </button>
                <button
                  type="button"
                  className="rounded-lg py-2 text-slate-300"
                  onClick={() => setMode('signup')}
                >
                  Sign up
                </button>
              </div>

              <form className="mt-6 space-y-4" onSubmit={showForgotPasswordForm ? submitForgotPassword : submitSignIn}>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-300">Email address</label>
                  <input
                    type="email"
                    className="w-full rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2.5 text-sm text-white outline-none ring-blue-500/30 focus:ring placeholder:text-slate-400"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {showForgotPasswordForm ? 'New password' : 'Password'}
                    </label>
                    <button
                      type="button"
                      className="text-xs text-pink-700 hover:underline"
                      onClick={() => {
                        setShowForgotPasswordForm((current) => !current)
                        setForgotPasswordMessage('')
                      }}
                    >
                      {showForgotPasswordForm ? 'Back to sign in' : 'Forgot password?'}
                    </button>
                  </div>
                  <input
                    type="password"
                    className="w-full rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2.5 text-sm text-white outline-none ring-blue-500/30 focus:ring placeholder:text-slate-400"
                    placeholder={showForgotPasswordForm ? 'Enter new password' : '••••••••'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </div>

                {showForgotPasswordForm && forgotPasswordMessage && <p className="text-sm text-emerald-700">{forgotPasswordMessage}</p>}
                {showForgotPasswordForm && forgotPasswordError && <p className="text-sm text-red-600">{getApiErrorMessage(forgotPasswordError)}</p>}
                {!showForgotPasswordForm && authError && <p className="text-sm text-red-600">{getApiErrorMessage(authError)}</p>}

                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300" />
                  Keep me logged in for 30 days
                </label>

                <button
                  type="submit"
                  className="w-full rounded-xl bg-gradient-to-r from-pink-700 to-fuchsia-600 px-4 py-3 text-sm font-semibold text-white shadow-sm"
                  disabled={signInMutation.isPending || forgotPasswordMutation.isPending}
                >
                  {showForgotPasswordForm
                    ? forgotPasswordMutation.isPending
                      ? 'Updating...'
                      : 'Update password'
                    : signInMutation.isPending
                      ? 'Signing in...'
                      : 'Sign In'}
                </button>
              </form>

              <div className="mt-6">
                <p className="relative text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  <span className="bg-[#0b1220] px-2">Or continue with</span>
                  <span className="absolute left-0 top-1/2 -z-10 h-px w-full -translate-y-1/2 bg-slate-700" />
                </p>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-600 bg-[#0f172a] py-2.5 text-white"
                    onClick={() => setOauthMessage('Google authentication is coming soon.')}
                  >
                    Google
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-600 bg-[#0f172a] py-2.5 text-white"
                    onClick={() => setOauthMessage('GitHub authentication is coming soon.')}
                  >
                    GitHub
                  </button>
                </div>
                {oauthMessage && <p className="mt-3 text-center text-sm text-slate-300">{oauthMessage}</p>}
              </div>
            </div>
          </section>
        </div>

        <footer className="flex flex-col justify-between gap-3 border-t border-slate-200 px-6 py-5 text-xs text-slate-500 md:flex-row lg:px-10">
          <p>© 2024 PMS. Designed for high-output creativity.</p>
          <div className="flex gap-4">
            <button type="button" className="hover:underline">Privacy</button>
            <button type="button" className="hover:underline">Terms</button>
            <button type="button" className="hover:underline">API Docs</button>
            <button type="button" className="hover:underline">System Status</button>
          </div>
        </footer>
      </div>
    )
  }

  if (step === 'auth' && mode === 'signup') {
    return (
      <div className="min-h-screen bg-[#f3f4f8] px-6 py-8 text-slate-900 lg:px-10">
        <header className="mb-8 flex items-center justify-between">
          <BackNavigationButton className="bg-white/90" fallbackPath="/" onFallback={() => setMode('signin')} />
          <h1 className="text-3xl font-semibold text-pink-700">PMS</h1>
        </header>

        <div className="mx-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <form onSubmit={submitSignUp}>
            <div className="mb-8 text-center">
              <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-xl bg-[#f6eef2] text-2xl text-pink-700">
                👥
              </div>
              <h2 className="text-4xl font-semibold">Create your account</h2>
              <p className="mt-2 text-sm text-slate-500">{email || 'testuser@gmail.com'}</p>
              {inviteStatusMessage && <p className="mt-2 text-sm text-amber-700">{inviteStatusMessage}</p>}
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">Email address</label>
                <input
                  type="email"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-500 focus:ring focus:ring-blue-500/30"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(event) => {
                    const nextEmail = event.target.value
                    setEmail(nextEmail)
                    setSignupValidationError('')

                    if (nextEmail.trim().toLowerCase() !== otpRequestedEmail) {
                      setSignupNeedsOtp(false)
                      setSignupOtp('')
                      setSignupMessage('')
                      setSignupDevOtp('')
                    }
                  }}
                  required
                />
                {showSignupEmailError && <p className="mt-1 text-xs text-red-600">Invalid email address</p>}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">Username</label>
                <input
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-500 focus:ring focus:ring-blue-500/30"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="Pick a unique username"
                  required
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 pr-11 text-sm text-slate-900 outline-none placeholder:text-slate-500 focus:ring focus:ring-blue-500/30"
                    placeholder="At least 10 characters"
                    value={password}
                    onFocus={() => {
                      if (!suggestedPassword) {
                        setSuggestedPassword(generateStrongPassword())
                      }
                      setShowPasswordHelper(true)
                    }}
                    onChange={(event) => {
                      setPassword(event.target.value)
                      setShowPasswordHelper(true)
                    }}
                    required
                  />
                  <button
                    type="button"
                    className="absolute inset-y-0 right-3 text-sm text-slate-500"
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
                <p className={`mt-2 text-xs font-semibold ${passwordStrength.tone}`}>
                  Strength: {passwordStrength.label}
                </p>
                {showPasswordHelper && (
                  <button
                    type="button"
                    className="mt-2 rounded-lg border border-slate-700 bg-black px-3 py-2 text-left text-xs text-white"
                    onClick={() => {
                      const generated = generateStrongPassword()
                      setSuggestedPassword(generated)
                      setPassword(generated)
                    }}
                  >
                    Suggested strong password: <span className="font-semibold">{suggestedPassword}</span>
                    <span className="ml-1 underline">Use this</span>
                  </button>
                )}
              </div>

              {signupNeedsOtp && otpRequestedEmail === normalizedSignupEmail && (
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-white">Verification OTP</label>
                  <input
                    className="w-full rounded-lg border-2 border-blue-400 bg-white px-3 py-2.5 text-base font-semibold tracking-wide text-black outline-none ring-blue-500/30 focus:ring"
                    placeholder="Enter 6-digit OTP"
                    value={signupOtp}
                    onChange={(event) => setSignupOtp(event.target.value)}
                    required
                  />
                  {signupMessage && <p className="mt-2 text-xs text-emerald-700">{signupMessage}</p>}
                  {signupDevOtp && (
                    <button
                      type="button"
                      className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800"
                      onClick={() => setSignupOtp(signupDevOtp)}
                    >
                      Dev OTP: {signupDevOtp} (click to use)
                    </button>
                  )}
                  <button
                    type="button"
                    className="mt-2 text-xs font-semibold text-pink-700 hover:underline disabled:text-slate-400"
                    onClick={() => signUpMutation.mutate({ email, password, username, invite_token: inviteToken || undefined })}
                    disabled={!isSignupEmailValid || signUpMutation.isPending}
                  >
                    Resend OTP
                  </button>
                </div>
              )}

              {signupValidationError && <p className="text-sm text-red-600">{signupValidationError}</p>}
              {authError && (
                <p className="text-sm text-red-600">
                  {getApiErrorMessage(authError)}
                  {String(getApiErrorMessage(authError)).toLowerCase().includes('already registered') ? ' Use Sign In instead.' : ''}
                </p>
              )}

              <button
                type="submit"
                className="w-full rounded-xl bg-gradient-to-r from-pink-700 to-fuchsia-600 px-4 py-3 text-sm font-semibold text-white"
                disabled={
                  signUpMutation.isPending
                  || verifyOtpMutation.isPending
                  || (signupNeedsOtp && otpRequestedEmail === normalizedSignupEmail ? !canVerifyOtp : !canRequestOtp)
                }
              >
                {verifyOtpMutation.isPending
                  ? 'Verifying OTP...'
                  : signUpMutation.isPending
                    ? 'Sending OTP...'
                    : signupNeedsOtp
                      ? 'Verify and create account'
                      : 'Create account'}
              </button>

              <button
                type="button"
                className="w-full rounded-xl bg-slate-100 px-4 py-3 text-sm font-medium text-slate-800"
                onClick={() => setMode('signin')}
              >
                Switch to Sign In
              </button>
            </div>

            {/* OAuth buttons removed for signup page */}

            <p className="mt-6 text-center text-xs text-slate-500">
              By creating an account, you agree to our <span className="font-medium text-pink-700">Terms of Service</span> and{' '}
              <span className="font-medium text-pink-700">Privacy Policy</span>
            </p>
          </form>
        </div>

        <footer className="mt-10 flex flex-col justify-between gap-3 border-t border-slate-200 pt-5 text-xs text-slate-500 md:flex-row">
          <p>© 2024 RADIANT WORKSPACE. DESIGNED FOR HIGH-OUTPUT CREATORS.</p>
          <div className="flex gap-4">
            <button type="button" className="hover:underline">PRIVACY POLICY</button>
            <button type="button" className="hover:underline">TERMS OF SERVICE</button>
            <button type="button" className="hover:underline">HELP CENTER</button>
          </div>
        </footer>
      </div>
    )
  }

  if (step === 'domain') {
    return (
      <div className="min-h-screen bg-[#f3f4f8] px-6 py-6 text-slate-900 lg:px-10">
        <header className="flex items-center justify-between text-sm">
          <BackNavigationButton className="bg-white/90" fallbackPath="/" onFallback={() => setMode('signin')} />
          <button type="button" className="text-4xl font-semibold text-pink-700" onClick={() => setMode('signin')}>
            PMS
          </button>
          <button type="button" className="text-slate-700">Exit</button>
        </header>

        <div className="mx-auto max-w-5xl pt-8 text-center">
          <div className="mb-5 text-xs text-slate-500">● ○ ○</div>
          <h2 className="mx-auto max-w-2xl text-5xl font-semibold leading-tight">What type of work do you do?</h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-600">
            Tell us a bit about your work to help us tailor your experience.
          </p>

          <div className="mt-10 grid gap-4 text-left md:grid-cols-2 lg:grid-cols-3">
            {domainOptions.map((option) => {
              const selected = domain === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDomain(option.value)}
                  className={`rounded-2xl border p-6 transition ${
                    selected
                      ? 'border-pink-500 bg-white shadow-sm ring-1 ring-pink-200'
                      : 'border-slate-200 bg-white/75 hover:border-pink-200'
                  }`}
                >
                  <div className="mb-5 flex items-start justify-between">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#f8edf2] text-lg text-pink-700">
                      {option.icon}
                    </span>
                    <span className={`inline-block h-4 w-4 rounded-full border ${selected ? 'border-pink-600 bg-pink-600' : 'border-pink-300'}`} />
                  </div>
                  <h3 className={`text-2xl font-semibold ${selected ? 'text-slate-100' : 'text-slate-900'}`}>{option.label}</h3>
                  <p className={`mt-2 text-sm leading-6 ${selected ? 'text-slate-300' : 'text-slate-600'}`}>{option.description}</p>
                </button>
              )
            })}
          </div>

          <button
            className="mt-10 rounded-xl bg-gradient-to-r from-pink-700 to-fuchsia-600 px-16 py-3.5 text-lg font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              if (isSoftwareDomain) {
                    setStep('space')
              }
            }}
            disabled={!isSoftwareDomain}
          >
            Continue
          </button>

          {!isSoftwareDomain && (
            <p className="mt-4 text-sm font-medium text-amber-700">
              Only Software Development is available right now. Please select it to continue.
            </p>
          )}

          <p className="mt-5 text-xs font-semibold uppercase tracking-widest text-pink-200">You can change this later in settings</p>
        </div>
      </div>
    )
  }

  if (step === 'usage') {
    return (
      <div className="min-h-screen bg-[#f3f4f8] px-6 py-5 text-slate-900 lg:px-10">
        <header className="flex items-center justify-between">
          <BackNavigationButton className="bg-white/90" fallbackPath="/" onFallback={() => setStep('domain')} />
          <h1 className="text-4xl font-semibold text-pink-700">PMS</h1>
          <nav className="hidden items-center gap-8 text-lg text-slate-700 md:flex">
            <button type="button" className="border-b-2 border-pink-700 pb-1 font-semibold text-pink-700">Onboarding</button>
          </nav>
          <div className="hidden items-center gap-5 text-xl md:flex">
            <span>🔔</span>
            <span>⚙️</span>
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-cyan-800 text-sm text-white">👤</span>
          </div>
        </header>

        <main className="mx-auto mt-10 grid max-w-6xl gap-10 lg:grid-cols-2">
          <section>
            <h2 className="mt-4 text-6xl font-semibold leading-tight">How does your team plan to use <span className="text-pink-700">PMS?</span></h2>
            <p className="mt-4 max-w-lg text-3xl text-slate-600">Help us tailor your workspace. Select all that apply to your current workflow.</p>

            <div className="mt-8 space-y-3">
              {useCaseOptions.map((option) => (
                <label key={option} className="flex cursor-pointer items-center gap-4 rounded-xl border border-slate-200 bg-white/70 px-4 py-3.5 text-2xl">
                  <input
                    type="checkbox"
                    className="h-5 w-5 rounded border-slate-300"
                    checked={useCases.includes(option)}
                    onChange={() => toggleUseCase(option)}
                  />
                  {option}
                </label>
              ))}
            </div>

            <button
              className="mt-10 rounded-xl bg-gradient-to-r from-pink-700 to-fuchsia-600 px-10 py-4 text-2xl font-semibold text-white shadow-sm"
              onClick={() => setStep('space')}
            >
              Continue →
            </button>
          </section>

          <section className="space-y-4">
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <img
                src="https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1000&q=80"
                alt="Workspace"
                className="h-72 w-full object-cover"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-3xl bg-gradient-to-br from-pink-700 to-fuchsia-600 p-6 text-white">
                <p className="text-3xl">✦</p>
                <p className="mt-8 text-4xl font-semibold leading-tight">Optimized Workflows</p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-white p-6">
                <p className="text-3xl">👥</p>
                <p className="mt-8 text-4xl font-semibold text-pink-700">12+ Teams</p>
                <p className="mt-2 text-lg text-slate-500">Shipping faster with PMS</p>
              </div>
            </div>
          </section>
        </main>

        <footer className="mt-12 flex flex-col justify-between gap-3 border-t border-slate-200 pt-5 text-xs text-slate-500 md:flex-row">
          <p>© 2024 RADIANT WORKSPACE. ALL RIGHTS RESERVED.</p>
          <div className="flex gap-4">
            <button type="button" className="hover:underline">PRIVACY POLICY</button>
            <button type="button" className="hover:underline">TERMS OF SERVICE</button>
            <button type="button" className="hover:underline">HELP CENTER</button>
          </div>
        </footer>
      </div>
    )
  }

  if (step === 'space') {
    return (
      <div className="min-h-screen bg-[#f3f4f8] px-6 py-10 text-slate-900 lg:px-12">
        <div className="mx-auto max-w-6xl">
          <BackNavigationButton className="bg-white/90" fallbackPath="/" onFallback={() => setStep('domain')} />
        </div>

        <main className="mx-auto mt-10 grid max-w-6xl gap-10 lg:grid-cols-2">
          <section>
            <p className="inline-flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.16em] text-pink-700">
              <span className="inline-block h-0.5 w-10 bg-pink-700" /> PMS onboarding
            </p>
            <h2 className="mt-6 text-7xl font-semibold leading-[1.05]">Welcome, set your <span className="text-pink-700">space.</span></h2>
            <p className="mt-4 max-w-xl text-3xl text-slate-600">
              Your digital atelier starts here. Create a dedicated workspace for your projects, team members, and high-impact goals.
            </p>

            <div className="mt-10 space-y-7">
              <div className="flex items-start gap-3">
                <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#f8edf2] text-pink-700">✦</span>
                <div>
                  <p className="text-3xl font-semibold">Smart Organization</p>
                  <p className="text-lg text-slate-500">Automated task grouping based on your workflow.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#f8edf2] text-pink-700">👥</span>
                <div>
                  <p className="text-3xl font-semibold">Seamless Collaboration</p>
                  <p className="text-lg text-slate-500">Invite your team to create together in real-time.</p>
                </div>
              </div>
            </div>
          </section>

          <section className="relative rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Workspace identity</p>
            <h3 className="mt-2 text-5xl font-semibold">Name your first project</h3>
            <label className="mt-6 block text-xl">Project or Workspace Name</label>
            <input
              className="mt-3 w-full rounded-xl border border-[#efe3e9] bg-[#fbf6f8] px-4 py-3 text-2xl outline-none ring-pink-600/30 focus:ring"
              value={spaceName}
              onChange={(event) => setSpaceName(event.target.value)}
              placeholder="e.g. Creative Studio 2024"
            />
            <p className="mt-3 text-sm italic text-slate-400">This will be the primary name visible to your team members.</p>

            <button
              className="mt-8 w-full rounded-xl bg-gradient-to-r from-pink-700 to-fuchsia-600 px-6 py-4 text-2xl font-semibold text-white"
              onClick={() => setStep('board')}
              disabled={!spaceName.trim()}
            >
              Continue →
            </button>

            <div className="mt-8 flex items-center justify-between text-sm text-slate-500">
              <p>● ○ ○</p>
            </div>

            <div className="mt-5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              <span className="font-semibold">💬</span> “Setting this up took me <span className="font-semibold text-pink-700">under 1 min.</span>”
            </div>
          </section>
        </main>

        <footer className="mt-12 flex flex-col justify-between gap-3 border-t border-slate-200 pt-5 text-xs text-slate-500 md:flex-row">
          <p>© 2024 RADIANT WORKSPACE. ALL RIGHTS RESERVED.</p>
          <div className="flex gap-4">
            <button type="button" className="hover:underline">PRIVACY POLICY</button>
            <button type="button" className="hover:underline">TERMS OF SERVICE</button>
            <button type="button" className="hover:underline">HELP CENTER</button>
          </div>
        </footer>
      </div>
    )
  }

  if (step === 'board') {
    return (
      <div className="min-h-screen bg-[#f3f4f8] px-6 py-5 text-slate-900 lg:px-10">
        <header className="flex items-center justify-between">
          <BackNavigationButton className="bg-white/90" fallbackPath="/" onFallback={() => setStep('space')} />
          <h1 className="text-4xl font-semibold text-pink-700">PMS</h1>
          <nav className="hidden items-center gap-8 text-lg text-slate-700 md:flex">
            <button type="button" className="border-b-2 border-pink-700 pb-1 font-semibold text-pink-700">Onboarding</button>
          </nav>
          <div className="hidden items-center gap-5 text-xl md:flex">
            <span>🔔</span>
            <span>⚙️</span>
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-cyan-800 text-sm text-white">👤</span>
          </div>
        </header>

        <main className="mx-auto mt-8 grid max-w-6xl gap-8 lg:grid-cols-2">
          <section>
            <h2 className="mt-4 text-6xl font-semibold leading-tight">How do you track work?</h2>
            <p className="mt-3 max-w-lg text-3xl text-slate-600">
              Customize your workflow by defining the stages that represent the movement of tasks from start to finish.
            </p>

            <div className="mt-8 space-y-3">
              {columns.map((column, index) => (
                <div key={`${column}-${index}`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white/80 px-4 py-3.5 text-2xl">
                  <div className="flex items-center gap-3">
                    <span className="text-pink-200">⠿</span>
                    <span>{column}</span>
                  </div>
                  <button type="button" className="text-pink-200 hover:text-pink-500" onClick={() => removeColumn(index)}>
                    ✕
                  </button>
                </div>
              ))}

              <div className="flex gap-2 rounded-xl border border-dashed border-pink-300 bg-white/60 px-4 py-3.5">
                <input
                  className="flex-1 bg-transparent text-2xl outline-none"
                  value={newColumn}
                  onChange={(event) => setNewColumn(event.target.value)}
                  placeholder="+ Add another stage"
                />
                <button type="button" className="text-xl font-semibold text-pink-700" onClick={addColumn}>
                  +
                </button>
              </div>
            </div>

            <div className="mt-10 flex items-center gap-8">
              <button
                className="rounded-xl bg-gradient-to-r from-pink-700 to-fuchsia-600 px-8 py-3 text-2xl font-semibold text-white"
                onClick={submitOnboarding}
                disabled={onboardingMutation.isPending}
              >
                {onboardingMutation.isPending ? 'Finishing...' : 'Continue'}
              </button>
              <button type="button" className="text-2xl font-semibold text-pink-700" onClick={() => setStep('space')}>
                Go Back
              </button>
            </div>
            {onboardingMutation.error && (
              <p className="mt-3 text-sm text-red-600">{getApiErrorMessage(onboardingMutation.error)}</p>
            )}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white/75 p-6">
            <h3 className="text-4xl font-semibold">Preview: Project Board</h3>
            <div className="mt-6 grid grid-cols-3 gap-3">
              <div className="rounded-2xl bg-[#f3eef1] p-3">
                <p className="text-xs font-semibold uppercase text-slate-500">To Do</p>
                <div className="mt-3 rounded-xl bg-white p-3 text-sm shadow-sm">
                  <p className="font-medium">Review brand guidelines</p>
                </div>
                <div className="mt-2 rounded-xl bg-white p-3 text-sm shadow-sm">
                  <p className="font-medium">Draft website copy</p>
                </div>
              </div>
              <div className="rounded-2xl bg-[#f3eef1] p-3">
                <p className="text-xs font-semibold uppercase text-slate-500">In Progress</p>
                <div className="mt-3 rounded-xl bg-white p-3 text-sm shadow-sm">
                  <p className="font-medium">Interface design system</p>
                </div>
              </div>
              <div className="rounded-2xl bg-[#f3eef1] p-3">
                <p className="text-xs font-semibold uppercase text-slate-500">In Review</p>
                <div className="mt-3 h-[152px] rounded-xl border border-dashed border-slate-200" />
              </div>
            </div>
          </section>
        </main>

        <footer className="mt-12 flex flex-col justify-between gap-3 border-t border-slate-200 pt-5 text-xs text-slate-500 md:flex-row">
          <p>© 2024 RADIANT WORKSPACE. ALL RIGHTS RESERVED.</p>
          <div className="flex gap-4">
            <button type="button" className="hover:underline">PRIVACY POLICY</button>
            <button type="button" className="hover:underline">TERMS OF SERVICE</button>
            <button type="button" className="hover:underline">HELP CENTER</button>
          </div>
        </footer>
      </div>
    )
  }

  if (step === 'invite') {
    return null
  }

  return null
}
