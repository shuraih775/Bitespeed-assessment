import { PoolClient } from 'pg'
import { pool } from '../db'
import { ContactRow } from '../types/contact'

/**
 * NOTE:
 * All functions accept optional client for transactions.
 * If client is provided → use it.
 * Else → fallback to pool.
 */

function getExecutor(client?: PoolClient) {
    return client ?? pool
}

function assertSingleRow<T>(rows: T[], context: string): T {
    if (rows.length !== 1) {
        throw new Error(`${context}: expected exactly 1 row, got ${rows.length}`)
    }
    return rows[0]
}

function assertNonEmptyArray<T>(arr: T[], context: string) {
    if (arr.length === 0) {
        throw new Error(`${context}: expected non-empty array`)
    }
}

function assertValidIds(ids: number[], context: string) {
    for (const id of ids) {
        if (!Number.isInteger(id) || id <= 0) {
            throw new Error(`${context}: invalid id ${id}`)
        }
    }
}
/**
 * Find seed contacts by email OR phone.
 * Uses indexes on email and phone_number.
 */
export async function findByEmailOrPhone(
    email: string | null,
    phone: string | null,
    client?: PoolClient
): Promise<ContactRow[]> {
    const exec = getExecutor(client)

    const conditions: string[] = []
    const values: unknown[] = []

    if (email !== null) {
        values.push(email)
        conditions.push(`email = $${values.length}`)
    }

    if (phone !== null) {
        values.push(phone)
        conditions.push(`phone_number = $${values.length}`)
    }

    if (conditions.length === 0) return []

    const query = `
      SELECT
        id,
        email,
        phone_number,
        linked_id,
        link_precedence,
        created_at,
        updated_at,
        deleted_at
      FROM contacts
      WHERE deleted_at IS NULL
        AND (${conditions.join(' OR ')})
    `

    const { rows } = await exec.query<ContactRow>(query, values)
    return rows
}

/**
 * Fetch full cluster by primary ids.
 * Uses PK + linked_id indexes.
 */
export async function findClusterByPrimaryIds(
    primaryIds: number[],
    client?: PoolClient
): Promise<ContactRow[]> {
    if (primaryIds.length === 0) return []

    assertValidIds(primaryIds, 'findClusterByPrimaryIds')

    const exec = getExecutor(client)

    const query = `
      SELECT
        id,
        email,
        phone_number,
        linked_id,
        link_precedence,
        created_at,
        updated_at,
        deleted_at
      FROM contacts
      WHERE deleted_at IS NULL
        AND (
          id = ANY($1)
          OR linked_id = ANY($1)
        )
    `

    const { rows } = await exec.query<ContactRow>(query, [primaryIds])
    return rows
}
/**
 * Create primary contact.
 */
export async function createPrimaryContact(
    email: string | null,
    phone: string | null,
    client?: PoolClient
): Promise<ContactRow> {
    const exec = getExecutor(client)

    const query = `
      INSERT INTO contacts (
        email,
        phone_number,
        linked_id,
        link_precedence
      )
      VALUES ($1, $2, NULL, 'primary')
      RETURNING
        id,
        email,
        phone_number,
        linked_id,
        link_precedence,
        created_at,
        updated_at,
        deleted_at
    `

    const { rows } = await exec.query<ContactRow>(query, [email, phone])
    return assertSingleRow(rows, 'createPrimaryContact')
}

/**
 * Create secondary contact linked to primary.
 */
export async function createSecondaryContact(
    email: string | null,
    phone: string | null,
    primaryId: number,
    client?: PoolClient
): Promise<ContactRow> {
    assertValidIds([primaryId], 'createSecondaryContact')

    const exec = getExecutor(client)

    const query = `
      INSERT INTO contacts (
        email,
        phone_number,
        linked_id,
        link_precedence
      )
      VALUES ($1, $2, $3, 'secondary')
      RETURNING
        id,
        email,
        phone_number,
        linked_id,
        link_precedence,
        created_at,
        updated_at,
        deleted_at
    `

    const { rows } = await exec.query<ContactRow>(query, [
        email,
        phone,
        primaryId,
    ])

    return assertSingleRow(rows, 'createSecondaryContact')
}

/**
 * Demote a primary to secondary.
 */
export async function demotePrimary(
    primaryId: number,
    newPrimaryId: number,
    client?: PoolClient
): Promise<void> {
    assertValidIds([primaryId, newPrimaryId], 'demotePrimary')

    const exec = getExecutor(client)

    const query = `
      UPDATE contacts
      SET
        linked_id = $1,
        link_precedence = 'secondary'
      WHERE id = $2
    `

    const result = await exec.query(query, [newPrimaryId, primaryId])

    if (result.rowCount !== 1) {
        throw new Error(
            `demotePrimary: expected to update 1 row, got ${result.rowCount}`
        )
    }
}

/**
 * Reattach secondaries to new primary.
 */
export async function reattachSecondaries(
    oldPrimaryId: number,
    newPrimaryId: number,
    client?: PoolClient
): Promise<void> {
    assertValidIds([oldPrimaryId, newPrimaryId], 'reattachSecondaries')

    const exec = getExecutor(client)

    const query = `
      UPDATE contacts
      SET linked_id = $1
      WHERE linked_id = $2
    `

    await exec.query(query, [newPrimaryId, oldPrimaryId])
}

/**
 * Start transaction helper.
 */
export async function withTransaction<T>(
    fn: (client: PoolClient) => Promise<T>
): Promise<T> {
    const client = await pool.connect()

    try {
        await client.query('BEGIN')
        const result = await fn(client)
        await client.query('COMMIT')
        return result
    } catch (err) {
        await client.query('ROLLBACK')
        throw err
    } finally {
        client.release()
    }
}

/**
 * Lock primary rows to prevent concurrent mutations.
 * This is concurrency guard.
 */
export async function lockPrimaries(
    primaryIds: number[],
    client?: PoolClient
): Promise<void> {
    if (primaryIds.length === 0) return

    assertValidIds(primaryIds, 'lockPrimaries')

    primaryIds.sort((a, b) => a - b) // to avoid deadlock between two transactions with different order of primary keys.(see the lockprimaries query)


    const exec = getExecutor(client)

    const query = `
      SELECT id
      FROM contacts
      WHERE id = ANY($1)
      FOR UPDATE
    `

    await exec.query(query, [primaryIds])
}

export async function acquireIdentityLock(
    key: string,
    client: PoolClient
): Promise<void> {
    const query = `
    SELECT pg_advisory_xact_lock(
      ('x' || substr(md5($1), 1, 16))::bit(64)::bigint
    )
  `
    await client.query(query, [key])
}