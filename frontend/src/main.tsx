import '@fontsource-variable/manrope'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import 'katex/dist/katex.min.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        position="bottom-right"
        closeButton
        toastOptions={{
          classNames: {
            toast:
              'group !rounded-xl !border-border !bg-popover !text-popover-foreground !shadow-xl !shadow-black/10 !font-sans',
            description: '!text-muted-foreground',
            actionButton: '!bg-primary !text-primary-foreground',
            closeButton: '!border-border !bg-card',
          },
        }}
      />
    </QueryClientProvider>
  </StrictMode>,
)
