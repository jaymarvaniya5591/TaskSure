export function getDefaultDeadlineString(): string {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    // User requested default: today's date, 11:59 pm
    return `${dd}-${mm}-${yy} 11:59 PM`;
}

export function getTodayMidnightISO(): string {
    const d = new Date();
    d.setHours(23, 59, 0, 0);
    return d.toISOString();
}

export function formatISOToCustomDate(isoString?: string | null): string {
    if (!isoString) return getDefaultDeadlineString();
    try {
        const d = new Date(isoString);
        if (isNaN(d.getTime())) return getDefaultDeadlineString();

        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yy = String(d.getFullYear()).slice(-2);

        let hours = d.getHours();
        const mins = String(d.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';

        hours = hours % 12;
        hours = hours ? hours : 12;

        return `${dd}-${mm}-${yy} ${String(hours).padStart(2, '0')}:${mins} ${ampm}`;
    } catch {
        return getDefaultDeadlineString();
    }
}

export function parseCustomDateToISO(dateStr: string): string | null {
    const trimmed = dateStr.trim();
    if (!trimmed) return null;

    // A loose regex for dd-mm-yy(yy)? hh:mm am/pm
    const regex = /^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm|a|p)$/i;
    const match = trimmed.match(regex);

    if (!match) {
        throw new Error("Please use format: DD-MM-YY HH:MM AM/PM (e.g. 21-02-26 11:59 PM)");
    }

    const [, d, m, y, h, min, ampm] = match;

    const day = parseInt(d, 10);
    const month = parseInt(m, 10) - 1; // 0-indexed
    let year = parseInt(y, 10);

    // If YY, assume 2000s
    if (year < 100) {
        year += 2000;
    }

    let hour = parseInt(h, 10);
    const minute = parseInt(min, 10);
    const isPM = ampm.toLowerCase().startsWith('p');

    if (hour === 12) {
        if (!isPM) hour = 0; // 12 AM is 0
    } else {
        if (isPM) hour += 12;
    }

    const date = new Date(year, month, day, hour, minute);

    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month ||
        date.getDate() !== day
    ) {
        throw new Error("Invalid date values (e.g. Feb 31st).");
    }

    if (isNaN(date.getTime())) {
        throw new Error("Invalid date values.");
    }

    return date.toISOString();
}
