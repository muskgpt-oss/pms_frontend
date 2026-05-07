import { useState } from 'react'

const initialState = {
  title: '',
  description: '',
  issue_type: 'task',
  priority: 'medium',
  status: 'backlog',
  reporter: '',
  assignee: '',
  story_points: '',
  labels: '',
  sprint_id: '',
}

export default function IssueForm({ onSubmit, loading, sprints = [] }) {
  const [form, setForm] = useState(initialState)

  const handleSubmit = (event) => {
    event.preventDefault()
    onSubmit({
      ...form,
      reporter: form.reporter || null,
      assignee: form.assignee || null,
      story_points: form.story_points ? Number(form.story_points) : null,
      labels: form.labels
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      sprint_id: form.sprint_id || null,
    })
    setForm(initialState)
  }

  return (
    <form onSubmit={handleSubmit} className="rounded bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">Create issue</h2>
      <div className="mb-3">
        <label className="mb-1 block text-sm">Title</label>
        <input
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          required
        />
      </div>
      <div className="mb-3">
        <label className="mb-1 block text-sm">Description</label>
        <textarea
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          rows={3}
          value={form.description}
          onChange={(event) => setForm({ ...form, description: event.target.value })}
        />
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm">Type</label>
          <select
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            value={form.issue_type}
            onChange={(event) => setForm({ ...form, issue_type: event.target.value })}
          >
            <option value="story">Story</option>
            <option value="task">Task</option>
            <option value="bug">Bug</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm">Priority</label>
          <select
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            value={form.priority}
            onChange={(event) => setForm({ ...form, priority: event.target.value })}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm">Reporter</label>
          <input
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            value={form.reporter}
            onChange={(event) => setForm({ ...form, reporter: event.target.value })}
            placeholder="name or email"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm">Assignee</label>
          <input
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            value={form.assignee}
            onChange={(event) => setForm({ ...form, assignee: event.target.value })}
            placeholder="name or email"
          />
        </div>
      </div>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm">Story points</label>
          <input
            type="number"
            min="1"
            max="100"
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            value={form.story_points}
            onChange={(event) => setForm({ ...form, story_points: event.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm">Sprint</label>
          <select
            className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            value={form.sprint_id}
            onChange={(event) => setForm({ ...form, sprint_id: event.target.value })}
          >
            <option value="">Backlog (no sprint)</option>
            {sprints.map((sprint) => (
              <option key={sprint.id} value={sprint.id}>
                {sprint.name} ({sprint.state})
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mb-4">
        <label className="mb-1 block text-sm">Labels (comma separated)</label>
        <input
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
          value={form.labels}
          onChange={(event) => setForm({ ...form, labels: event.target.value })}
          placeholder="frontend, auth, sprint"
        />
      </div>
      <button className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white" disabled={loading}>
        {loading ? 'Creating...' : 'Create issue'}
      </button>
    </form>
  )
}
