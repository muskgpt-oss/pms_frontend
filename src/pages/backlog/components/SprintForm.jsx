import { useState } from 'react'

const initialState = {
  name: '',
  goal: '',
}

export default function SprintForm({ onSubmit, loading }) {
  const [form, setForm] = useState(initialState)

  const handleSubmit = (event) => {
    event.preventDefault()
    onSubmit(form)
    setForm(initialState)
  }

  return (
    <form onSubmit={handleSubmit} className="rounded bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Create sprint</h2>
      <div className="mb-3">
        <label className="mb-1 block text-sm">Sprint name</label>
        <input
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          required
        />
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-sm">Sprint goal</label>
        <textarea
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          rows={2}
          value={form.goal}
          onChange={(event) => setForm({ ...form, goal: event.target.value })}
        />
      </div>
      <button className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white" disabled={loading}>
        {loading ? 'Creating...' : 'Create sprint'}
      </button>
    </form>
  )
}
