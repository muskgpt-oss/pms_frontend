import { useQuery } from '@tanstack/react-query'
import { fetchProjects } from '../services/projectApi'

export default function ProjectSelector({ selectedProjectId, onSelect, className = '' }) {
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
  })

  return (
    <select
      className={className || 'rounded border border-slate-300 bg-white px-3 py-2 text-sm'}
      value={selectedProjectId}
      onChange={(event) => onSelect(event.target.value)}
    >
      <option value="">Select project</option>
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.key} - {project.name}
        </option>
      ))}
    </select>
  )
}
