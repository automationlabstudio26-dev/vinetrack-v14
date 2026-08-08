VineTrack Beta v14 — Railway + Chrome Web Store Edition
========================================================

WHAT CHANGED IN V14
-------------------
V14 replaces the developer-mode Browser Companion flow with a Chrome Web Store-ready extension architecture.

End-user flow after the extension is published:
1. Click Get Chrome extension in VineTrack.
2. Click Add to Chrome in the Chrome Web Store.
3. Keep VineTrack open and click the VineTrack Sync extension once.
4. Click Connect VineTrack and approve the connection.
5. Open Amazon Vine Orders or Reviews.
6. Click Sync My Vine Items.
7. VineTrack opens and imports the synced batch automatically.

There is no manual VineTrack URL entry and no sync code for end users.

PRIVACY / SAFETY MODEL
----------------------
- VineTrack never asks for the Amazon password.
- The extension reads visible Vine item details only after the user clicks Sync.
- No background scraping is implemented.
- No automatic review submission is implemented.
- No automatic star rating selection is implemented.
- Imported Amazon status text remains reference-only.

SERVER-SIDE EXTENSION AUTH
--------------------------
- Chrome uses chrome.identity.launchWebAuthFlow.
- The user signs in to VineTrack normally if needed.
- The user explicitly approves the extension connection.
- VineTrack returns a high-entropy extension token to Chrome's chromiumapp.org redirect URL.
- Only a SHA-256 hash of the token is stored server-side.
- Connections can be revoked from VineTrack or from the extension.
- The old v13 sync-code API remains server-side only for backward compatibility, but it is removed from the v14 UI.

CHROME WEB STORE FILE
---------------------
Use this ZIP for Chrome Web Store submission:
  VineTrack_Sync_Chrome_Extension_v14_Store.zip

The extension source is also included in:
  chrome_extension_v14/

AFTER GOOGLE ASSIGNS THE EXTENSION ID AND LISTING URL
-----------------------------------------------------
Add these Railway variables:
  VINETRACK_CHROME_STORE_URL=https://chromewebstore.google.com/detail/<your-listing>
  VINETRACK_EXTENSION_IDS=<32-character Chrome extension ID>

Then redeploy VineTrack.

VINETRACK_EXTENSION_IDS is deliberately optional during development. Once the Web Store assigns the real ID, setting it locks the connection endpoint to the published extension.

Existing Railway variables remain:
  VINETRACK_DB_FILE=/data/vinetrack.db
  VINETRACK_FEEDBACK_FILE=/data/feedback.jsonl
  VINETRACK_ADMIN_KEY=<private admin key>

Persistent Railway volume mount:
  /data

RAILWAY
-------
The repository root used by Railway must contain Dockerfile and server.py. If the GitHub repo contains this package inside a folder, set Railway Root Directory to that folder.

Run command is already handled by Dockerfile/Procfile.

IMPORTANT BETA LIMITATION
-------------------------
VineTrack accounts and extension authorization are server-side, but product/testing/review records remain browser-local in Beta v14. Therefore the extension opens VineTrack in the same Chrome profile after a sync so the pending batch can be imported into that browser-local workspace.

BACKUPS
-------
- backups_v13_before_v14: v13 source before this upgrade
- backups_v12_before_sync: v12 source before Amazon Sync
- backups_v11_before_auth: v11 source before login/account work
- backups_v10: original v10 backups
