# Setting up sync (one-time, ~5 minutes)

The app uses a free Firebase (Google) database to sync your data between
devices. It costs nothing for personal use and doesn't need a credit card.

## 1. Create a Firebase project
1. Go to https://console.firebase.google.com and sign in with any Google account.
2. Click **Add project**, give it any name (e.g. "daily-ledger"), and create it.
   You can turn off Google Analytics — it isn't needed.

## 2. Create a Firestore database
1. In the left sidebar: **Build → Firestore Database → Create database**.
2. Pick a location close to you.
3. Choose **Start in production mode** (we'll set our own rule in step 3).

## 3. Set the security rule
Firebase's default rules would either block everything or expose everything
temporarily. This app doesn't use accounts/passwords — instead your private
"sync code" acts as the shared secret, so set this rule:

1. In Firestore, open the **Rules** tab.
2. Replace the contents with:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /ledger-sync/{code} {
         allow read, write: if true;
       }
     }
   }
   ```
3. Click **Publish**.

   This means anyone who knows your exact sync code could read or change
   that data — so pick something long and hard to guess (e.g.
   "willow-forty-drumkit-92"), and don't share it. It is NOT a password
   in the login sense, just a private address for your data.

## 4. Register a web app and get your config
1. Go back to **Project Overview** (the little house icon).
2. Click the **</>** (web) icon to add a web app.
3. Give it any nickname, click **Register app**. Skip the hosting step.
4. You'll see a `firebaseConfig` object like:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "daily-ledger-xxxx.firebaseapp.com",
     projectId: "daily-ledger-xxxx",
     storageBucket: "daily-ledger-xxxx.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef"
   };
   ```

## 5. Paste it into the app
1. Open `firebase-config.js` in the app folder (a plain text file).
2. Replace each `"REPLACE_ME..."` value with the matching value from step 4.
3. Save the file.

## 6. Re-deploy
If you're hosting via Netlify Drop, GitHub Pages, or Vercel, re-upload/redeploy
the whole folder so the updated `firebase-config.js` goes live.

## 7. Turn on sync in the app
1. Open the app (on either device).
2. Tap **Set up sync** in the top-right corner.
3. Type any private code you like — this is what links your devices together.
4. On your other device, open the app and tap **Set up sync**, then enter the
   **exact same code**.

Both devices will now stay in sync automatically, including while offline —
changes sync as soon as you're back online. The badge in the header shows
"Syncing…", "✓ Synced", or "⚠ Offline" so you always know the state.

## Notes
- Free tier limits (Spark plan) are roughly 50,000 reads and 20,000 writes a
  day — far more than personal habit-tracking will ever use.
- If you ever want to stop syncing, tap the badge and clear the code, or just
  don't set one — the app keeps working fine locally either way.
