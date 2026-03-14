import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Ticket } from '@/lib/types'

export function useTickets() {
    return useQuery<{ tickets: Ticket[] }>({
        queryKey: ['tickets'],
        queryFn: async () => {
            const res = await fetch('/api/tickets')
            if (!res.ok) throw new Error('Failed to fetch tickets')
            return res.json()
        },
    })
}

export function useCreateTicket() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (data: { vendor_id: string; subject: string; description?: string; deadline?: string }) => {
            const res = await fetch('/api/tickets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error || 'Failed to create ticket')
            }
            return res.json()
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['tickets'] })
        },
    })
}

export function useEditTicket() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ ticketId, subject, deadline }: { ticketId: string; subject?: string; deadline?: string }) => {
            const res = await fetch(`/api/tickets/${ticketId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subject, deadline }),
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error || 'Failed to update ticket')
            }
            return res.json()
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['tickets'] })
        },
    })
}

export function useCompleteTicket() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (ticketId: string) => {
            const res = await fetch(`/api/tickets/${ticketId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'completed' }),
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error || 'Failed to complete ticket')
            }
            return res.json()
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['tickets'] })
        },
    })
}

export function useDeleteTicket() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (ticketId: string) => {
            const res = await fetch(`/api/tickets/${ticketId}`, {
                method: 'DELETE',
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error || 'Failed to cancel ticket')
            }
            return res.json()
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['tickets'] })
        },
    })
}
