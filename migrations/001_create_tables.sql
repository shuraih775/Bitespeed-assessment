DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contact_link_precedence') THEN
        CREATE TYPE contact_link_precedence AS ENUM ('primary', 'secondary');
    END IF;
END$$;
CREATE TABLE IF NOT EXISTS  contacts (
    id              BIGSERIAL PRIMARY KEY,

    email           TEXT NULL,
    phone_number    TEXT NULL,

    linked_id       BIGINT NULL REFERENCES contacts(id) ON DELETE SET NULL, -- setting null is not really needed cuz we are soft deleting

    link_precedence contact_link_precedence NOT NULL CHECK (
        (link_precedence = 'primary' AND linked_id IS NULL)
        OR
        (link_precedence = 'secondary' AND linked_id IS NOT NULL)
        ),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ NULL,

    -- spec guarentee it but i have kept a fallback check
    CONSTRAINT chk_email_or_phone
    CHECK (email IS NOT NULL OR phone_number IS NOT NULL)
);