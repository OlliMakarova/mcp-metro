# PostgreSQL Database

The SDK wraps [`af-db-ts`](https://www.npmjs.com/package/af-db-ts) with a thin sugar layer bound to a single
logical connection — `main`. All helper functions below are pre-configured with `connectionId = 'main'`,
automatically register `pgvector` when the extension is enabled, and normalize the call shape (SQL string or
full argument object).

For the vast majority of MCP servers **only the sugar layer is needed** — direct `af-db-ts` calls are
reserved for edge cases (secondary databases, transactions on an explicit client, cursor streaming,
cross-DB migration).

## 1. Enabling / Disabling the Database

Database support is driven entirely by `config/*.yaml`. The SDK computes `appConfig.isMainDBUsed` at startup
based on whether a host is configured:

```yaml
db:
  postgres:
    dbs:
      main:
        label: 'My Database'        # shown in diagnostics and admin pages
        host: ''                    # empty string disables DB (isMainDBUsed = false)
        port: 5432
        database: <database>
        user: <user>
        password: <password>
        usedExtensions: []          # e.g. [pgvector]
```

- `host: ''` — DB is disabled. `getMainDBConnectionStatus()` returns `'db_not_used'`; the `MAIN` helpers
  are not meant to be called in this state.
- `host: <value>` — DB is enabled. Call `await checkMainDB()` early in startup so a misconfigured server
  fails fast instead of returning 500s later.

### Enabling `pgvector`

```yaml
db:
  postgres:
    dbs:
      main:
        # ...
        usedExtensions:
          - pgvector
```

When `pgvector` is listed, the SDK automatically injects `pgvector.registerType` into every `queryMAIN`
call, so `vector` columns come back as `number[]` with no per-call setup.

## 2. Sugar Layer — the `MAIN` Family

All imports come from `fa-mcp-sdk`:

```typescript
import {
  queryMAIN, queryRsMAIN, oneRowMAIN, execMAIN,
  getInsertSqlMAIN, getMergeSqlMAIN, mergeByBatch,
  checkMainDB, getMainDBConnectionStatus,
  IQueryPgArgsCOptional,
} from 'fa-mcp-sdk';
```

Every query-style helper accepts **two call shapes**:

1. `fn(sqlText, sqlValues?, throwError?)` — shortest form, preferred for most reads.
2. `fn({ sqlText, sqlValues, throwError, client, ... })` — full `IQueryPgArgsCOptional` object, needed when
   you want to pass `client` (external pool client for transactions), a log `prefix`, or other advanced
   options.

### 2.1. `queryMAIN<R>(arg, sqlValues?, throwError?)`

Returns the full `QueryResult<R>` (`rows`, `rowCount`, `fields`, …) or `undefined` on error when
`throwError=false`.

```typescript
// Prepared parameters — always preferred for user input
const res = await queryMAIN<{ id: number; email: string }>(
  `SELECT id, email FROM public.users WHERE active = $1 ORDER BY id`,
  [true],
);
const firstEmail = res?.rows?.[0]?.email;

// Object form — e.g. inside an externally-opened transaction
await queryMAIN({ client, sqlText: `TRUNCATE TABLE public.staging;` });
```

### 2.2. `queryRsMAIN<R>(arg, sqlValues?, throwError?)`

"Rows only" — returns `R[] | undefined`. Use in ~90% of reads when metadata isn't needed.

```typescript
const rows = await queryRsMAIN<{ userId: number }>(
  `SELECT "userId" FROM public.sessions WHERE "expiresAt" > NOW()`,
);
const ids = new Set((rows || []).map((r) => r.userId));
```

### 2.3. `oneRowMAIN<R>(arg, sqlValues?, throwError?)`

Returns the first row or `undefined` — the most readable form for look-ups.

```typescript
const user = await oneRowMAIN<{ id: number; role: string }>(
  `SELECT id, role FROM public.users WHERE email = $1`,
  [email],
);
if (!user) throw new Error('User not found');
```

### 2.4. `execMAIN(arg): Promise<number | undefined>`

For DDL/DML without consuming rows. Returns `rowCount` (or the **sum** of `rowCount` for batch SQL
concatenated with `;`). Handy for "how many rows did I affect" counters and for transaction primitives.

```typescript
// Single statement
await execMAIN(`UPDATE public.jobs SET status = 'done' WHERE id = ${jobId}`);

// Batch UPDATE — sum of rowCount across ;-separated statements
const sqls = await Promise.all(items.map((it) => buildUpdateSql(it)));
const affected = await execMAIN(sqls.join('\n'));

// Transaction primitives — simple flow on the cached pool
try {
  await execMAIN({ sqlText: 'BEGIN' });
  // ... writes via queryMAIN / execMAIN ...
  await execMAIN({ sqlText: 'COMMIT' });
} catch (err) {
  await execMAIN({ sqlText: 'ROLLBACK' });
  throw err;
}
```

### 2.5. `getInsertSqlMAIN<U>(arg): Promise<string>`

Generates an `INSERT` statement from table metadata — the recordset is filtered against the table schema,
so fields that don't exist in the table are silently dropped. Pair with `queryMAIN` to execute.

| Field                  | Purpose                                                                           |
|------------------------|-----------------------------------------------------------------------------------|
| `commonSchemaAndTable` | `'schema.table'`                                                                  |
| `recordset`            | `TRecordSet<U>` — rows to insert                                                  |
| `excludeFromInsert`    | Columns to skip (typically the auto-increment PK)                                 |
| `addOutputInserted`    | Append `RETURNING *` to get generated ids / defaults                              |
| `isErrorOnConflict`    | Throw on uniqueness violation (default: swallowed)                                |
| `keepSerialFields`     | Do **not** drop `serial` values from the recordset (used when migrating ids)      |

```typescript
const sql = await getInsertSqlMAIN({
  commonSchemaAndTable: 'public.users',
  recordset: [{ name: 'John', email: 'john@example.com' }],
  excludeFromInsert: ['id'],       // PK is auto-increment
  addOutputInserted: true,
});
const res = await queryMAIN<{ id: number; name: string }>(sql, undefined, true);
const created = res?.rows?.[0];
```

### 2.6. `getMergeSqlMAIN<U>(arg): Promise<string>`

Generates an upsert — `INSERT ... ON CONFLICT (...) DO UPDATE ...`.

| Field                          | Purpose                                                                                       |
|--------------------------------|-----------------------------------------------------------------------------------------------|
| `commonSchemaAndTable`         | `'schema.table'`                                                                              |
| `recordset`                    | `TRecordSet<U>` — rows to upsert                                                              |
| `conflictFields`               | Columns for `ON CONFLICT (...)`. Defaults to the PK                                           |
| `omitFields`                   | Excluded from both `INSERT` and `UPDATE` (no effect when `updateFields` is set explicitly)    |
| `updateFields`                 | If set — only these fields appear in `DO UPDATE` (minus `fieldsExcludedFromUpdatePart`)       |
| `fieldsExcludedFromUpdatePart` | Present in `INSERT`, excluded from `UPDATE` — typical for `createdAt`, `createdBy`            |
| `noUpdateIfNull`               | Don't overwrite existing values with `NULL` — **critical for incremental syncs with partial payloads** |
| `mergeCorrection`              | `(sql) => sql` — final rewrite hook                                                           |
| `returning`                    | `'*'` or quoted field list for `RETURNING`                                                    |

```typescript
const mergeSql = await getMergeSqlMAIN({
  commonSchemaAndTable: 'public.external_items',
  recordset: batch,
  noUpdateIfNull: true,                              // partial payload upsert
  fieldsExcludedFromUpdatePart: ['createdBy', 'createdAt'],
});
await queryMAIN(mergeSql);
```

### 2.7. `mergeByBatch<U>({ recordset, getMergeSqlFn, batchSize? })`

Universal batched-upsert runner. Slices `recordset` into batches, calls `getMergeSqlFn(batch)` for each, and
executes the generated SQL through `queryMAIN`. Returns one entry per batch.

- Default `batchSize` is `999`; in practice **use 50–100 for wide rows** — you hit Postgres' parameter
  limit or statement-size limit well before 999.
- **The runner mutates the input via `Array.prototype.splice`.** By the time it returns, `recordset` is
  empty. Clone the array upfront if you need to retain the data.

```typescript
const getMergeSqlFn = async (batch: TRecordSet) => getMergeSqlMAIN({
  commonSchemaAndTable: 'public.publications',
  recordset: batch,
  noUpdateIfNull: true,
});
await mergeByBatch({ recordset: dataset, getMergeSqlFn, batchSize: 100 });
// dataset is now []
```

### 2.8. `checkMainDB()`

Startup liveness check. Runs `SELECT 1 FROM pg_catalog.pg_class LIMIT 1` — a neutral query that works on
any PostgreSQL instance. On failure (except under `NODE_ENV=test`) the process exits with code `1`. Call
it early in `start.ts` so misconfigured servers fail immediately.

### 2.9. `getMainDBConnectionStatus()`

Returns one of `'connected' | 'disconnected' | 'error' | 'db_not_used'`. Safe to call from a `/health`
endpoint or admin page — never throws, never exits.

## 3. Types

```typescript
// Re-exported by the SDK
import { IQueryPgArgsCOptional } from 'fa-mcp-sdk';

// Directly from af-db-ts when you need them
import { IQueryPgArgs, TDBRecord, TRecordSet } from 'af-db-ts';
```

- `IQueryPgArgs` — full query-arg shape used by `queryPg` directly; `connectionId` is required.
- `IQueryPgArgsCOptional` — what the `MAIN` helpers accept; `connectionId` is pre-filled by the SDK.
- `TDBRecord` — `Record<string, any>` — a generic row shape. Prefer concrete interfaces (`IUserRow`, …)
  where they exist; use `TDBRecord` only when the row shape is not fixed.
- `TRecordSet<U extends TDBRecord = TDBRecord>` — the array shape expected by `getInsertSqlMAIN`,
  `getMergeSqlMAIN`, and `mergeByBatch`.

## 4. Decision Tree

```
Need to talk to the main DB?
├─ Yes → use the sugar layer
│    ├─ rows only (R[])              → queryRsMAIN
│    ├─ single row (R | undefined)   → oneRowMAIN
│    ├─ full QueryResult (rowCount…) → queryMAIN
│    ├─ DDL / DML, no rows           → execMAIN
│    ├─ generate INSERT SQL          → getInsertSqlMAIN → queryMAIN
│    ├─ generate UPSERT SQL          → getMergeSqlMAIN  → queryMAIN
│    └─ batch upsert many rows       → mergeByBatch + getMergeSqlMAIN
└─ No (secondary DB / low level)  → direct af-db-ts imports
     ├─ plain query                 → queryPg + IQueryPgArgs (wrap it, mirror pg-db.ts)
     ├─ transaction / cursor        → getPoolPg(<id>) + manual BEGIN/COMMIT/ROLLBACK
     └─ cross-DB SQL generation     → getInsertSqlPg / getMergeSqlPg / getUpdateSqlPg
```

## 5. Best-Practice Checklist

- [ ] Use the `MAIN` sugar for the main DB — reach for `queryPg` only when talking to a secondary database.
- [ ] Always pass user input through `sqlValues` (`$1`, `$2`, …) — no string concatenation.
- [ ] Type your rows: `queryMAIN<IUserRow>(...)`, `TRecordSet<IUserRow>` in SQL generators.
- [ ] For auto-increment tables: `excludeFromInsert: ['<pk>']` + `addOutputInserted: true` when you need
      the generated id back.
- [ ] For incremental syncs of external sources with partial payloads: `noUpdateIfNull: true`; put audit
      columns (`createdAt`, `createdBy`) into `fieldsExcludedFromUpdatePart`.
- [ ] For large recordsets go through `mergeByBatch` — remember it **mutates** the input.
- [ ] For transactions on the main DB the simplest form is
      `execMAIN({ sqlText: 'BEGIN' | 'COMMIT' | 'ROLLBACK' })`. When you need a single physical client
      across many operations, use `getPoolPg(...)` from `af-db-ts` and pass the resulting `client` through
      the object form of the `MAIN` helpers.
- [ ] Never call `client.release()` on a client obtained from `getPoolPg` — pool lifecycle is owned by the
      SDK and closed during graceful shutdown (via `closeAllPgConnectionsPg`).
- [ ] For writes whose success must be verified, pass `throwError = true` so failures surface instead of
      silently returning `undefined`.
- [ ] Call `await checkMainDB()` early at startup; expose `getMainDBConnectionStatus()` from `/health`.

## 6. Secondary Databases (advanced)

The SDK only exposes sugar for the single `main` connection. If your server needs extra databases, declare
them under `db.postgres.dbs.<alias>` and write a small wrapper mirroring `src/core/db/pg-db.ts` — set the
appropriate `connectionId` and, if needed, supply `registerTypesFunctions`. Typical cases: read-only
replicas, legacy sources, cross-service ETL jobs.

```typescript
import { queryPg, IQueryPgArgs } from 'af-db-ts';
import type { QueryResult, QueryResultRow } from 'pg';

const SECONDARY = 'reporting';   // must match a key under db.postgres.dbs

export const queryReporting = async <R extends QueryResultRow = any> (
  arg: string | Omit<IQueryPgArgs, 'connectionId'>,
  sqlValues?: any[],
  throwError = false,
): Promise<QueryResult<R> | undefined> => {
  const q: IQueryPgArgs = typeof arg === 'string'
    ? { sqlText: arg, connectionId: SECONDARY, sqlValues, throwError }
    : { ...arg, connectionId: SECONDARY };
  return queryPg<R>(q);
};
```
