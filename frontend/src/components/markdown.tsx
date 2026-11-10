import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { cn } from '@/lib/utils'

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('ocr-prose', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
          img: ({ alt, ...props }) => (
            <img {...props} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
