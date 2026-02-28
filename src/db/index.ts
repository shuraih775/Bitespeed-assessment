import { Pool, types } from 'pg'
import dotenv from 'dotenv'
import path from 'path'

const envFile =
    process.env.NODE_ENV === 'test'
        ? '.env.test'
        : '.env'

dotenv.config({
    path: path.resolve(process.cwd(), envFile),
    quiet: true,
})

types.setTypeParser(20, (val) => Number(val)) // BIGINT
types.setTypeParser(1184, (val) => new Date(val)) //timestampz

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20
})