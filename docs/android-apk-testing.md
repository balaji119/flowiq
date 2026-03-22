# Android APK Testing Build

This guide explains how to create an Android APK for direct testing on a mobile device.

Use this when you want to:

- install the app directly on an Android phone
- share a test build outside the Play Store
- validate mobile behavior on a real device

## Build Type

This project uses the `preview` EAS profile for APK builds.

See:

- [eas.json](/C:/Users/BKanagaraju/Documents/FlowIQ/eas.json)

That profile is configured with:

- `distribution: internal`
- Android `buildType: apk`

## Before You Start

1. Make sure you are in the project folder.
2. Make sure `eas-cli` is installed.
3. Make sure you are logged in to Expo.

## Commands

Go to the project:

```powershell
cd C:\Users\BKanagaraju\Documents\FlowIQ
```

Log in to Expo if needed:

```powershell
eas login
```

Build the APK:

```powershell
eas build -p android --profile preview
```

## After The Build

When the build finishes, Expo provides a download link for the `.apk`.

You can then:

1. open the link on the Android phone
2. download the APK
3. allow installation from unknown sources if Android asks
4. install the app

## Install By USB With ADB

If you want to install from your computer instead:

1. enable Developer Options on the phone
2. enable USB debugging
3. connect the phone to the computer
4. run:

```powershell
adb devices
adb install -r C:\path\to\your-app.apk
```

`-r` reinstalls over an existing app if it is already installed.

## Notes

- APK is for testing and direct installation.
- APK is not for Play Store upload.
- For Play Store release, use the `production` profile, which creates an Android App Bundle (`.aab`).
