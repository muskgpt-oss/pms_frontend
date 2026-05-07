import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchWorkflow, updateWorkflow } from '../../../services/projectApi'
import { getApiErrorMessage } from '../../../services/apiClient'

export default function WorkflowEditor({ projectId }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')

  const workflowQuery = useQuery({
    queryKey: ['workflow', projectId],
    queryFn: () => fetchWorkflow({ projectId }),
    enabled: Boolean(projectId),
  })

  useEffect(() => {
    if (!workflowQuery.data) return
    setDraft(JSON.stringify(workflowQuery.data, null, 2))
  }, [workflowQuery.data])

  const updateMutation = useMutation({
    mutationFn: updateWorkflow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow', projectId] })
      queryClient.invalidateQueries({ queryKey: ['board', projectId] })
      queryClient.invalidateQueries({ queryKey: ['backlog', projectId] })
    },
  })

  if (!projectId) {
    return null
  }

  return (
    <div className="mt-6 rounded bg-white p-4 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold">Workflow (JSON)</h3>
      <textarea
        className="h-64 w-full rounded border border-slate-300 px-3 py-2 font-mono text-xs"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      {workflowQuery.error && <p className="mt-2 text-xs text-red-600">{getApiErrorMessage(workflowQuery.error)}</p>}
      {updateMutation.error && <p className="mt-2 text-xs text-red-600">{getApiErrorMessage(updateMutation.error)}</p>}
      <button
        className="mt-3 rounded bg-slate-900 px-3 py-2 text-xs font-medium text-white"
        onClick={() => {
          let payload
          try {
            payload = JSON.parse(draft)
          } catch {
            return
          }
          updateMutation.mutate({ projectId, payload })
        }}
      >
        {updateMutation.isPending ? 'Saving...' : 'Save workflow'}
      </button>
    </div>
  )
}
