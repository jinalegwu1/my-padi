# Push notification status and setup

## Current scope

The first push integration sends scheduled morning, afternoon, and evening
check-ins to opted-in users. Reminders, events, conversation follow-ups, account
updates, and re-engagement notifications are not implemented by this feature.
Local check-in notifications remain the fallback when remote push is unavailable.

## Delivery flow

1. A signed-in user enables a check-in and grants the device notification
   permission.
2. The native app obtains an Expo push token and registers its installation
   against the authenticated account through the Go API.
3. PostgreSQL stores the account-scoped device registration, check-in delivery
   queue, and delivery status.
4. The Go worker checks due schedules every 30 seconds. It uses each account's
   saved IANA timezone and quiet-hour preferences, and only queues a check-in
   during a three-minute grace window around its selected time.
5. Delivery records are deduplicated by account, device, local date, and
   check-in slot. The worker sends at most ten messages concurrently and retries
   retryable errors up to five times with exponential backoff.
6. Tapping a PADI check-in notification opens the chat screen.

The worker records successful Expo tickets as **accepted**. Expo acceptance
does not prove APNs/FCM delivery or that the operating system displayed the
notification. Expo receipt polling is not implemented.

## Configuration and migrations

1. Run the existing Go database migration command before starting the API.
   Migration `000013_create_push_notifications.sql` creates the device and
   delivery tables.
2. Set `EXPO_PUBLIC_EAS_PROJECT_ID` in `frontend/.env` to the EAS project ID
   used by the native app. The example file intentionally leaves it empty.
3. Configure the app's APNs/FCM credentials in the corresponding EAS project.
   Push delivery requires an iOS or Android native build; the browser uses the
   local-notification path.
4. Optionally set `PADI_EXPO_ACCESS_TOKEN` in `backend/.env` when Expo Push
   Security is enabled. This is a server-only secret and must not be added to
   the frontend environment.
5. Start the API with PostgreSQL and the migration applied. If native remote
   registration is not configured or fails, the app keeps local check-ins and
   displays a delivery warning in settings.

Device tokens are registered only for the signed-in account. Sign-out attempts
to unregister the current installation. The app also resynchronizes its saved
timezone and push registration when it returns to the foreground.

## Verification status

Go unit and package tests cover schedule calculation, push sender behavior,
device API validation, and worker/database-adjacent logic. Automated fixtures
do not establish live Expo delivery. The current implementation has not yet
been verified against a live PostgreSQL instance, an EAS project, APNs/FCM, or
a physical device.

Before calling delivery production-verified, test permission denial, enabling
and disabling check-ins, duplicate scheduling, account switching, sign-out,
app restart, timezone changes, quiet hours, tapping a notification, and Expo
rejection/retry behavior on both iOS and Android.
