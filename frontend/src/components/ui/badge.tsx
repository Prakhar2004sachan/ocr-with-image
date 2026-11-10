import type { HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.68rem] font-bold uppercase tracking-[0.08em] transition-colors [&_svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-foreground text-background',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border bg-transparent text-muted-foreground',
        primary: 'border-primary/20 bg-primary/10 text-primary',
        success: 'border-success/20 bg-success/12 text-success',
        warning: 'border-warning/25 bg-warning/12 text-warning',
        destructive: 'border-destructive/20 bg-destructive/10 text-destructive',
        info: 'border-info/25 bg-info/12 text-info',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
