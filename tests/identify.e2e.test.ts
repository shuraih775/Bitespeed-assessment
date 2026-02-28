import request from 'supertest'
import { app } from '../src/app'
import { pool } from '../src/db'

const identify = (body: any) =>
    request(app).post('/identify').send(body)

beforeEach(async () => {
    await pool.query('TRUNCATE contacts RESTART IDENTITY CASCADE')
})

afterAll(async () => {
    await pool.end()
})

afterEach(() => {
    delete process.env.IDENTITY_TEST_DELAY_MS
})


describe('POST /identify - identity reconciliation', () => {
    test('creates primary when no contact exists', async () => {
        const res = await identify({
            email: 'doc@flux.com',
            phoneNumber: '111111',
        })

        expect(res.status).toBe(200)
        expect(res.body.contact.secondaryContactIds).toHaveLength(0)

        const { rows } = await pool.query('SELECT * FROM contacts')
        expect(rows).toHaveLength(1)
        expect(rows[0].link_precedence).toBe('primary')
    })

    test('idempotent when same request repeated (primary stability)', async () => {
        const first = await identify({
            email: 'doc@flux.com',
            phoneNumber: '111111',
        })

        const second = await identify({
            email: 'doc@flux.com',
            phoneNumber: '111111',
        })

        expect(second.body.contact.primaryContatctId)
            .toBe(first.body.contact.primaryContatctId)

        const { rows } = await pool.query('SELECT * FROM contacts')
        expect(rows).toHaveLength(1)
    })

    test('creates secondary when new email with same phone', async () => {
        await identify({
            email: 'lorraine@hill.com',
            phoneNumber: '123456',
        })

        const res = await identify({
            email: 'mcfly@hill.com',
            phoneNumber: '123456',
        })

        const { rows } = await pool.query(
            'SELECT * FROM contacts ORDER BY id'
        )

        expect(rows).toHaveLength(2)

        const primary = rows.find(r => r.link_precedence === 'primary')!
        const secondary = rows.find(r => r.link_precedence === 'secondary')!

        expect(secondary.linked_id).toBe(primary.id)
        expect(res.body.contact.emails.sort()).toEqual([
            'lorraine@hill.com',
            'mcfly@hill.com',
        ].sort())
    })

    test('does NOT create secondary if info already exists in cluster', async () => {
        await identify({ email: 'doc@flux.com', phoneNumber: '111' })
        await identify({ email: 'doc@flux.com', phoneNumber: '222' })
        await identify({ email: 'doc@flux.com', phoneNumber: '222' })
        const { rows } = await pool.query(`
            SELECT id, linked_id, link_precedence
            FROM contacts
            ORDER BY id
            `)

        expect(rows).toHaveLength(2)

        const primaries = rows.filter(r => r.link_precedence === 'primary')
        expect(primaries).toHaveLength(1)

        const primaryId = primaries[0].id

        const secondaries = rows.filter(r => r.link_precedence === 'secondary')
        expect(secondaries).toHaveLength(1)
        expect(secondaries[0].linked_id).toBe(primaryId)
    })

    test('merges two primaries correctly (deep verification)', async () => {
        await identify({ email: 'george@hill.com', phoneNumber: '919191' })
        await identify({ email: 'biff@hill.com', phoneNumber: '717171' })

        await identify({ email: 'george@hill.com', phoneNumber: '717171' })

        const { rows } = await pool.query(
            'SELECT id, linked_id, link_precedence FROM contacts ORDER BY id'
        )

        const primaries = rows.filter(r => r.link_precedence === 'primary')
        expect(primaries).toHaveLength(1)

        const primaryId = primaries[0].id

        const secondaries = rows.filter(r => r.link_precedence === 'secondary')
        for (const s of secondaries) {
            expect(s.linked_id).toBe(primaryId)
        }
    })

    test('oldest contact remains primary after merge (deterministic)', async () => {
        await identify({ email: 'old@flux.com', phoneNumber: '111' })
        await identify({ email: 'new@flux.com', phoneNumber: '222' })

        await identify({
            email: 'old@flux.com',
            phoneNumber: '222',
        })

        const { rows } = await pool.query(`
    SELECT id, email, link_precedence
    FROM contacts
  `)

        const primary = rows.find(r => r.link_precedence === 'primary')
        expect(primary).toBeDefined()
        expect(primary.email).toBe('old@flux.com')
    })

    test('email normalization (case + whitespace)', async () => {
        await identify({
            email: '  DOC@FLUX.COM  ',
            phoneNumber: '555',
        })

        await identify({
            email: 'doc@flux.com',
            phoneNumber: '555',
        })

        const { rows } = await pool.query('SELECT * FROM contacts')
        expect(rows).toHaveLength(1)
    })

    test('handles secondary-to-secondary cross linking', async () => {
        await identify({ email: 'a@test.com', phoneNumber: '111' })
        await identify({ email: 'b@test.com', phoneNumber: '111' }) // secondary

        await identify({ email: 'c@test.com', phoneNumber: '222' })
        await identify({ email: 'd@test.com', phoneNumber: '222' }) // secondary

        await identify({ email: 'b@test.com', phoneNumber: '222' }) // bridge via secondaries

        const { rows } = await pool.query(
            'SELECT * FROM contacts WHERE link_precedence = \'primary\''
        )

        expect(rows).toHaveLength(1)
    })
})

