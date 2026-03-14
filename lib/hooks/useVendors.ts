import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Vendor } from '@/lib/types'

export function useVendors() {
    return useQuery<{ vendors: Vendor[] }>({
        queryKey: ['vendors'],
        queryFn: async () => {
            const res = await fetch('/api/vendors')
            if (!res.ok) throw new Error('Failed to fetch vendors')
            return res.json()
        },
    })
}

export function useAddVendor() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (phoneNumber: string) => {
            const res = await fetch('/api/vendors', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone_number: phoneNumber }),
            })
            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error || 'Failed to add vendor')
            }
            return res.json()
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['vendors'] })
        },
    })
}

export function useEditVendor() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ vendorId, name, status }: { vendorId: string; name?: string; status?: string }) => {
            const res = await fetch(`/api/vendors/${vendorId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, status }),
            })
            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error || 'Failed to update vendor')
            }
            return res.json()
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['vendors'] })
        },
    })
}

export function useDeleteVendor() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (vendorId: string) => {
            const res = await fetch(`/api/vendors/${vendorId}`, {
                method: 'DELETE',
            })
            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error || 'Failed to remove vendor')
            }
            return res.json()
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['vendors'] })
        },
    })
}
