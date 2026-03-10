import { NextRequest, NextResponse } from 'next/server'
import { makeAutomatedCall } from '@/lib/notifications/calling-service'

// Quick test endpoint — DELETE after testing
export async function POST(request: NextRequest) {
    const secret = request.headers.get('x-internal-secret')
    if (secret !== process.env.INTERNAL_PROCESSOR_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { phone, message, language } = await request.json()
    const result = await makeAutomatedCall(
        phone || '919727731867',
        message || 'नमस्ते! आपको एक नया काम दिया है, Rahul ने। काम है: नए client के लिए proposal document तैयार करना है, कल दोपहर 2 बजे तक। कृपया इसे WhatsApp पर स्वीकार करें।',
        language || 'hi-IN'
    )
    return NextResponse.json(result)
}
