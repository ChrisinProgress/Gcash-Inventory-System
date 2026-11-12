# GCash Ledger

GCash Ledger tracks manually recorded cash-ins, cash-outs, balances, and service charges. The hosted app uses Firebase Authentication and Cloud Firestore. It does not connect to a real GCash wallet or move money.

## Open the offline ledger

Open the **`index.html` in the project folder** in Microsoft Edge and select **Open offline ledger**. The file includes the app and its fonts and works offline. Use **Cash & Wallet Balances → Opening balances** to enter your starting funds for a new ledger.

Reopen the same file path in the same browser profile to keep using that ledger. Local storage availability for `file:` URLs varies by browser.

Use **Settings → Clear local data** to reset this browser’s ledger. Export any records you want to keep from **Transaction History** before clearing. The offline ledger and Firebase accounts use separate storage. For one account across local development and GitHub Pages, use the hosted app on both and connect it to the same Firebase project.

After editing the app source, rebuild the standalone file from the project root with `node scripts/build-offline.mjs`. Node and the build dependency are needed only to regenerate the file.

## Run locally with Firebase emulators

Install the [Firebase CLI](https://firebase.google.com/docs/cli#install_the_firebase_cli) and a JDK supported by the [Firebase Emulator Suite](https://firebase.google.com/docs/emulator-suite/install_and_configure). From this directory, run:

```sh
firebase emulators:start --project demo-gcash-ledger --only auth,firestore,hosting
```

Open `http://127.0.0.1:5000/?emulator=1`. Create a test account, then open **Cash & Wallet Balances → Opening balances** to enter starting cash and wallet funds. Emulator data stays local. The Auth emulator prints password reset links in the terminal instead of sending email. To keep emulator data between runs, start with `--import=./emulator-data --export-on-exit=./emulator-data` once the import directory exists, or use `--export-on-exit=./emulator-data` for the first run.

Without `?emulator=1`, the web app uses the configured Firebase project. If the configuration is missing, the sign-in screen prompts for setup before account access is enabled.

## Connect a Firebase project

1. Create or select a project in the [Firebase console](https://console.firebase.google.com/). In **Project settings**, register a [Firebase web app](https://firebase.google.com/docs/web/setup#register-app) and copy its configuration into `public/js/firebase-config.js`. The browser configuration is public. Keep service-account keys outside the project files.
2. Enable **Email/Password** under **Authentication → Sign-in method**. Configure the password reset email template if needed. Under **Authentication → Settings → Authorized domains**, add your hosting domain and any local domain used for testing the production project. [Firebase password authentication](https://firebase.google.com/docs/auth/web/password-auth)
3. Create the default Firestore database in production mode. Deploy the supplied rules before inviting users to register. [Firestore security rules](https://firebase.google.com/docs/firestore/security/get-started)

```sh
firebase login
firebase deploy --project YOUR_PROJECT_ID --only firestore:rules
```

To test the configured app against that project before publishing, run `firebase emulators:start --project YOUR_PROJECT_ID --only hosting` and open `http://127.0.0.1:5000/`. Use disposable test records if you are testing against a live database.

## Deploy to GitHub Pages

1. Complete Firebase setup above and deploy the Firestore rules. In Firebase Authentication, add the hostname of your Pages site to **Authorized domains**. For `https://USERNAME.github.io/REPOSITORY/`, enter `USERNAME.github.io`.
2. Push this folder to your GitHub repository, including `public/js/firebase-config.js` with your Firebase web app configuration. In **Settings → Pages**, set **Source** to **GitHub Actions**. The included workflow checks that the Firebase config is present before publishing `public/` from the default branch. If Pages was enabled after the first push, open **Actions → Deploy to GitHub Pages** and run the workflow from the default branch. [GitHub Pages publishing setup](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
3. Open the Pages URL and sign in with the same Firebase account you used locally. GitHub Pages publishes the app files. Transactions, balances, and settings stay in Firestore under your account ID, so subsequent deployments keep them when you continue using the same Firebase project and account.

If you select **Deploy from a branch** instead, choose the default branch and **`/(root)`**. The root `index.html` forwards hosted requests to the sign-in app under `public/`.

## Deploy to Firebase Hosting or another static host

For [Firebase Hosting](https://firebase.google.com/docs/hosting/quickstart), deploy both Hosting and the rules from the project directory:

```sh
firebase deploy --project YOUR_PROJECT_ID --only firestore:rules,hosting
```

For another static host, publish the contents of `public/` with no build step. Deploy `firestore.rules` to Firebase separately and authorize your hosting domain in Firebase Authentication. Routes use URL hashes, so the static host only needs to serve `index.html` and its assets.

## Ledger behavior

- In Firebase mode, each account sees only its own data. Firebase keeps the sign-in session, and Firestore delivers saved changes to other devices signed in to the same account.
- All amounts use integer centavos. The supplied tiers apply to both transaction types. A centavo above a tier ceiling uses the next fee. The first valid amount is ₱1.00 and the last is ₱11,000.00. Owners can edit fees in the supplied tiers.
- Each confirmed transaction automatically updates cash on hand and the tracked GCash wallet. Cash-in adds principal plus the fee to cash and deducts principal from the wallet. Cash-out adds principal to the wallet and deducts the cash payout. With a separate cash-out fee, the ledger also adds the fee collected in cash.
- The transaction form defaults to today's date in Asia/Manila. Select a different date before confirming when needed. History, receipts, and reports use the selected date. Older records use their original Manila date. Reasons are optional on balance changes, corrections, and voids. Corrections keep the same transaction ID, and the audit trail retains previous values. Voids reverse the transaction and exclude it from reports. If later activity used the funds, the reversal can expose a negative balance.
- Firestore transactions keep ledger updates atomic. Confirmation uses an idempotent request ID, and optional references must be unique within an account, ignoring case. Balance adjustments and transaction revisions keep their recorded reasons.
- Report periods use Asia/Manila. Weekly reports start on Monday. Reports count completed transactions and treat collected service charges as gross profit.
- Poppins is bundled for the app and printed receipts. See `public/fonts/OFL` for its license.
