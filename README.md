# SLC Venue Inspection – Android app

Curators record day-by-day pitch preparation for Sri Lanka Cricket domestic tournament matches.
The app produces the official **Venue Inspection Report** (your Word template, unchanged layout)
and saves everything to **Google Drive**. Built entirely by GitHub – no Node.js, no Expo, nothing
to install on your computer.

```
.github/workflows/build-apk.yml   GitHub builds the Android .apk automatically
android/                          The Android app (Java + the app screens in assets/www)
backend/                          Google Apps Script: logins, Google Drive storage, Word report
```

## Setup in short

1. **Backend:** create a Google Sheet → Extensions → Apps Script → paste the four files from
   `backend/` → run `setup` → Deploy as **Web app** (Execute as *Me*, access *Anyone*) → copy the `/exec` URL.
2. **GitHub:** create a repository, upload this folder, then add a repository **variable**
   `API_URL` = the web app URL (Settings → Secrets and variables → Actions → Variables).
3. **Build:** Actions → *Build Android APK* → *Run workflow*. After ~5–10 minutes the APK is in
   **Releases**. Public repository download link for curators:
   `https://github.com/<you>/<repo>/releases/latest/download/SLC-Venue-Inspection.apk`
4. **Curators:** add names + passwords in the sheet's *Curators* tab, then menu
   *SLC Venue Inspection → Secure new curator passwords*.

Every later upload to the repository builds a new version automatically; installing it updates
the app and keeps the data on the phone.

## Notes
- The signing key `android/app/slc-release.jks` is kept in the repository so every build can
  update the previous one. Don't delete or replace it, or curators will have to uninstall once.
- The app is for direct installation (not Google Play).
- The full step-by-step guide is in the shared "SLC Venue Inspection App – Setup Guide" doc.
