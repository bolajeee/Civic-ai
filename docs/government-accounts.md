# Registering government accounts

Government registration is currently API-only and requires a single-use invite.
The invite's stored role determines the account role, regardless of a role sent
in the request. The government web app has sign-in, but no registration screen.

1. From PowerShell, generate a random invite and its SHA-256 hash:

   ```powershell
   $inviteCode = node -e "console.log(require('node:crypto').randomBytes(24).toString('hex'))"
   $inviteHash = node -e "console.log(require('node:crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" $inviteCode
   "INSERT INTO gov_invite_codes (code_hash, role, expires_at) VALUES ('$inviteHash', 'OPERATOR', NOW() + INTERVAL '1 day');"
   ```

2. Run the printed SQL in the SQL editor for the **same database used by the API**.
   Use `ADMIN` instead of `OPERATOR` when provisioning an administrator. The
   `gov_invite_codes` migration must already be applied. `created_by` is nullable,
   allowing the first account to be provisioned before an administrator exists.

3. Keep the same PowerShell window open, edit these account details, and register:

   ```powershell
   $body = @{
     email = 'operator@example.gov.ng'
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
ADMIN accounts; citizens use the citizen application.

## Starting the compiled API

From `services/api`:

```powershell
npm run build
npm run start
```

TypeScript emits CommonJS into `dist`. The build script writes
`dist/package.json` with `type: commonjs` so Node can execute the emitted `.js`
files, while source development and tests retain the package's ES-module scope.
