import { useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Card from '@/components/shared/Card'
import Badge from '@/components/shared/Badge'
import Btn from '@/components/shared/Btn'
import Spinner from '@/components/shared/Spinner'
import EmptyState from '@/components/shared/EmptyState'
import ToolTestModal from '@/components/operator/ToolTestModal'
import { useTools, useBuiltinTools, type Tool, type BuiltinTool } from '@/api/tools'
import { useAuthStore } from '@/store/auth'

const DEV_WORKSPACE = import.meta.env.VITE_DEV_WORKSPACE_ID ?? 'dev-workspace'

const CATEGORY_VARIANT: Record<string, 'blue' | 'green' | 'purple' | 'orange' | 'gray'> = {
  http: 'blue',
  rag: 'green',
  function: 'purple',
  lookup: 'orange',
  rule: 'gray',
  builtin: 'gray',
}

interface TestTarget {
  tool: BuiltinTool | { id: string; name: string; slug: string; description: string }
  isBuiltin: boolean
}

export default function ToolsPage() {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? DEV_WORKSPACE
  const { data: tools, isLoading: loadingTools } = useTools(workspaceId)
  const { data: builtins, isLoading: loadingBuiltins } = useBuiltinTools(workspaceId)
  const [testTarget, setTestTarget] = useState<TestTarget | null>(null)

  const isLoading = loadingTools || loadingBuiltins

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <PageHeader
        title="Tools"
        subtitle="Deterministic tools available to Tool Executor nodes."
      />

      {isLoading && <Spinner />}

      {!isLoading && (
        <>
          {builtins && builtins.length > 0 && (
            <section className="mb-8">
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Built-in tools
              </h2>
              <p className="text-xs text-gray-400 mb-3">Always available — no setup needed.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {builtins.map((b: BuiltinTool) => (
                  <Card key={b.slug} className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <p className="font-semibold text-gray-900 text-sm">{b.name}</p>
                      <Badge variant={CATEGORY_VARIANT[b.category] ?? 'gray'}>{b.category}</Badge>
                    </div>
                    <p className="text-xs text-gray-500 mb-3">{b.description}</p>
                    <div className="flex items-center justify-between">
                      <code className="text-xs text-gray-400 font-mono">{b.slug}</code>
                      <Btn
                        variant="ghost"
                        size="sm"
                        onClick={() => setTestTarget({ tool: b, isBuiltin: true })}
                      >
                        Try it
                      </Btn>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
              Custom integrations
            </h2>
            <p className="text-xs text-gray-400 mb-3">Connect your own APIs with workspace-specific credentials.</p>
            {(!tools || tools.length === 0) ? (
              <EmptyState
                heading="No custom integrations yet"
                subtext="Add an HTTP connector to call your own APIs from Tool Executor nodes."
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {tools.map((t: Tool) => (
                  <Card key={t.id} className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <p className="font-semibold text-gray-900 text-sm">{t.name}</p>
                      <Badge variant={CATEGORY_VARIANT[t.category] ?? 'gray'}>{t.category}</Badge>
                    </div>
                    <p className="text-xs text-gray-500 mb-3">{(t.definition as { description?: string }).description ?? ''}</p>
                    <div className="flex items-center justify-between">
                      <code className="text-xs text-gray-400 font-mono">{t.slug}</code>
                      <Btn
                        variant="ghost"
                        size="sm"
                        onClick={() => setTestTarget({ tool: { id: t.id, name: t.name, slug: t.slug, description: (t.definition as { description?: string }).description ?? '' }, isBuiltin: false })}
                      >
                        Test
                      </Btn>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {testTarget && (
        <ToolTestModal
          workspaceId={workspaceId}
          tool={testTarget.tool}
          isBuiltin={testTarget.isBuiltin}
          onClose={() => setTestTarget(null)}
        />
      )}
    </div>
  )
}
