import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from './skeleton'

function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin', className)} aria-hidden />
}

function SkeletonLine({ className }: { className?: string }) {
  return <Skeleton className={cn('h-3.5 w-full', className)} />
}

export { Spinner, SkeletonLine }
