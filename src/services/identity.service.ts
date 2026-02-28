import { ContactRow } from '../types/contact'
import {
    findByEmailOrPhone,
    findClusterByPrimaryIds,
    createPrimaryContact,
    createSecondaryContact,
    demotePrimary,
    reattachSecondaries,
    withTransaction,
    lockPrimaries,
    acquireIdentityLock
} from '../repositories/contact.repository'


// added to test the concurrency (Will never go to prod with this)
const TEST_DELAY_MS =
    process.env.IDENTITY_TEST_DELAY_MS
        ? Number(process.env.IDENTITY_TEST_DELAY_MS)
        : 0

async function maybeTestDelay() {
    if (TEST_DELAY_MS > 0) {
        await new Promise((r) => setTimeout(r, TEST_DELAY_MS))
    }
}

function buildIdentityKey(
    email: string | null,
    phone: string | null
): string {
    return `${email ?? ''}#${phone ?? ''}`
}

export interface IdentifyInput {
    email?: string | null
    phoneNumber?: string | null
}

export interface IdentifyResponse {
    contact: {
        primaryContatctId: number
        emails: string[]
        phoneNumbers: string[]
        secondaryContactIds: number[]
    }
}

function normalizeEmail(email?: string | null) {
    if (!email) return null
    return email.trim().toLowerCase()
}

function normalizePhone(phone?: string | null) {
    if (!phone) return null
    return phone.trim()
}

function getPrimaryId(row: ContactRow): number {
    return row.linked_id ?? row.id
}

export async function identifyService(
    input: IdentifyInput
): Promise<IdentifyResponse> {
    const email = normalizeEmail(input.email)
    const phone = normalizePhone(input.phoneNumber)

    if (!email && !phone) {
        throw new Error('Either email or phoneNumber must be provided')
    }

    return withTransaction(async (client) => {
        const identityKey = buildIdentityKey(email, phone)

        // protects zero-state race
        await acquireIdentityLock(identityKey, client)
        //  find seed contacts
        const seeds = await findByEmailOrPhone(email, phone, client)
        await maybeTestDelay();
        // no contacts → create primary
        if (seeds.length === 0) {
            const primary = await createPrimaryContact(email, phone, client)

            return {
                contact: {
                    primaryContatctId: primary.id,
                    emails: primary.email ? [primary.email] : [],
                    phoneNumbers: primary.phone_number
                        ? [primary.phone_number]
                        : [],
                    secondaryContactIds: [],
                },
            }
        }

        //  collect candidate primary ids
        const primaryIdSet = new Set<number>()
        for (const row of seeds) {
            primaryIdSet.add(getPrimaryId(row))
        }
        const primaryIds = Array.from(primaryIdSet)
        await lockPrimaries(primaryIds, client)

        // expand full cluster
        let cluster = await findClusterByPrimaryIds(primaryIds, client)

        // determine true primary (oldest primary)
        const primaries = cluster.filter(
            (c) => c.link_precedence === 'primary'
        )

        primaries.sort(
            (a, b) =>
                new Date(a.created_at).getTime() -
                new Date(b.created_at).getTime()
        )

        const truePrimary = primaries[0]

        // merge other primaries if needed
        const otherPrimaries = primaries.slice(1)

        for (const p of otherPrimaries) {
            await demotePrimary(p.id, truePrimary.id, client)
            await reattachSecondaries(p.id, truePrimary.id, client)
        }

        // refresh cluster if merge happened
        if (otherPrimaries.length > 0) {
            cluster = await findClusterByPrimaryIds(
                [truePrimary.id],
                client
            )
        }

        // check if new secondary needed
        const emailExists =
            email !== null &&
            cluster.some((c) => c.email === email)

        const phoneExists =
            phone !== null &&
            cluster.some((c) => c.phone_number === phone)

        const shouldCreateSecondary =
            (email && !emailExists) || (phone && !phoneExists)

        await maybeTestDelay()
        if (shouldCreateSecondary) {
            await createSecondaryContact(
                email,
                phone,
                truePrimary.id,
                client
            )

            // refresh cluster after insert
            cluster = await findClusterByPrimaryIds(
                [truePrimary.id],
                client
            )
        }

        // build response

        const primary = cluster.find(
            (c) => c.id === truePrimary.id
        )!

        const secondaryIds: number[] = []
        const emailsSet = new Set<string>()
        const phonesSet = new Set<string>()

        for (const c of cluster) {
            if (c.id !== primary.id) {
                secondaryIds.push(c.id)
            }

            if (c.email) emailsSet.add(c.email)
            if (c.phone_number) phonesSet.add(c.phone_number)
        }

        // ensure primary info first (spec requirement)
        const emails = Array.from(emailsSet)
        const phones = Array.from(phonesSet)

        if (primary.email) {
            emails.sort((a) => (a === primary.email ? -1 : 1))
        }

        if (primary.phone_number) {
            phones.sort((a) =>
                a === primary.phone_number ? -1 : 1
            )
        }

        return {
            contact: {
                primaryContatctId: primary.id, //kept it as primaryContatctId (speeling error)as the same repeated throughout the document. 
                emails,
                phoneNumbers: phones,
                secondaryContactIds: secondaryIds.sort(
                    (a, b) => a - b
                ),
            },
        }
    })
}