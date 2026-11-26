# Signing and notarizing Silt

Signed **and** notarized builds open with a normal double-click: no Gatekeeper warning, no “Open Anyway”. The release workflow does both automatically once five repository secrets exist. Without them it still builds, just unsigned.

You need an [Apple Developer Program](https://developer.apple.com/programs/) membership.

## 1. Export your Developer ID certificate

1. Open **Keychain Access** → *login* keychain → **My Certificates**.
2. Find **Developer ID Application: …** (expand it to make sure the private key is underneath).
   No certificate yet? Create one in Xcode › Settings › Accounts › *your team* › Manage Certificates › **+** › Developer ID Application.
3. Right-click it → **Export…** → save as `developer-id.p12` and choose a strong export password.

## 2. Create an App Store Connect API key (for notarization)

1. Go to [App Store Connect › Users and Access › Integrations › App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api).
2. Under **Team Keys**, click **+**, name it “Silt notarization”, access **Developer**.
3. Download the `AuthKey_XXXXXXXXXX.p8` file (it can only be downloaded once) and note the **Key ID** and the **Issuer ID** shown above the table.

## 3. Add the secrets to GitHub

Run these from Terminal (with the [GitHub CLI](https://cli.github.com) signed in). Values are read from files or typed at a hidden prompt, so they never end up in your shell history:

```bash
base64 -i ~/Downloads/developer-id.p12 | gh secret set MAC_CERT_P12_BASE64 -R thestealthgoat/Mac-cleaning
gh secret set MAC_CERT_PASSWORD -R thestealthgoat/Mac-cleaning          # paste the .p12 export password
gh secret set APPLE_API_KEY_P8 -R thestealthgoat/Mac-cleaning < ~/Downloads/AuthKey_XXXXXXXXXX.p8
gh secret set APPLE_API_KEY_ID -R thestealthgoat/Mac-cleaning           # paste the Key ID
gh secret set APPLE_API_ISSUER -R thestealthgoat/Mac-cleaning           # paste the Issuer ID
```

Then delete the exported `.p12` from Downloads (the original stays in your keychain) and keep the `.p8` somewhere safe.

| Secret | What it is |
| --- | --- |
| `MAC_CERT_P12_BASE64` | Developer ID certificate + private key, base64-encoded `.p12` |
| `MAC_CERT_PASSWORD` | The `.p12` export password |
| `APPLE_API_KEY_P8` | Contents of the `AuthKey_….p8` file |
| `APPLE_API_KEY_ID` | API key ID |
| `APPLE_API_ISSUER` | API issuer ID |

## 4. Test the setup

Run **Actions › Check signing setup › Run workflow** (or `gh workflow run check-signing.yml -R thestealthgoat/Mac-cleaning`). In about a minute it checks that the certificate opens with its password, that it holds a Developer ID identity, and that Apple accepts the API key. It only prints pass/fail, never the values.

## 5. Release

Push a version tag (`git tag -a v0.1.2 -m "…" && git push origin v0.1.2`). The workflow signs both architectures, sends them to Apple for notarization (usually a few minutes), staples the ticket, checks the result with `codesign`, `stapler` and `spctl`, and attaches the DMGs and zips to a draft release.

## Signing locally

`npm run dist` signs with the Developer ID certificate in your keychain automatically. To notarize locally too, export the same three API values first:

```bash
export APPLE_API_KEY=~/keys/AuthKey_XXXXXXXXXX.p8 APPLE_API_KEY_ID=XXXXXXXXXX APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
npm run dist -- -c.directories.output=/tmp/silt-dist
```

Build into a folder **outside** iCloud-synced locations such as Desktop or Documents. Those folders attach extended attributes that make `codesign` fail with *“resource fork, Finder information, or similar detritus not allowed”*.

`npm run dist:unsigned` builds without signing or notarizing.

## What signing changes for the app

- The hardened runtime is on, with the entitlements in [`build/entitlements.mac.plist`](../build/entitlements.mac.plist): JIT for Electron, and Apple Events so Silt can open Terminal for cleanup commands and ask Finder to empty the Trash. macOS asks the user the first time Silt does either.
- The certificate holder’s name, as registered with Apple, is shown to anyone who inspects the app’s signature.
