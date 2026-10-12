# Citizen authentication setup

Citizen password, Google, and Apple sign-in all end in the API's existing
15-minute access token / rotating refresh token session. Google and Apple do
not create accounts: a citizen first completes the normal NIN-backed signup,
then a provider identity with the same verified email is linked on first use.

## Database and email

Apply `20261012120000_add_citizen_auth_recovery.sql`, then configure the API:

```dotenv
PASSWORD_RESET_PEPPER=<a separate long random secret>
RESEND_API_KEY=<server-side Resend API key>
EMAIL_FROM="CivicAI <no-reply@your-verified-domain.example>"
GOOGLE_CLIENT_IDS=<Google web/server OAuth client ID>
APPLE_CLIENT_IDS=<iOS bundle ID>,<Apple Services ID>
```

Reset codes expire after 10 minutes, allow five guesses, and are stored only as
peppered hashes. A successful reset consumes outstanding codes and
revokes every refresh token for the account. In a non-production API with no
email configuration, the code is logged by the API and returned as `debugCode`;
the app fills it in automatically. Production fails closed if email is not
configured.

## Google

Create Android, iOS, and Web OAuth clients in Google Cloud for the production
application IDs/signing fingerprints. The Web client is the server client and
must match an entry in `GOOGLE_CLIENT_IDS`.

Supply public client identifiers at build time:

```powershell
flutter run `
  --dart-define=GOOGLE_SERVER_CLIENT_ID=<web-client-id> `
  --dart-define=GOOGLE_CLIENT_ID=<ios-client-id>
```

`GOOGLE_CLIENT_ID` is needed by iOS when it is not supplied in a
`GoogleService-Info.plist`. Android uses its package name and signing
certificate plus `GOOGLE_SERVER_CLIENT_ID`.

## Apple

Enable Sign in with Apple for the iOS App ID in the Apple Developer portal and
keep the checked-in `Runner.entitlements` capability. For Android, configure an
Apple Services ID and an HTTPS return endpoint that converts Apple's form POST
into the plugin's documented `intent://callback?...#Intent;...` redirect back
to the Android application.

For non-Apple platforms, supply:

```powershell
flutter run `
  --dart-define=APPLE_SERVICE_ID=<services-id> `
  --dart-define=APPLE_REDIRECT_URI=https://auth.example.com/apple/callback
```

The API validates provider signatures, issuer, audience, expiry, verified
email, and (for Apple) a per-attempt SHA-256 nonce before issuing a CivicAI
session.
