import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 5000,
    staleTime: 3000,
    retry: 1,
  })
}
