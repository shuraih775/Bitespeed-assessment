import { pool } from '../src/db'
import fs from 'fs'
import path from 'path'

export default async function globalSetup() {
    const migrationsDir = path.join(
        __dirname,
        '../migrations'
    )

    const files = fs.readdirSync(migrationsDir).sort()

    for (const file of files) {
        const sql = fs.readFileSync(
            path.join(migrationsDir, file),
            'utf-8'
        )
        await pool.query(sql)
    }
}