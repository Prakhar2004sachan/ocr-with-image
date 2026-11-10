import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from '@radix-ui/react-slot'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4 active:translate-y-px',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-sm shadow-black/10 hover:bg-primary/90',
        secondary:
          'border border-border/80 bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/70',
        outline:
          'border border-border bg-transparent text-foreground hover:border-foreground/25 hover:bg-accent/55',
        ghost: 'text-foreground hover:bg-accent/60',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm shadow-black/10 hover:bg-destructive/90',
        link: 'text-primary underline-offset-4 hover:underline',
        subtle: 'bg-accent/65 text-accent-foreground hover:bg-accent',
      },
      size: {
        default: 'h-9.5 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-xl px-6 text-[0.95rem]',
        xl: 'h-13 rounded-xl px-7 text-base',
        icon: 'size-9.5',
        'icon-sm': 'size-8 rounded-md',
        'icon-lg': 'size-11 rounded-xl',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Component = asChild ? Slot : 'button'
    return (
      <Component
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