//validation
describe('POST /identify - Request Validation', () => {
    test('returns 400 if both email and phoneNumber missing', async () => {
        const res = await identify({})
        expect(res.status).toBe(400)
    })

    test('returns 400 if email is not string', async () => {
        const res = await identify({
            email: 12345,
            phoneNumber: '111',
        })
        expect(res.status).toBe(400)
    })

    test('returns 400 if phoneNumber invalid type', async () => {
        const res = await identify({
            email: 'test@test.com',
            phoneNumber: { bad: true },
        })
        expect(res.status).toBe(400)
    })
    test('returns 400 for empty strings', async () => {
        const res = await identify({
            email: '',
            phoneNumber: '',
        })
        expect(res.status).toBe(400)
    })

    test('returns 400 for whitespace-only email', async () => {
        const res = await identify({
            email: '   ',
            phoneNumber: null,
        })
        expect(res.status).toBe(400)
    })

    test('returns 400 when both fields explicitly null', async () => {
        const res = await identify({
            email: null,
            phoneNumber: null,
        })
        expect(res.status).toBe(400)
    })

    test('returns 400 when email format is invalid', async () => {
        const invalidEmails = [
            "plainaddress",          // No @
            "#@%^%#$@#$@#.com",      // Garbage/Symbols
            "@example.com",          // Missing username
            "email.example.com",     // Missing @
            "email@example@com",     // Double @ or missing TLD dot
            "email@example",         // Missing TLD (.com, .net)
            ".email@example.com",    // Leading dot
            "email@-example.com",    // Invalid domain start
        ]

        for (const email of invalidEmails) {
            const res = await identify({
                email: email,
                phoneNumber: null,
            })
            expect(res.status).toBe(400)
        }
    })

})

// concurrency
describe('POST /identify - Concurrency', () => {
    test('no duplicate secondary under stress', async () => {
        process.env.IDENTITY_TEST_DELAY_MS = '100'

        await identify({ email: 'doc@flux.com', phoneNumber: '111' })

        const calls = Array.from({ length: 20 }).map(() =>
            identify({
                email: 'new@flux.com',
                phoneNumber: '111',
            })
        )

        await Promise.all(calls)

        const { rows } = await pool.query('SELECT * FROM contacts')
        expect(rows.length).toBe(2)
    })

    test('no double primary under heavy zero-state race', async () => {
        process.env.IDENTITY_TEST_DELAY_MS = '100'

        const payload = {
            email: 'fresh@flux.com',
            phoneNumber: '999999',
        }

        const calls = Array.from({ length: 25 }).map(() =>
            new Promise(resolve =>
                setTimeout(
                    () => resolve(identify(payload)),
                    Math.random() * 40
                )
            )
        )

        await Promise.all(calls)


        const { rows } = await pool.query(`
      SELECT * FROM contacts WHERE link_precedence = 'primary'
    `)

        expect(rows.length).toBe(1)
    })

    test('elite cross-bridge race collapses to single primary', async () => {
        process.env.IDENTITY_TEST_DELAY_MS = '200'

        await identify({ email: 'a@flux.com', phoneNumber: '111' })
        await identify({ email: 'c@flux.com', phoneNumber: '222' })

        // start with two primaries
        const before = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM contacts
    WHERE link_precedence = 'primary'
  `)
        expect(before.rows[0].count).toBe(2)

        const calls: Promise<any>[] = []

        for (let i = 0; i < 20; i++) {
            calls.push(
                identify({
                    email: 'a@flux.com',
                    phoneNumber: '222',
                })
            )

            calls.push(
                identify({
                    email: 'c@flux.com',
                    phoneNumber: '111',
                })
            )
        }

        await Promise.allSettled(calls)


        const all = await pool.query(`
    SELECT id, linked_id, link_precedence, email, phone_number
    FROM contacts
    ORDER BY id
  `)

        const primaries = all.rows.filter(
            (r) => r.link_precedence === 'primary'
        )

        expect(primaries).toHaveLength(1)

        const primaryId = primaries[0].id

        // every secondary must point to the same primary
        const secondaries = all.rows.filter(
            (r) => r.link_precedence === 'secondary'
        )

        for (const s of secondaries) {
            expect(s.linked_id).toBe(primaryId)
        }

        // cluster must contain both identities
        const emails = new Set(
            all.rows.map((r) => r.email).filter(Boolean)
        )

        expect(emails.has('a@flux.com')).toBe(true)
        expect(emails.has('c@flux.com')).toBe(true)
    })
})