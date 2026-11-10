import { type ComponentPropsWithoutRef, type ElementRef, forwardRef } from 'react'
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'
import { cn } from '@/lib/utils'

const Collapsible = CollapsiblePrimitive.Root
const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger

const CollapsibleContent = forwardRef<
  ElementRef<typeof CollapsiblePrimitive.CollapsibleContent>,
  ComponentPropsWithoutRef<typeof CollapsiblePrimitive.CollapsibleContent>
>(({ className, ...props }, ref) => (
  <CollapsiblePrimitive.CollapsibleContent
    ref={ref}
    className={cn(
      'overflow-hidden data-[state=closed]:animate-[fade-in_0.15s_ease_reverse] data-[state=open]:animate-fade-in',
      className,
    )}
    {...props}
  />
))
CollapsibleContent.displayName = CollapsiblePrimitive.CollapsibleContent.displayName

export { Collapsible, CollapsibleContent, CollapsibleTrigger }
