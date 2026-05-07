import { useState } from 'react'

export default function ProjectList({ projects, isLoading, selectedProjectId, onSelect, onArchive, onDelete }) {
  const [openMenuProjectId, setOpenMenuProjectId] = useState('')

  if (isLoading) {
    return <p className="text-sm text-slate-500">Loading projects...</p>
  }

  if (!projects.length) {
    return <p className="text-sm text-slate-500">No projects yet. Create one to start.</p>
  }

  return (
    <div className="space-y-3">
      {projects.map((project) => (
        <div
          key={project.id}
          className={`w-full rounded border p-3 text-left ${
            selectedProjectId === project.id ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <button className="text-left" onClick={() => onSelect(project.id)}>
              <p className="text-sm font-semibold">
                {project.key} · {project.name}
              </p>
            </button>
            <div className="relative">
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                onClick={() => setOpenMenuProjectId((current) => (current === project.id ? '' : project.id))}
              >
                ...
              </button>
              {openMenuProjectId === project.id && (
                <div className="absolute right-0 z-10 mt-1 w-40 rounded border border-slate-300 bg-white p-1 shadow-lg">
                  <button
                    type="button"
                    className="block w-full rounded px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100"
                    onClick={() => {
                      const link = `${window.location.origin}/?project=${project.id}`
                      window.open(link, '_blank')
                      setOpenMenuProjectId('')
                    }}
                  >
                    Open link
                  </button>
                  <button
                    type="button"
                    className="block w-full rounded px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-100"
                    onClick={() => {
                      const link = `${window.location.origin}/?project=${project.id}`
                      navigator.clipboard?.writeText(link)
                      setOpenMenuProjectId('')
                    }}
                  >
                    Copy link
                  </button>
                  <button
                    type="button"
                    className="block w-full rounded px-2 py-1 text-left text-xs text-amber-700 hover:bg-amber-50"
                    onClick={() => {
                      onArchive?.(project.id)
                      setOpenMenuProjectId('')
                    }}
                  >
                    Archive
                  </button>
                  <button
                    type="button"
                    className="block w-full rounded px-2 py-1 text-left text-xs text-red-700 hover:bg-red-50"
                    onClick={() => {
                      onDelete?.(project.id)
                      setOpenMenuProjectId('')
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
          <p className="mt-1 text-sm text-slate-600">{project.description || 'No description'}</p>
          <p className="mt-1 text-xs text-slate-500">
            {project.project_type?.toUpperCase()} · Lead: {project.lead || 'Unassigned'}
          </p>
        </div>
      ))}
    </div>
  )
}
