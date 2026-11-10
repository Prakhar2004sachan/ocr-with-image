import { useEffect } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppShell } from '@/components/app-shell'
import { HistoryView } from '@/components/history-view'
import { JobView } from '@/components/job-view'
import { OfflineScreen, SplashScreen } from '@/components/offline-screen'
import { SettingsView } from '@/components/settings-view'
import { WorkspaceView } from '@/components/workspace-view'
import { useHealth } from '@/hooks/use-health'
import { useTheme } from '@/hooks/use-theme'
import { ApiError } from '@/lib/api'
import { useRoute } from '@/lib/router'

export default function App() {
  const health = useHealth()
  const route = useRoute()
  const { theme } = useTheme()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [route.name, route.name === 'job' ? route.id : ''])

  if (health.isLoading) return <SplashScreen />

  if (health.isError || !health.data) {
    const error = health.error
    return (
      <OfflineScreen
        message={
          error instanceof ApiError
            ? `${error.message} ${error.hint ?? ''}`.trim()
            : 'The local backend did not answer. Start it in a terminal, then try again.'
        }
        onRetry={() => void health.refetch()}
        retrying={health.isFetching}
      />
    )
  }

  return (
    <TooltipProvider delayDuration={250}>
      <AppShell health={health.data}>
        {route.name === 'workspace' && <WorkspaceView />}
        {route.name === 'history' && <HistoryView />}
        {route.name === 'settings' && <SettingsView />}
        {route.name === 'job' && <JobView key={route.id} jobId={route.id} />}
      </AppShell>
    </TooltipProvider>
  )
}
