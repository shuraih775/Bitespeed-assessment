import { Request, Response } from 'express'
import { identifyService } from '../services/identity.service'

export async function identifyController(
    req: Request,
    res: Response
) {
    try {
        const { email: rawEmail, phoneNumber: rawPhone } = req.body ?? {}

        // type validation 
        if (rawEmail !== undefined && rawEmail !== null && typeof rawEmail !== 'string') {
            return res.status(400).json({ error: 'email must be a string' })
        }

        if (rawPhone !== undefined && rawPhone !== null) {
            if (typeof rawPhone !== 'string' && typeof rawPhone !== 'number') {
                return res.status(400).json({ error: 'phoneNumber must be a string or number' })
            }
        }

        // normalize
        let email: string | null = null
        let phoneNumber: string | null = null

        if (typeof rawEmail === 'string') {
            const trimmed = rawEmail.trim().toLowerCase()
            if (trimmed !== '') email = trimmed
        }

        if (rawPhone !== undefined && rawPhone !== null) {
            const trimmed = rawPhone.toString().trim()
            if (trimmed !== '') phoneNumber = trimmed
        }

        // final presence check 
        if (email === null && phoneNumber === null) {
            return res.status(400).json({
                error: 'Either email or phoneNumber must be provided',
            })
        }

        const result = await identifyService({
            email,
            phoneNumber,
        })

        return res.status(200).json(result)
    } catch (err) {
        console.error('identifyController error:', err)
        return res.status(500).json({
            error: 'Internal server error',
        })
    }
}