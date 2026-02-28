import { pool } from '../src/db'

export default async function globalTeardown() {
    await pool.end()
}