import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ProjectForm from './components/ProjectForm'
import ProjectList from './components/ProjectList'
import WorkflowEditor from './components/WorkflowEditor'
import { archiveProject, createProject, deleteProject, fetchProjects } from '../../services/projectApi'
import { getApiErrorMessage } from '../../services/apiClient'

export default function ProjectsPage({ selectedProjectId, onSelectProject }) {
  const queryClient = useQueryClient()
  const { data: projects = [], isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
  })

  const createProjectMutation = useMutation({
    mutationFn: createProject,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      onSelectProject(created.id)
    },
  })

  const archiveProjectMutation = useMutation({
    mutationFn: archiveProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      if (selectedProjectId) {
        onSelectProject('')
      }
    },
  })

  const deleteProjectMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      if (selectedProjectId) {
        onSelectProject('')
      }
    },
  })

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-1">
        <ProjectForm onSubmit={(payload) => createProjectMutation.mutate(payload)} loading={createProjectMutation.isPending} />
        {createProjectMutation.error && (
          <p className="mt-2 text-sm text-red-600">{getApiErrorMessage(createProjectMutation.error)}</p>
        )}
      </div>
      <div className="rounded bg-white p-4 shadow-sm lg:col-span-2">
        <h2 className="mb-4 text-lg font-semibold">Projects</h2>
        {error && <p className="mb-3 text-sm text-red-600">{getApiErrorMessage(error)}</p>}
        <ProjectList
          projects={projects}
          isLoading={isLoading}
          selectedProjectId={selectedProjectId}
          onSelect={onSelectProject}
          onArchive={(projectId) => archiveProjectMutation.mutate({ projectId })}
          onDelete={(projectId) => deleteProjectMutation.mutate({ projectId })}
        />
        {(archiveProjectMutation.error || deleteProjectMutation.error) && (
          <p className="mt-3 text-sm text-red-600">{getApiErrorMessage(archiveProjectMutation.error || deleteProjectMutation.error)}</p>
        )}
      </div>
      <div className="lg:col-span-3">
        <WorkflowEditor projectId={selectedProjectId} />
      </div>
    </div>
  )
}
