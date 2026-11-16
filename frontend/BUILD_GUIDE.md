# My PADI — how to get the app on your phone

This folder is the complete source code of **My PADI** (an Expo / React Native app,
package id `com.mypadi.app`). It was not built into an installable file here: an Android or
iOS app has to be built and signed by a build service, and that build is yours, under your
own free account.

You need a computer (Windows, macOS or Linux) with **Node.js 20 or newer**
(https://nodejs.org) for the steps below. No Android Studio, Java or Mac is needed.

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
builds use the device geocoder. The default spoken voice uses a higher pitch and
slower pace; the available voice quality depends on the voices installed on the
device. Browsers require a tap before speech can play, so they show a play
button. Greeting text is localized for English, Nigerian Pidgin, and French;
other language selections currently fall back to English. Native builds include
the foreground location usage message from `app.json`; rebuild after changing
native permissions.

## What was and was not checked

Checked before delivery: the code type-checks and the Android JavaScript bundle compiles.
Not checked: running on a real device. Test the installed app before sharing it, and report
anything that misbehaves together with a screenshot.
