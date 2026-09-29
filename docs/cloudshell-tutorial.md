# Install Flack on your Firebase project

<walkthrough-tutorial-duration duration="15"></walkthrough-tutorial-duration>

Flack is team chat that runs entirely on **your own** Firebase project. This walkthrough
creates (or reuses) a project, turns on the services it needs and deploys the app.

**Costs.** Flack needs Firebase's **Blaze** plan, which is pay-as-you-go: you only pay for
what you use beyond generous free quotas. A team of 10–100 people normally stays at or near
**$0/month**. The installer sets a budget alert (default US$5/month) so you're emailed long
before anything unexpected. You need a billing account; Google may offer free-trial credit
when you create one.

Click **Start** to begin.

## Use Node.js 22

Flack's tools need Node.js 22. Cloud Shell has `nvm`, so this takes a few seconds:

```sh
nvm install 22 && nvm use 22
```

## Run the installer

```sh
npm run setup
```

It asks four things:

1. **A project id.** Accept the suggestion to create a new project, or type an existing one.
2. **A region.** `us-central1` is a good default; `europe-west1` for the EU.
3. **Your Google account email.** That account becomes the first admin.
4. **A monthly budget alert** in US dollars.

Then it links billing (you pick the account), turns on the services, writes the app config
and deploys. The first deploy takes 5–10 minutes.

## Turn on Google sign-in

This is the one step Google doesn't let scripts do. The installer prints a link like this:

`https://console.firebase.google.com/project/<your-project>/authentication/providers`

Open it, choose **Add new provider → Google → Enable**, pick a support email and **Save**.

## Sign in

Open `https://<your-project>.web.app` and sign in with the email you gave the installer.
You're the admin: go to **Admin → Invite people** to add your team.

On phones, use **Add to Home Screen** (iPhone) or **Install app** (Android) to get
notifications like a native app.

## Done

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>

To update later, pull the latest code and run `npm run deploy` (it runs the full test suite
first) or `scripts/deploy.sh` to deploy right away.
