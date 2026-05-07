import { useState } from 'react'

const initialState = {
  name: '',
  key: '',
  description: '',
  lead: '',
  project_type: 'software',
}

const generateProjectKeyFromName = (name) => {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (!words.length) return ''

  const initials = words.map((word) => word[0]).join('')
  const alnumInitials = initials.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (alnumInitials.length >= 2) return alnumInitials.slice(0, 10)

  const compact = words.join('').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (compact.length >= 2) return compact.slice(0, 10)

  return 'PR'
}

export default function ProjectForm({ onSubmit, loading }) {
  const [form, setForm] = useState(initialState)
  const [isKeyManuallyEdited, setIsKeyManuallyEdited] = useState(false)

  const handleSubmit = (event) => {
    event.preventDefault()
    onSubmit(form)
    setForm(initialState)
    setIsKeyManuallyEdited(false)
  }

  return (
    <form onSubmit={handleSubmit} className="rounded bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Create project</h2>
      <div className="mb-3">
        <label className="mb-1 block text-sm">Name</label>
        <input
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          value={form.name}
          onChange={(event) => {
            const name = event.target.value
            setForm((current) => ({
              ...current,
              name,
              key: isKeyManuallyEdited ? current.key : generateProjectKeyFromName(name),
            }))
          }}
          required
        />
      </div>
      <div className="mb-3">
        <label className="mb-1 block text-sm">Key</label>
        <input
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm uppercase"
          value={form.key}
          onChange={(event) => {
            setIsKeyManuallyEdited(true)
            setForm({ ...form, key: event.target.value.toUpperCase() })
          }}
          placeholder="Optional (auto-generated if empty)"
        />
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-sm">Description</label>
        <textarea
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          rows={3}
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
        />
      </div>
      <div className="mb-3">
        <label className="mb-1 block text-sm">Project lead</label>
        <input
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          value={form.lead}
          onChange={(event) => setForm({ ...form, lead: event.target.value })}
          placeholder="name or email"
        />
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-sm">Project type</label>
        <select
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          value={form.project_type}
          onChange={(event) => setForm({ ...form, project_type: event.target.value })}
        >
          <option value="software">Software</option>
          <option value="business">Business</option>
        </select>
      </div>
      <button className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white" disabled={loading}>
        {loading ? 'Creating...' : 'Create project'}
      </button>
    </form>
  )
}
