# BiteSpeed Identity Reconciliation - Backend

This backend service implements identify reconciliation task described in the document provided by the **BiteSpeed** team. The implementation is focused on correctness under concurrency, determinism in merges, and schema designed for the query/access patterns.

---

**Important Note: The response intentionally has a spelling mistake in `primaryContatctId` as it was repeated through out the document provided by the bitespeed team.**

---

# Deployment

The app is deployed on the Render Platform.

Link to the deployment: [https://bitespeed-assessment-jawn.onrender.com](https://bitespeed-assessment-jawn.onrender.com)

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

5. The last three columns are self explaining. `deleted_at` column is used to support soft deleting.


* An extra check is added to check whether either of email or phone_number is not null. Although the spec and the js logic avoids it.

* One more check is added ```CHECK ( (link_precedence = 'primary' AND linked_id IS NULL) OR (link_precedence = 'secondary' AND linked_id IS NOT NULL) )``` 
which ensures that db is never in impossible state.

* A trigger is also set that will update the updated_at column whenever a row gets updated.
## Indexing Strategy

Partial Indexes are used on `email`, `phone_number` and `linked_id` only considering rows where deleted_At is not NULL and the column itself is not null

because 

 * equality lookups dominate

* deleted rows are cold

* identity clusters grow over time

* queries always filter deleted_at IS NULL

**Benefits:**

smaller indexes

avoids soft-delete bloat


Why didnt I use composite index of (email,phone_number)? Because Postgres cannot efficiently use a composite index for OR equality across different columns.
Better to use two single indexes with OR operation.

---

# Repository Layer

The repository layer intentionally uses SQL directly instead of using an ORM.

Because:
* predictable query plans
* explicit control over locking

Chosen for more transparency and displaying the skills to write efficient queries directly in SQL.
Although it reduces the abstraction.

### Transaction aware execution

Each repository function takes an explicit `PoolClient` 
Why:

* To have a single transaction per identity calls.
* Consistent reads.
* Safe merges.
* explicit row level locking.

### Concurrency Strategy

Identity reconcillation is race prone:

We use two strategies:
1. Row-level Locking on Primaries

    * It is used to prevent state corruption during concurrent merge requests:
        * primary demotion
        * secondary attachment
        * cluster mutation
**Note:** Primary IDs are sorted before locking to prevent deadlocks.

Although it has small overhead it comes with deterministic changes.

2. Advisory Lock:

    `pg_advisory_xact_lock(hash(email, phone))` is used.
    When two primary id creation request concurrently occurs, we dont have any row to lock so we need this advisory lock in order to prevent duplicate records or undesired behaviour.


---

# Identity reconciliation Algorithm

* Normalize inputs
* Acquire advisory lock
* Find seed contacts
* Expand full cluster
* Determine oldest primary
* Lock primaries (FOR UPDATE)
* Demote newer primaries if needed
* Insert secondary if new information appears
* Return aggregated view

This ensures:

* exactly one primary per cluster
* oldest primary always wins
* no duplicate secondaries
* idempotent repeated requests
* safe concurrent merges
* deterministic response
