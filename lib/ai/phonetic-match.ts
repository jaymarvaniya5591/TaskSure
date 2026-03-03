/**
 * AI Layer — Phonetic matching for Indian names.
 *
 * Handles common pronunciation variations that arise from
 * Hinglish/Gujarati voice transcription:
 *   "diksha" -> "deeksha" -> "dixha"
 *   "suresh" -> "sooresh"
 *   "ramesh" -> "raamesh"
 *
 * Also supports matching by first name only, last name only,
 * or full name against the users table.
 */

// ---------------------------------------------------------------------------
// Indian phonetic normalisation rules
// ---------------------------------------------------------------------------

const PHONETIC_REPLACEMENTS: [RegExp, string][] = [
    // Aspirated consonants -> base consonant
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

    // Double consonants -> single
    [/(.)\1+/gi, '$1'],

    // Trailing vowels (common in transcription noise)
    [/[aeiou]+$/gi, ''],

    // W -> V (Gujarati/Hindi often interchange)
    [/w/gi, 'v'],

    // Z -> J (Hindi "z" can be transcribed as either)
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
 *  2. Exact substring on `first_name` or `last_name` (ONLY if single word query) — score 1.0
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

    const qParts = q.split(/\s+/).filter(Boolean)
    const isMultiWord = qParts.length > 1
    const results: PhoneticMatchResult[] = []

    for (const user of orgUsers) {
        let bestScore = 0
        let matchedOn: PhoneticMatchResult['matchedOn'] = 'phonetic'

        const fullName = (user.name || '').toLowerCase()
        const firstName = (user.first_name || '').toLowerCase().trim()
        const lastName = (user.last_name || '').toLowerCase().trim()

        // 1. Exact match checking

        // Full name exact match
        if (fullName.includes(q) || q.includes(fullName)) {
            bestScore = 1.0
            matchedOn = 'full_name'
        }

        // For single-word queries, exact match against parts
        // Doing `query.includes(namePart)` where query='shubham pandey' and namePart='pandey'
        // would allow any Pandey to get a score of 1.0. We only do this if the query is a single word.
        if (!isMultiWord && bestScore < 1.0) {
            if (firstName && (firstName === q || firstName.includes(q) || q.includes(firstName))) {
                bestScore = 1.0
                matchedOn = 'first_name'
            } else if (lastName && (lastName === q || lastName.includes(q) || q.includes(lastName))) {
                bestScore = 1.0
                matchedOn = 'last_name'
            }
        }

        // 2. Phonetic matches if NO exact match
        if (bestScore < 1.0) {
            if (isMultiWord) {
                // MULTI-WORD QUERY
                // Attempt to match the first word of query against first name, 
                // last word of query against last name
                const queryFirst = qParts[0]
                const queryLast = qParts[qParts.length - 1]

                let firstSim = 0
                let lastSim = 0

                if (firstName && lastName) {
                    firstSim = phoneticSimilarity(queryFirst, firstName)
                    lastSim = phoneticSimilarity(queryLast, lastName)
                } else {
                    const nameParts = fullName.split(/\s+/).filter(Boolean)
                    if (nameParts.length > 0) {
                        firstSim = phoneticSimilarity(queryFirst, nameParts[0])
                        if (nameParts.length > 1) {
                            lastSim = phoneticSimilarity(queryLast, nameParts[nameParts.length - 1])
                        }
                    }
                }

                // If both parts match decently, average them
                if (firstSim > 0.4 && lastSim > 0.4) {
                    const avg = (firstSim + lastSim) / 2
                    if (avg > bestScore) {
                        bestScore = avg
                        matchedOn = 'phonetic'
                    }
                }

                // Also allow the whole multi-word to phonetically match the full name entirely
                const fullSim = phoneticSimilarity(q, fullName)
                if (fullSim > bestScore) {
                    bestScore = fullSim
                    matchedOn = 'phonetic'
                }
            } else {
                // SINGLE-WORD QUERY
                const nameParts = fullName.split(/\s+/).filter(Boolean)
                for (const part of nameParts) {
                    const sim = phoneticSimilarity(q, part)
                    if (sim > bestScore) {
                        bestScore = sim
                        matchedOn = 'phonetic'
                    }
                }
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
        }

        if (bestScore >= threshold) {
            results.push({ user, score: bestScore, matchedOn })
        }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score)

    return results
}
