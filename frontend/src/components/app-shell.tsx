import { useState, type ReactNode } from 'react'
import {
  ChevronRight,
  History,
  LayoutGrid,
  Menu,
  Moon,
  Settings,
  Sun,
  TriangleAlert,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Logo } from '@/components/logo'
import { SystemDialog } from '@/components/system-dialog'
import type { Health } from '@/lib/types'
import { useTheme } from '@/hooks/use-theme'
import { navigate, useRoute, type Route } from '@/lib/router'
import { platformName, startCommand } from '@/lib/platform'
import { supportsFigureExports } from '@/lib/version'
import { cn } from '@/lib/utils'

const navItems = [
  { name: 'workspace' as const, label: 'Workspace', icon: LayoutGrid, href: '/' },
  { name: 'history' as const, label: 'History', icon: History, href: '/history' },
  { name: 'settings' as const, label: 'Settings', icon: Settings, href: '/settings' },
]

function isActive(route: Route, name: (typeof navItems)[number]['name']): boolean {
  if (name === 'workspace') return route.name === 'workspace' || route.name === 'job'
  return route.name === name
}

function engineLabel(health: Health): string {
  if (!health.model.ready) return 'Model missing'
  if (health.engine.status === 'ready') return 'Engine ready'
  if (health.engine.status === 'starting') return 'Engine warming up'
  if (health.engine.status === 'error') return 'Engine error'
  return 'Engine stopped'
}

function engineDotClass(health: Health): string {
  if (!health.model.ready || health.engine.status === 'error') return 'bg-destructive'
  if (health.engine.status === 'ready') return 'bg-[#6fbf8c]'
  if (health.engine.status === 'starting') return 'bg-[#e0a04b]'
  return 'bg-sidebar-muted/60'
}

function NavList({
  route,
  health,
  onNavigate,
}: {
  route: Route
  health: Health
  onNavigate?: () => void
}) {
  return (
    <nav className="space-y-1">
      {navItems.map((item) => {
        const active = isActive(route, item.name)
        const showJobDot = item.name === 'workspace' && health.active_job
        return (
          <button
            key={item.name}
            type="button"
            onClick={() => {
              navigate(item.href)
              onNavigate?.()
            }}
            className={cn(
              'group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[0.84rem] font-semibold tracking-[-0.005em] transition-colors',
              active
                ? 'bg-sidebar-accent text-sidebar-foreground'
                : 'text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
            )}
          >
            <item.icon
              className={cn(
                'size-4 shrink-0 transition-colors',
                active ? 'text-sidebar-foreground' : 'text-sidebar-muted group-hover:text-sidebar-foreground',
              )}
            />
            <span className="flex-1">{item.label}</span>
            {showJobDot && (
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
              </span>
            )}
            {active && (
              <span className="absolute top-1/2 left-0 h-4 w-[2px] -translate-y-1/2 rounded-full bg-primary" />
            )}
          </button>
        )
      })}
    </nav>
  )
}

function SidebarFooter({
  health,
  onOpenSystem,
}: {
  health: Health
  onOpenSystem: () => void
}) {
  const { theme, toggle } = useTheme()
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onOpenSystem}
        className="group w-full rounded-xl border border-sidebar-border bg-sidebar-accent/55 p-3.5 text-left transition-colors hover:border-sidebar-muted/30 hover:bg-sidebar-accent"
      >
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span
              className={cn(
                'absolute inline-flex size-full rounded-full opacity-50',
                health.engine.status === 'ready' && 'animate-ping',
                engineDotClass(health),
              )}
            />
            <span className={cn('relative inline-flex size-2 rounded-full', engineDotClass(health))} />
          </span>
          <span className="text-[0.76rem] font-semibold text-sidebar-foreground">
            {engineLabel(health)}
          </span>
          <ChevronRight className="ml-auto size-3.5 text-sidebar-muted transition-transform group-hover:translate-x-0.5" />
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 pl-4">
          <span className="truncate text-[0.66rem] text-sidebar-muted">
            {health.engine.model ?? 'Unlimited-OCR'}
          </span>
          <span className="text-sidebar-border">·</span>
          <span className="text-[0.66rem] text-sidebar-muted">
            {health.engine.port ? `port ${health.engine.port}` : 'offline'}
          </span>
        </div>
        {health.queued_jobs > 0 && (
          <div className="mt-2 pl-4">
            <Badge variant="outline" className="border-sidebar-border text-sidebar-muted">
              {health.queued_jobs} job{health.queued_jobs === 1 ? '' : 's'} queued
            </Badge>
          </div>
        )}
      </button>

      <div className="flex items-center justify-between rounded-lg px-1">
        <div className="flex items-center gap-1.5">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={toggle}
            className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
          <span className="text-[0.64rem] tracking-wide text-sidebar-muted/70">v{health.version}</span>
        </div>
        <span className="text-[0.6rem] font-semibold tracking-[0.14em] text-sidebar-muted/50 uppercase">
          {platformName(health.system)}
        </span>
      </div>
    </div>
  )
}

export function AppShell({
  health,
  children,
}: {
  health: Health
  children: ReactNode
}) {
  const route = useRoute()
  const [systemOpen, setSystemOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="min-h-svh">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col bg-sidebar px-4 pt-6 pb-5 lg:flex">
        <div className="px-2">
          <Logo />
        </div>
        <div className="mt-9 flex-1">
          <div className="mb-2 px-3 text-[0.58rem] font-bold tracking-[0.2em] text-sidebar-muted/60 uppercase">
            Studio
          </div>
          <NavList route={route} health={health} />
        </div>
        <SidebarFooter health={health} onOpenSystem={() => setSystemOpen(true)} />
      </aside>

      <header className="glass sticky top-0 z-20 flex h-15 items-center justify-between border-b border-border/70 px-4 lg:hidden">
        <Logo compact />
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSystemOpen(true)}
            aria-label="Engine status"
            className="relative"
          >
            <span className={cn('size-2 rounded-full', engineDotClass(health))} />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </Button>
        </div>
      </header>

      <main className="lg:pl-[248px]">
        <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-7 sm:py-8 lg:px-10 lg:py-10">
          {!supportsFigureExports(health.version) && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/[0.08] px-4 py-3 text-[0.78rem] leading-relaxed text-warning"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <div>
                <div className="font-semibold">
                  Backend v{health.version} is still running.
                </div>
                <p className="mt-0.5">
                  Restart it once to enable embedded figure exports:{' '}
                  <code className="rounded bg-background/60 px-1.5 py-0.5 font-mono text-[0.72rem]">
                    {startCommand(health.system)} --restart
                  </code>
                </p>
              </div>
            </div>
          )}
          {children}
        </div>
      </main>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent
          showClose={false}
          className="top-0 left-0 h-svh max-h-none w-[280px] max-w-[85vw] translate-x-0 translate-y-0 rounded-none border-y-0 border-l-0 bg-sidebar p-4 text-sidebar-foreground"
        >
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <div className="flex items-center justify-between px-2">
            <Logo />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setMobileOpen(false)}
              className="text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <X />
            </Button>
          </div>
          <div className="mt-9">
            <NavList route={route} health={health} onNavigate={() => setMobileOpen(false)} />
          </div>
          <div className="mt-8">
            <SidebarFooter health={health} onOpenSystem={() => setSystemOpen(true)} />
          </div>
        </DialogContent>
      </Dialog>

      <SystemDialog open={systemOpen} onOpenChange={setSystemOpen} health={health} />
    </div>
  )
}
