/**
 * AI Layer — Phonetic matching for Indian names.
 *
 * Handles common pronunciation variations that arise from
 * Hinglish/Gujarati voice transcription:
 *   "diksha" ↔ "deeksha" ↔ "dixha"
 *   "suresh" ↔ "sooresh"
 *   "ramesh" ↔ "raamesh"
 *
 * Also supports matching by first name only, last name only,
 * or full name against the users table.
 */

// ---------------------------------------------------------------------------
// Indian phonetic normalisation rules
// ---------------------------------------------------------------------------

const PHONETIC_REPLACEMENTS: [RegExp, string][] = [
    // Aspirated consonants → base consonant
    [/bh/gi, 'b'],
    [/ch/gi, 'c'],
    [/dh/gi, 'd'],
    [/gh/gi, 'g'],
    [/jh/gi, 'j'],
    [/kh/gi, 'k'],
    [/ph/gi, 'f'],
    [/th/gi, 't'],
    [/sh/gi, 's'],

    // Common Indian-English transliteration equivalents
    [/ksh/gi, 'x'],
    [/ks/gi, 'x'],
    [/x/gi, 'ks'],
    [/ee/gi, 'i'],
    [/oo/gi, 'u'],
    [/aa/gi, 'a'],
    [/ai/gi, 'e'],
    [/au/gi, 'o'],
    [/ou/gi, 'u'],

    // Double consonants → single
    [/(.)\1+/gi, '$1'],

    // Trailing vowels (common in transcription noise)
    [/[aeiou]+$/gi, ''],

    // W ↔ V (Gujarati/Hindi often interchange)
    [/w/gi, 'v'],

    // Z ↔ J (Hindi "ज" can be transcribed as either)
    [/z/gi, 'j'],

    // Y at word start often interchangeable with J in Indian names
    [/^y/gi, 'j'],
]

/**
 * Normalise a name to its phonetic "skeleton".
 * Used to compare two names that may differ only by transliteration.
 */
export function phoneticNormalize(name: string): string {
    let normalised = name.toLowerCase().trim()

    for (const [pattern, replacement] of PHONETIC_REPLACEMENTS) {
        normalised = normalised.replace(pattern, replacement)
    }

    // Remove remaining vowels for consonant-skeleton comparison
    normalised = normalised.replace(/[aeiou]/gi, '')

    return normalised
}

/**
 * Calculate the similarity between two phonetically normalised strings.
 * Uses a simple Dice coefficient on bigrams.
 *
 * @returns A number between 0 and 1 (1 = identical)
 */
export function phoneticSimilarity(a: string, b: string): number {
    const normA = phoneticNormalize(a)
    const normB = phoneticNormalize(b)

    if (normA === normB) return 1.0
    if (normA.length < 2 || normB.length < 2) {
        // For very short normalised forms, fall back to exact match
        return normA === normB ? 1.0 : 0.0
    }

    const bigramsA = getBigrams(normA)
    const bigramsB = getBigrams(normB)

    let matches = 0
    const bCopy = [...bigramsB]

    for (const bg of bigramsA) {
        const idx = bCopy.indexOf(bg)
        if (idx !== -1) {
            matches++
            bCopy.splice(idx, 1) // each bigram counted only once
        }
    }

    return (2 * matches) / (bigramsA.length + bigramsB.length)
}

function getBigrams(s: string): string[] {
    const bigrams: string[] = []
    for (let i = 0; i < s.length - 1; i++) {
        bigrams.push(s.substring(i, i + 2))
    }
    return bigrams
}

// ---------------------------------------------------------------------------
// User matching — considers first name, last name, and full name
// ---------------------------------------------------------------------------

export interface OrgUser {
    id: string
    name: string
    first_name?: string | null
    last_name?: string | null
    phone_number?: string
}

export interface PhoneticMatchResult {
    user: OrgUser
    score: number
    matchedOn: 'exact' | 'first_name' | 'last_name' | 'full_name' | 'phonetic'
}

/**
 * Find users in the organisation whose name matches the query,
 * using both exact-substring and phonetic similarity.
 *
 * Matching strategy (in order of priority):
 *  1. Exact substring on `name` (ilike) — score 1.0
 *  2. Exact substring on `first_name` or `last_name` — score 1.0
 *  3. Phonetic similarity on `name` parts — score from phoneticSimilarity()
 *  4. Phonetic similarity on `first_name` / `last_name` — score from phoneticSimilarity()
 *
 * @param query     — the name extracted from the user's message (e.g., "diksha")
 * @param orgUsers  — all users in the organisation
 * @param threshold — minimum phonetic similarity score to consider a match (default 0.7)
 * @returns         — matching users sorted by score descending
 */
export function findPhoneticMatches(
    query: string,
    orgUsers: OrgUser[],
    threshold: number = 0.7,
): PhoneticMatchResult[] {
    const q = query.toLowerCase().trim()
    if (!q) return []

    const results: PhoneticMatchResult[] = []

    for (const user of orgUsers) {
        let bestScore = 0
        let matchedOn: PhoneticMatchResult['matchedOn'] = 'phonetic'

        // 1. Exact substring match on full name
        const fullName = (user.name || '').toLowerCase()
        if (fullName.includes(q) || q.includes(fullName)) {
            bestScore = 1.0
            matchedOn = 'full_name'
        }

        // 2. Exact match on first_name
        const firstName = (user.first_name || '').toLowerCase().trim()
        if (firstName && (firstName === q || firstName.includes(q) || q.includes(firstName))) {
            if (1.0 > bestScore) {
                bestScore = 1.0
                matchedOn = 'first_name'
            }
        }

        // 3. Exact match on last_name
        const lastName = (user.last_name || '').toLowerCase().trim()
        if (lastName && (lastName === q || lastName.includes(q) || q.includes(lastName))) {
            if (1.0 > bestScore) {
                bestScore = 1.0
                matchedOn = 'last_name'
            }
        }

        // 4. Phonetic similarity checks (only if no exact match yet)
        if (bestScore < 1.0) {
            // Compare against each word in the full name
            const nameParts = fullName.split(/\s+/).filter(Boolean)
            for (const part of nameParts) {
                const sim = phoneticSimilarity(q, part)
                if (sim > bestScore) {
                    bestScore = sim
                    matchedOn = 'phonetic'
                }
            }

            // Compare against first_name and last_name separately
            if (firstName) {
                const sim = phoneticSimilarity(q, firstName)
                if (sim > bestScore) {
                    bestScore = sim
                    matchedOn = 'phonetic'
                }
            }
            if (lastName) {
                const sim = phoneticSimilarity(q, lastName)
                if (sim > bestScore) {
                    bestScore = sim
                    matchedOn = 'phonetic'
                }
            }
        }

        if (bestScore >= threshold) {
            results.push({ user, score: bestScore, matchedOn })
        }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score)

    return results
}
