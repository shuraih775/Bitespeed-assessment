CREATE INDEX IF NOT EXISTS  idx_contacts_email
ON contacts (email)
WHERE  deleted_at IS NULL AND email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_phone
ON contacts (phone_number)
WHERE deleted_at IS NULL AND phone_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS  idx_contacts_linked_id
ON contacts (linked_id)
WHERE deleted_at IS NULL AND linked_id IS NOT NULL;
