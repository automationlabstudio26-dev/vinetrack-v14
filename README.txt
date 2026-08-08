VineTrack Beta v16 — Amazon Sign-In + Chrome Sync
==================================================

WHAT CHANGED IN V16
-------------------
VineTrack no longer presents a separate Register/Create Account experience.
The primary sign-in flow is now:

  Continue with Amazon -> Amazon confirms identity -> VineTrack opens

Use the same Amazon account that the reviewer uses for Amazon Vine.
VineTrack never receives or stores the Amazon password.

IMPORTANT DISTINCTION
---------------------
Login with Amazon authenticates the person's Amazon identity. It does not by itself
import Vine orders, review status or evaluation data. Vine item sync remains a separate,
explicit action through the VineTrack Sync Chrome extension.

CUSTOMER FLOW
-------------
1. Open VineTrack.
2. Click Continue with Amazon.
3. Sign in/approve on Amazon.
4. VineTrack creates or links the VineTrack account automatically.
5. Install/connect VineTrack Sync once.
6. Open Amazon Vine.
7. Click Sync My Vine Items.
8. Continue the review workflow in VineTrack.

EXISTING V15 USERS
------------------
If an earlier VineTrack account used the same email address returned by Amazon,
V16 links that account to the Amazon identity instead of creating a duplicate.
The old password-login API remains server-side for compatibility, but no password
registration/login form is shown in the normal customer UI.

RAILWAY VARIABLES — EXISTING
----------------------------
VINETRACK_DB_FILE=/data/vinetrack.db
VINETRACK_FEEDBACK_FILE=/data/feedback.jsonl
VINETRACK_ADMIN_KEY=<your private admin key>

RAILWAY VARIABLES — NEW FOR V16
-------------------------------
VINETRACK_AMAZON_CLIENT_ID=<Login with Amazon client ID>
VINETRACK_AMAZON_CLIENT_SECRET=<Login with Amazon client secret>
VINETRACK_AMAZON_REDIRECT_URI=https://YOUR-LIVE-DOMAIN/auth/amazon/callback

The redirect URI must match the Return URL configured for the Login with Amazon app.
Keep the client secret only in Railway variables. Do not put it in GitHub or browser code.

CHROME WEB STORE VARIABLES — AFTER PUBLICATION
----------------------------------------------
VINETRACK_CHROME_STORE_URL=https://chromewebstore.google.com/detail/<your-listing>
VINETRACK_EXTENSION_IDS=<32-character Chrome extension ID>

PERSISTENT STORAGE
------------------
Railway volume mount:
  /data

CHROME EXTENSION FILE
---------------------
Chrome Web Store upload package:
  VineTrack_Sync_Chrome_Extension_v16_Store.zip

Extension source:
  chrome_extension_v16/

BETA DATA MODEL
---------------
Account identity, sessions, extension authorization and sync inbox are server-side.
Product/testing/review records remain browser-local during this beta.

SECURITY / REVIEW INTEGRITY
---------------------------
- Amazon password is handled by Amazon, not VineTrack.
- OAuth state is short-lived and single-use.
- VineTrack requests the basic Amazon profile scope for account identity.
- Vine item details are synced only when the user explicitly clicks Sync.
- No background Amazon scraping is included.
- No automatic review submission is included.
- No automatic star rating selection is included.
