# BiteSpeed Identity Reconciliation - Backend

This backend service implements identify reconciliation task described in the document provided by the **BiteSpeed** team. The implementation is focused on correctness under concurrency, determinism in merges, and schema designed for the query/access patterns.

---

# Problem Summary

Multiple contact records may represent the same real user. The service must:

* Merge identities when overlapping information appears
* Preserve the oldest primary contact
* Maintain a clean primary → secondary graph
* Avoid duplicate or conflicting records under concurrency
* Support soft deletion
* Return a deterministic aggregated view

---

# High Level Design

```
Express Controller
        ↓
Identity Service (transaction + merge logic)
        ↓
Contact Repository (raw SQL)
        ↓
PostgreSQL (indexed, constrained schema)
```

# Schema Design


    `id              BIGSERIAL PRIMARY KEY`

    `email           TEXT`
    `phone_number    TEXT`

    `linked_id       BIGINT  REFERENCES contacts(id)`

    `link_precedence ENUM('PRIMARY','SECONDARY')`

    `created_at      TIMESTAMPTZ`
    `updated_at      TIMESTAMPTZ`
    `deleted_at      TIMESTAMPTZ`

1. `id` is our primary key and is kept `BIGSERIAL` cuz it avoid exhaustion concerns. Although it has bigger storage overhead than `int`, at scale it doesn't really matter much.

2. `email` is kept as text alongside `phone_number`. Keeping `phone_number` as string makes sense because even country code can be entered. Although right now we are not merging numbers by removing country codes.

3. linked_id is self-referencing foreign key. Where secondary contacts point to primary ones. 

4. link_precendence is an kept as `ENUM` instead of `string` for better predicatabilty. We do have constraint here so that linked_id and link_precedence should be in sync. Although link_precedence can be derived from linked_id, it is stored explicitly to simplify queries and maintain alignment with the provided schema.

5. The last three fields are self explaining. `deleted_at` field is used to support soft deleting.

