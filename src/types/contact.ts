export type LinkPrecedence = 'primary' | 'secondary'

export interface ContactRow {
    id: number
    email: string | null
    phone_number: string | null
    linked_id: number | null
    link_precedence: LinkPrecedence
    created_at: Date
    updated_at: Date
    deleted_at: Date | null
}