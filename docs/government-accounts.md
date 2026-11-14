# Registering government accounts

Government registration requires a single-use invite. Once the first
administrator exists, use **Administration** in the government web app to create
a registration link, choose the recipient's role, level, state (if STATE) and
expiry, and copy the link. The recipient follows that link to create their
account. Administrators can also revoke open invitations and suspend or
reactivate existing accounts there.

The invite's stored role, level and state determine the account's role, level
and state — never the registration request body. Invite codes are stored
only as SHA-256 hashes and the raw registration link is shown only once.

## State vs federal accounts

Every OPERATOR/ADMIN account has an independent **visibility scope** alongside
its `role`:

- `role` (`OPERATOR`/`ADMIN`) controls what an account can **do** — this is unchanged.
- `government_level` (`STATE`/`FEDERAL`) controls what an account can **see**.
  A STATE account only ever sees reports, clusters and map/overview data for
  its own Nigerian state; a FEDERAL account sees all 36 states + FCT. A STATE
  **ADMIN** additionally only manages OPERATOR/ADMIN accounts and invitations
  scoped to their own state — never FEDERAL accounts or another state's.

Both fields are set once, server-side, when an invite is created — a STATE
admin can only create invites scoped to their own state, and a FEDERAL admin
can create either. The account's state and level cannot change after
registration; create a new invite to add a differently-scoped account.

A report's state is resolved automatically (point-in-polygon against the
`nigeria_states` table) from its GPS location; a report with no location is
visible to FEDERAL accounts only, since it cannot be attributed to any state.
Existing accounts created before this feature default to FEDERAL, so nothing
changes for them until a STATE invite is issued. See
[database schema](database.md#1-users) and the state-scoping notes on the
[dashboard](government-dashboard-api.md), [map](government-map-api.md),
[reports](government-reports-api.md) and [clusters](government-clusters-api.md) APIs.

## Bootstrap the first administrator

The first administrator must be provisioned manually because no authorized
administrator exists yet:

1. From PowerShell, generate a random invite and its SHA-256 hash, then **execute**
   the insert against the exact database `services/api/.env`'s `DATABASE_URL`
   points at — a bare string expression only echoes to the console and inserts
   nothing, so it must be run, not printed. Check that file first: if
   `DATABASE_URL` points at a remote Supabase project (e.g. a
   `*.pooler.supabase.com` host), use that connection string; only use the local
   `postgresql://postgres:postgres@127.0.0.1:54322/postgres` URL shown below if
   `DATABASE_URL` actually points there (local Supabase via `supabase start`).

   ```powershell
   $inviteCode = node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
   $inviteHash = node -e "console.log(require('node:crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" $inviteCode
   $sql = "INSERT INTO gov_invite_codes (code_hash, role, government_level, expires_at) VALUES ('$inviteHash', 'ADMIN', 'FEDERAL', NOW() + INTERVAL '1 day');"
   npx supabase db query --db-url '<value of DATABASE_URL from services/api/.env>' "$sql"
   ```

2. Use `ADMIN` when provisioning the first administrator; the first administrator
   should be `FEDERAL` (full visibility) unless you specifically want it scoped to
   one state, in which case also set `state_id` to that state's `id` from
   `nigeria_states` and use `'STATE'` instead. The `gov_invite_codes` and
   `nigeria_states` migrations must already be applied. `created_by` is nullable,
   allowing the first account to be provisioned before an administrator exists.

3. Keep the same PowerShell window open, edit these account details, and register:

   ```powershell
   $body = @{
     email = 'admin@example.gov.ng'
     password = 'ReplaceWithYourOwnPassword'
     nin = '12345678901'
     inviteCode = $inviteCode
   } | ConvertTo-Json

   $registration = Invoke-RestMethod -Method Post `
     -Uri 'http://localhost:3000/api/gov/auth/register' `
     -ContentType 'application/json' -Body $body
   $registration.user
   ```

The example NIN is for development: replace it with the intended account's NIN.
NIN must contain exactly 11 digits, password must be at least eight characters,
and both email and NIN must be unused. An expired or consumed invite is rejected;
generate and insert a new invite for each account.

For a JSON client such as Postman, use the **original invite code** as
`inviteCode`, never the SHA-256 hash printed in the INSERT statement. To retrieve
the original code from the same PowerShell session, run `$inviteCode`. If that
session has closed and the code was not saved, create a new invite; the hash
cannot recover the original code.

If registration logs `getaddrinfo ENOTFOUND`, the API could not resolve its
database hostname. This happens before invite validation. Check the hostname in
`services/api/.env` against your Supabase project's **Connect → Session pooler**
connection string, check DNS/network connectivity, and restart the API after any
environment changes. See [Supabase's connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).

Then sign in at http://localhost:5173 with the registered email and password.
Accounts are ACTIVE by default. The web dashboard allows active OPERATOR and
ADMIN accounts; citizens use the citizen application. Apply
`20261013120000_add_gov_invite_revocation.sql` and the six state-scoping
migrations (`20261016120000` through `20261016125000`) before using the
Administration screen.

## Starting the compiled API

From `services/api`:

```powershell
npm run build
npm run start
```

TypeScript emits CommonJS into `dist`. The build script writes
`dist/package.json` with `type: commonjs` so Node can execute the emitted `.js`
files, while source development and tests retain the package's ES-module scope.
