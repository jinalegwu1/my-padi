# My PADI — how to get the app on your phone

This folder is the complete source code of **My PADI** (an Expo / React Native app,
package id `com.mypadi.app`). A local Android development APK was built on
November 20, 2026. It is a test build named **My PADI Voice Test**, with package
id `com.mypadi.app.voicetest`, and needs the running development services.
Production distribution still needs an appropriately signed Android or iOS build.

You need a computer (Windows, macOS or Linux) with **Node.js 20 or newer**
(https://nodejs.org) for the cloud-build steps below. Local Android builds also
need Java and the Android SDK; local iOS builds need macOS and Xcode.

## Voice development and testing

Voice needs a development build containing the local PadiVoice microphone
module. Expo Go cannot load that module. From the repository root, prepare the
configured backend environment and run:

```sh
npm ci --prefix frontend
npm run setup:voice
npm run dev
```

Prepare `frontend/.env` from its public example when needed. Keep the configured
private backend environment separate. Use one assignment per setting and keep
URLs, tokens, and model IDs on one line; a later placeholder assignment can
override a working value. Apply existing database migrations when setting up
a new database.

For a local phone build, run `npx expo run:android` from this folder. On macOS,
use `npx expo run:ios`. For an EAS development build, use the prepared
`development` profile, for example
`npx eas-cli build --platform android --profile development`, after linking the
project to your Expo account. iPhone builds require suitable Apple signing.

Open the development build and connect it to the computer's Metro server on
port 8081. The phone must also reach Go on port 8080. Native development maps
a loopback API setting to Expo's LAN host; explicit remote addresses stay fixed.

The local Android APK is at `/tmp/my-padi-voice-test.apk` in this development
workspace. Its signature and PadiVoice module inclusion were checked. It contains
ARM64 native libraries and installs alongside the existing app. It has not been
tested on a physical phone. This temporary artifact is outside Git and may be
removed when the workspace is cleaned.

`npm run verify:voice` and `npm run verify:voice:browser` check the configured
services with public/synthetic audio and temporary accounts. See the
[voice verification checklist](../docs/voice-verification.md) for device tests.

## Android: get an installable APK (free)

1. Create a free account at https://expo.dev/signup.
2. Unzip this folder, open a terminal inside it, and run:

   ```bash
   npm install
   npm install -g eas-cli
   eas login
   eas init
   eas build --platform android --profile preview
   ```

   - `eas init` links the project to your account the first time; answer **Yes**.
   - When asked to generate a new Android keystore, answer **Yes**. Expo stores it for you,
     so every later build is signed with the same key and installs as an update.
3. The build runs in Expo's cloud. Free accounts wait in a low-priority queue, which at
   busy times can take over an hour.
   When it finishes, the terminal and the page on expo.dev show a link and a QR code.
   Open it on your Android phone, download the `.apk` and install it (allow "install
   unknown apps" for your browser when Android asks).

The free plan includes a limited number of builds per month (about 15 Android builds,
see https://expo.dev/pricing).

## iPhone and the app stores (optional)

- **iPhone** needs an Apple Developer Program membership (99 USD/year). Then run
  `eas build --platform ios --profile production` and `eas submit --platform ios`, and
  install it through TestFlight. Details: https://docs.expo.dev/submit/ios/
- **Google Play** needs a developer account (one-time 25 USD). Then run
  `eas build --platform android --profile production` and `eas submit --platform android`.
  Details: https://docs.expo.dev/submit/android/

## Settings you may need to fill in

- `.env.example` → copy to `.env` and fill in `EXPO_PUBLIC_API_URL` if the app talks to a
  server. For a phone on your Wi-Fi, use your computer's LAN IP instead of
  `localhost`. Values in `.env` are bundled into the app and readable by anyone who has
  it: never put passwords, SMS credentials, AI keys, or other secret keys there.
  Production API URLs must use HTTPS.
- `app.json` → `name` (shown under the icon), `version`, and the icon files in
  `assets/images/`.

## Location, weather, and spoken greetings

First-time setup introduces PADI, asks for a preferred language, then requires
foreground location permission before entering the app. On each later app open,
PADI looks up the current area and weather and speaks a time- and weather-aware
greeting. Location is not tracked in the background or saved; weather
coordinates are rounded to about 1 km for area lookup and 11 km before they
are sent to Open-Meteo. Browser area names use OpenStreetMap Nominatim; native
builds use the device geocoder. PADI's spoken introduction, greetings, previews,
and conversations now use its expressive Go/Python speech service at normal
pitch. Personal weather greetings require sign-in; fixed introductions and
previews are cached public phrases. Service failures keep the text available
and are reported without switching to device speech. Browsers require a tap
before speech can play, so they show a play
button. Greeting text is localized for English, Nigerian Pidgin, and French;
other language selections currently fall back to English. Native builds include
the foreground location usage message from `app.json`; rebuild after changing
native permissions.

## What was and was not checked

Current software and native build results are recorded in the linked voice
verification document. Android PadiVoice Kotlin compilation passed; iOS native
compilation and physical microphone/speaker/echo checks remain pending. The full
Android development APK build also passed, including the current animation libraries.
Test the installed development app before sharing it. Naturalness requires
listening to the actual voices as well as passing software checks.
