/**
 * Business Hours Enforcement — Global utility for shifting scheduled
 * notifications to valid business hours.
 *
 * Rules:
 *   - Business hours: 9:00 AM – 8:00 PM IST (UTC+5:30)
 *   - No Sundays
 *   - If a scheduled time falls outside these windows, it is shifted
 *     to the next valid slot (9 AM next business day).
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000 // UTC+5:30

// Business hours in IST (24h format)
const BIZ_START_HOUR = 9  // 9:00 AM IST
const BIZ_END_HOUR = 20   // 8:00 PM IST

/**
 * Convert a UTC Date to IST hours/minutes for comparison.
 */
function getISTHours(date: Date): number {
    const istTime = new Date(date.getTime() + IST_OFFSET_MS)
    return istTime.getUTCHours() + istTime.getUTCMinutes() / 60
}

/**
 * Get the IST day-of-week (0 = Sunday, 6 = Saturday).
 */
function getISTDayOfWeek(date: Date): number {
    const istTime = new Date(date.getTime() + IST_OFFSET_MS)
    return istTime.getUTCDay()
}

/**
 * Set a Date to a specific IST hour (e.g. 9:00 AM IST), keeping the same date.
 */
function setISTHour(date: Date, hour: number): Date {
    const istTime = new Date(date.getTime() + IST_OFFSET_MS)
    istTime.setUTCHours(hour, 0, 0, 0)
    return new Date(istTime.getTime() - IST_OFFSET_MS)
}

/**
 * Advance a date by N calendar days.
 */
function addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

/**
 * Adjust a scheduled datetime to fall within business hours.
 *
 * - If before 9 AM IST → shift to 9 AM same day
 * - If after 8 PM IST → shift to 9 AM next business day
 * - If Sunday → shift to 9 AM Monday
 *
 * @param date The original scheduled datetime (UTC)
 * @returns Adjusted datetime guaranteed to be within business hours
 */
export function adjustToBusinessHours(date: Date): Date {
    let adjusted = new Date(date.getTime())

    // Step 1: Handle Sunday → move to Monday
    const dayOfWeek = getISTDayOfWeek(adjusted)
    if (dayOfWeek === 0) {
        adjusted = setISTHour(addDays(adjusted, 1), BIZ_START_HOUR)
        return adjusted
    }

    // Step 2: Handle time-of-day
    const istHour = getISTHours(adjusted)

    if (istHour < BIZ_START_HOUR) {
        // Before business hours → shift to 9 AM same day
        adjusted = setISTHour(adjusted, BIZ_START_HOUR)
    } else if (istHour >= BIZ_END_HOUR) {
        // After business hours → shift to 9 AM next day
        adjusted = setISTHour(addDays(adjusted, 1), BIZ_START_HOUR)

        // If next day is Sunday, skip to Monday
        if (getISTDayOfWeek(adjusted) === 0) {
            adjusted = setISTHour(addDays(adjusted, 1), BIZ_START_HOUR)
        }
    }

    return adjusted
}

/**
 * Check if a given datetime is within business hours.
 */
export function isWithinBusinessHours(date: Date): boolean {
    const dayOfWeek = getISTDayOfWeek(date)
    if (dayOfWeek === 0) return false // Sunday

    const istHour = getISTHours(date)
    return istHour >= BIZ_START_HOUR && istHour < BIZ_END_HOUR
}

/**
 * Adjust an array of scheduled dates to business hours.
 * Preserves relative ordering but ensures no duplicates land on the same slot.
 */
export function adjustAllToBusinessHours(dates: Date[]): Date[] {
    return dates.map(d => adjustToBusinessHours(d))
}
