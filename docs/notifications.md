# Citizen Notifications

Citizen report-status notifications have two delivery surfaces: a durable in-app
inbox and Firebase Cloud Messaging (FCM) push delivery. A database trigger creates
an inbox item when a report moves to `IN_PROGRESS`, `RESOLVED`, or `REJECTED`.
The API worker sends each item to every active device registered by that citizen.

## Deploy the database and API

Apply `20261015200000_add_citizen_push_notifications.sql` before enabling the
worker. Configure these API environment variables:

```text
PUSH_NOTIFICATIONS_ENABLED=true
FIREBASE_PROJECT_ID=<firebase-project-id>
FIREBASE_CLIENT_EMAIL=<service-account-email>
FIREBASE_PRIVATE_KEY=<service-account-private-key-with-escaped-newlines>
```

Keep the service-account key only in the server secret manager. The worker uses
the FCM HTTP v1 API, retries transient failures, recovers abandoned jobs, and
disables tokens that FCM reports as unregistered.

## Build the citizen app

Supply the public Firebase application settings as Dart defines. Use the app ID
for the platform being built:

```powershell
flutter run `
  --dart-define=FIREBASE_API_KEY=<firebase-web-api-key> `
  --dart-define=FIREBASE_PROJECT_ID=<firebase-project-id> `
  --dart-define=FIREBASE_MESSAGING_SENDER_ID=<sender-id> `
  --dart-define=FIREBASE_ANDROID_APP_ID=<android-app-id>
```

For iOS, replace the Android app ID with `FIREBASE_IOS_APP_ID` and also set
`FIREBASE_IOS_BUNDLE_ID`. In Apple Developer and Xcode, enable Push
Notifications and Background Modes > Remote notifications for the production
bundle ID. Upload an APNs authentication key or certificate to Firebase. The
checked-in entitlement is for development signing; the distribution profile
must provide the production `aps-environment` entitlement.

Android requires the registered production package name. Add the Android app in
Firebase with that package name before creating a release build. This project
initializes Firebase from Dart defines, so Firebase's public configuration does
not need to be committed as `google-services.json` or `GoogleService-Info.plist`.

## Acceptance test

1. Apply the migration and deploy the API with the worker enabled.
2. Install a build containing the correct Firebase defines on a physical device.
3. Sign in, enable **Profile > Notifications > Report updates**, and grant the
   operating-system notification permission.
4. Confirm one active row exists in `citizen_push_devices` for that citizen.
5. Change one of the citizen's reports from `PENDING` to `IN_PROGRESS`.
6. Confirm an inbox record and delivery record are created, the push appears in
   the background, and tapping it opens the matching report detail.
7. Repeat while the app is foregrounded and confirm the in-app inbox refreshes.
8. Disable report updates and confirm the device token is disabled and later
   status changes create no notification for that citizen.
9. Sign out and confirm device cleanup does not block logout.

Never use production citizen content or device tokens in screenshots or release
evidence.
