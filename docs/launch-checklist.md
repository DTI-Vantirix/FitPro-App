# VantraRun launch checklist

Everything the code needs to go live is in the repository. What is left are the
account actions only the owner can take: they cost money, register a permanent
name, or need your sign-in. They are in order; each says what to do and how to
tell it worked. Where it says "tell Claude", that is the point to hand back.

Nothing in this list has been done yet.

| # | Step | Needs | Roughly |
| - | ---- | ----- | ------- |
| 1 | Put the code on `main` | GitHub | 2 min |
| 2 | Email sending (Resend) | a domain you own | 20 min + DNS wait |
| 3 | Hosting (Render) | a card | 15 min |
| 4 | First sign-in and invite codes | the site from step 3 | 5 min |
| 5 | Android build | step 3 | 30 min |
| 6 | iPhone build | Apple developer account | 45 min |
| 7 | Google Maps key (Android map) | Google Cloud | 10 min |
| 8 | Optional: routing key, media bucket | | later |

---

## 1. Put the code on `main`

Two merges, in this order (or tell Claude to do both):

1. Pull request [#5](https://github.com/DTI-Vantirix/FitPro-App/pull/5) into `native-shell-wiring`. It holds
   the hosting files (`render.yaml`, `Dockerfile`); without it Render finds nothing to set up.
2. Pull request [#2](https://github.com/DTI-Vantirix/FitPro-App/pull/2) into `main`.

Render deploys whatever is on the branch you point it at, each time GitHub's checks pass.

## 2. Email sending

Sign-up emails a 6-digit code. Without an email provider **nobody can sign up on the
live site**; the server says so in its log at start-up.

1. Create an account at [resend.com](https://resend.com).
2. Add a sending domain you own (Domains → Add) and add the DNS records it shows at
   your domain registrar. Wait until Resend shows the domain as verified.
3. Create an API key (API Keys → Create). Copy it; it is shown once.
4. Decide the "from" address, for example `VantraRun <no-reply@yourdomain.com>`.

You will paste the key and the from address into Render in step 3.

Not checked from here: Resend's current free allowance, and whether it will send to
other people before a domain is verified. Check their site.

## 3. Hosting

The file `render.yaml` describes the whole hosted side: one web service (the API, which
also serves the website) and one Postgres database, both in Virginia.

1. Create an account at [render.com](https://render.com) and connect your GitHub account.
2. New → **Blueprint** → choose the repository `DTI-Vantirix/FitPro-App` and the branch from step 1.
3. Render asks for four values:

   | Asked for | What to enter |
   | --- | --- |
   | `RESEND_API_KEY` | the key from step 2 |
   | `MAIL_FROM` | the from address from step 2 |
   | `ADMIN_EMAIL` | your own email address |
   | `ADMIN_PASSWORD` | a new password of **12 or more characters** (shorter ones are ignored); you will remove it in step 4 |

4. Review the cost Render shows and apply. The plans in the file are the smallest paid
   ones: about **$13 a month** at the prices listed on 2026-11-25 (web $7, database $6,
   1 GB disk $0.25). Free plans are not used because free services sleep and the free
   database expires.
5. Wait for the first deploy to finish (a few minutes).

**It worked if** the service page shows "Live" and opening its address shows the
sign-in page. Note the address. The app builds assume
**`https://vantrarun.onrender.com`**; if Render gave you a different one (the name was
taken), tell Claude so `native/eas.json` is corrected before any build.

Backups: Render's pricing page lists point-in-time recovery for Postgres. Whether the
smallest plan includes it was not stated there. Check the database's "Recovery" tab
after it is created; if there is none, say so and a nightly export can be added.

## 4. First sign-in and invite codes

1. Open the site and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
   If it says the email or password is wrong, open Render → the service → Logs and look
   for a line starting `[admin]`: it says why no account was made (usually a password
   under 12 characters). Fix the value in Environment and the service restarts.
2. In Render → the service → Environment, **delete `ADMIN_PASSWORD`** and save. The
   account stays; the variable was only needed once. (Leaving it does no harm to your
   account, since it can never change an existing one, but a password should not sit in
   a settings page.)
3. Settings → change your password if you like, then create invite codes (Settings →
   Invite codes), one per tester.
4. Settings → Error reports should say "No errors recorded". This is where crashes from
   the phone app and unexpected server errors appear.
5. Create a test account in a private browser window with one of the codes, to confirm
   the 6-digit email arrives.

## 5. Android build

Claude can run these for you once step 3 is done; say "build Android". They use your
Expo account (already signed in on this computer) and create the app's signing key,
which Expo stores. The same key signs every later version.

```
cd native
npx eas-cli build --platform android --profile preview
```

This produces an install link for an APK. Open it on an Android phone to install
directly, no store needed. That is enough for the phone test list on the build board.

For Play internal testing (later, when you want testers to install from the store):

1. In [Play Console](https://play.google.com/console), create an app named VantraRun.
2. `npx eas-cli build --platform android --profile production` produces an `.aab`.
3. Upload it to Testing → Internal testing, add your testers' Google addresses, and send
   them the opt-in link. The first upload sets the package name to
   **`com.vantrarun.app`** permanently.
4. Play asks for a privacy policy address: `https://<your site>/privacy`. It also asks
   what data is collected: email, name, precise location (during runs), health and
   fitness data (runs, heart rate if a sensor is paired, and any workouts you choose
   to import from Health Connect), crash reports. Play may also ask you to declare why
   the app reads Health Connect and why it uses location while a run is recorded;
   whether it asks at the internal-testing stage was not confirmed. None is shared with other companies or used
   for advertising.

## 6. iPhone build

Needs your Apple ID in a terminal (Apple sends a code to your phone), so you run this
one yourself, or sit with Claude while it runs.

```
cd native
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production
```

The first build asks to sign in to Apple and offers to create the certificates and the
app identifier **`com.vantrarun.app`**; accept. This registers the identifier with
Apple permanently. `submit` uploads the build to App Store Connect and offers to
create the app record there (name: VantraRun).

Then in [App Store Connect](https://appstoreconnect.apple.com) → the app → TestFlight:
add your testers to an **internal** group (they must be added to your team under Users
and Access first). Internal testing needs no Apple review. Testers install the
TestFlight app and accept the invitation.

Apple will ask whether the app uses encryption: no (already declared). The location
question on the build page: the app uses location in the background to record a run.

## 7. Google Maps key (the map on Android)

iPhone uses Apple Maps and needs nothing. On Android the map shows a notice until the
build carries a Google Maps key.

1. In [Google Cloud Console](https://console.cloud.google.com), create a project, enable
   **Maps SDK for Android**, and create an API key.
2. Restrict the key to Android apps with the package `com.vantrarun.app` and **two**
   SHA-1 fingerprints, or the map stays blank for one kind of install:
   - the one shown by `npx eas-cli credentials` for the Android keystore (covers the
     APK installed straight from the build link);
   - once the app is in Play Console, the "App signing key certificate" SHA-1 under
     Test and release → App integrity (covers installs from the Play Store, which
     Google re-signs with its own key).
3. Give the key to the build (or tell Claude the key is ready):

   ```
   cd native
   npx eas-cli env:set --name GOOGLE_MAPS_ANDROID_KEY --value PASTE_THE_KEY_HERE --environment production --environment preview --visibility sensitive
   ```

4. Build Android again. The key is never written into the repository.

## 8. Optional, later

- **Routing.** Route snapping and turn directions use a public, best-effort map server.
  For something dependable, create a key at a hosted Valhalla provider (Stadia Maps is
  one) and set `ROUTER_URL` and `ROUTER_API_KEY` in Render → Environment. Nothing else
  changes. Not verified from here: that provider's exact address and free allowance.
- **Media bucket.** Photos attached to posts are kept on the service's disk, which is
  fine for testing. To move them to object storage (Cloudflare R2, Backblaze B2, AWS S3),
  set `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and
  `S3_REGION` in Render → Environment. `S3_REGION` is `auto` for Cloudflare R2; for AWS
  and Backblaze it must be the bucket's own region (for example `us-east-1`), or every
  upload is refused. Afterwards attach a photo to a post to confirm it works: nothing
  checks the bucket at start-up. Files already on the disk are not copied across, so
  do this before testers have uploaded anything.

---

## Decisions still yours

- **Who to name in the privacy policy.** The page at `/privacy` is now a full policy
  (what is collected, why, who sees it, the companies involved, no fixed retention
  period, how to delete). It names "the VantraRun team" and tells people to contact
  whoever invited them, because no company name or contact address has been given.
  Both stores also ask for a support contact. It has not been reviewed by a lawyer.

## After each step, what to check

| After | Check |
| --- | --- |
| 3 | `https://<site>/api/health` shows `{"ok":true}` |
| 4 | a test sign-up receives its 6-digit email |
| 5 / 6 | the app opens, signs in, and "Start a run" appears; then the phone test list on the build board |
| 7 | the map appears in "Free run with map" on Android |
