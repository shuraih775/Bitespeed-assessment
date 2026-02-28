import fs from 'fs'
import path from 'path'
import { pool } from './index'

async function runMigrations() {
    const migrationsDir = path.join(__dirname, '../../migrations')
    const files = fs.readdirSync(migrationsDir).sort()

    for (const file of files) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
        console.log(`Running migration: ${file}`)
        await pool.query(sql)
    }

    console.log('Migrations complete')
    process.exit(0)
}

runMigrations().catch((err) => {
    console.error(err)
    process.exit(1)
})