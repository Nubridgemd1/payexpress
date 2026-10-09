# PayExpress — Web App & App-Store Publishing

PayExpress is now an installable **PWA (Progressive Web App)** served from **https://payexpress.org**.
It can be installed directly from the browser, and packaged into native apps for the
**Apple App Store** and **Google Play** using the same live site.

## What's in the repo for this

| File | Purpose |
|---|---|
| `manifest.webmanifest` | App metadata — name, icons, colours, screenshots, shortcuts, standalone display |
| `sw.js` | Service worker — caches the app shell so it loads offline and is installable |
| `icons/` | App icons (192, 512 — `any maskable`), `apple-touch-icon` (180), `favicon-32` |
| `screenshots/` | Store/`install` screenshots (2 mobile, 1 desktop) |
| `.well-known/assetlinks.json` | Android Digital Asset Links (needed for the Play TWA — add your signing fingerprint) |

Installed behaviour: opens standalone (no browser chrome), navy theme, works offline for the
app shell. An **"Install PayExpress"** button appears automatically on Android/desktop Chromium;
on iPhone/iPad users install via **Share → Add to Home Screen**.

---

## Easiest path to BOTH stores — PWABuilder (recommended)

1. Go to **https://www.pwabuilder.com** and enter **https://payexpress.org**.
2. It audits the PWA (manifest, service worker, icons) — all green here.
3. **Google Play (Android TWA):**
   - Click **Package → Android**. Keep package id **`org.payexpress.twa`** (matches `assetlinks.json`).
   - Download the package. PWABuilder shows the **SHA-256 signing fingerprint** of the generated key
     (or use your own Play App Signing key fingerprint).
   - Paste that fingerprint into **`.well-known/assetlinks.json`** (replace
     `REPLACE_WITH_YOUR_APP_SIGNING_SHA256_FINGERPRINT`), commit, and let it deploy — this verifies the
     app owns the domain and hides the browser address bar.
   - Upload the `.aab` to the **Play Console**, fill the listing (use the `screenshots/`), submit.
4. **Apple App Store (iOS):**
   - Click **Package → iOS**. Download the Xcode project.
   - Open in **Xcode** on a Mac, set your **Team / Bundle ID** (e.g. `org.payexpress.app`),
     archive, and upload to **App Store Connect**.
   - Complete the listing (screenshots, privacy) and submit for review.

> Apple review note (Guideline 4.2 "minimum functionality"): a pure website wrapper can be rejected.
> PayExpress qualifies because it provides substantial app functionality — multi-country transfers,
> live FX, card services, recipient management and KYC — not just a bookmark. Make sure the first
> screen shows real functionality (it does).

## Alternative — Android only, command line (Bubblewrap)

```
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://payexpress.org/manifest.webmanifest
bubblewrap build
```
Then publish the resulting `.aab` and add the key's SHA-256 to `assetlinks.json`.

---

## Before you submit (checklist)
- [ ] Site served over **HTTPS** (GitHub Pages → enforce HTTPS).
- [ ] `assetlinks.json` contains your **real** signing SHA-256 (Android).
- [ ] App icon, name and screenshots approved.
- [ ] Privacy policy URL ready (required by both stores for a finance app).
- [ ] Money-movement backend connected and KYC/AML live before real transactions
      (the app stays in review/processing mode until the backend endpoints are set in Admin → Go-live).

*PayExpress · a BizFormCorp product · sponsored by Heritage Hub FCU.*
