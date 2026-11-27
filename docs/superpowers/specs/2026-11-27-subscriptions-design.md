# VantraRun subscriptions: design

Date: 2026-11-27. Status: awaiting the owner's approval.

## Intent

VantraRun becomes a paid service. The app is free to download and anyone can create
an account, but the product itself opens only for people with access: a paid
subscription, or a free pass from the owner. Most people should pay on the website,
where no store takes a cut; the app also sells the same subscription through Apple,
because App Store review expects it.

## What the owner decided

- Sold in the United States only to start.
- Sold both on the website and in the app.
- Price: $4.99 a month, $49.99 a year.
- Flow: download, create an account, then hit a paywall.
- The paywall has an "I have an invite code" option at the bottom, so the owner can
  let people in for free.
- Testers are invited with no purchase flow at all.
- A 7-day free trial on both plans, with automatic billing when the trial ends.
- Monthly: not refundable once charged. It can be cancelled at any time, and access
  continues until the end of the month already paid for.
- Annual: refundable for 14 days after the trial ends and the annual charge is made.

## Goals

1. A person can sign up without an invite code, on the website or in the app.
2. After signing in, a person without access sees one paywall and nothing else of the
   product. They can still read the privacy policy, sign out and delete their account.
3. Paying on the website (Stripe) or in the app (Apple) unlocks the same account
   everywhere, within seconds.
4. An invite code from the owner unlocks an account for free, with no payment details.
5. The owner can see who has access and why (paid on web, paid in app, invite code,
   granted by hand), and can grant or remove free access by email.
6. Access is enforced on the server, not only hidden in the screens.
7. Existing testers and accounts keep working through the change with no action.

## Non-goals (first version)

- Android in-app billing. There is no Android build yet and Google's rules differ.
  The Android app, when built, shows the paywall with the website option and invite
  code only, until Play billing is designed.
- Countries other than the US. Apple allows links to web checkout only on the US
  storefront; the app is listed in the US only.
- Promo codes, family plans, team plans.
- A self-service refund button. In the first version the owner issues an annual refund
  from Stripe's dashboard and the server reacts to it.
- A free tier with limited features.

## Anti-goals

- A person who paid being locked out because a webhook was late or missed.
- Anyone reaching another person's data, or the paid features, by calling the API
  directly without access.
- A tester or a comped person ever being asked for a card.
- Payment data, card numbers or Apple receipts stored in our database beyond the
  identifiers needed to check status.
- A third-party service that sees our users' purchases or activity, beyond the two
  payment providers themselves.

## Constraints

- **Apple, guideline 3.1.3(b):** an app may unlock a subscription bought on the web
  provided the same subscription is also offered as an in-app purchase. So the app
  must sell it too.
- **Apple, 3.1.1(a) and 3.1.3:** on the US storefront the app may show a button or
  link to the website checkout. Not allowed on other storefronts.
- **Apple, 3.1.2:** the paywall must show the price, the period, that it renews
  automatically, and links to the terms and the privacy policy; "Restore purchases"
  must exist.
- **Apple, 5.1.1(v):** account deletion must be reachable inside the app, including
  for someone who has not paid.
- The guideline text was read through a summary of Apple's page dated 16 October 2026;
  the exact wording is to be re-checked before the public submission.
- Project rules: no third-party analytics; new numbered migrations only; a column and
  its entity property change together; access-rule changes need tests; secrets never
  committed.
- TestFlight internal testing has no review, so none of this blocks testers.

## Approaches considered

**How the app's Apple purchases are handled**

1. **Direct with Apple (chosen).** The app uses StoreKit through one in-app-purchase
   library; the server verifies Apple's signed transactions itself and listens to
   Apple's server notifications. No extra company in the path, which fits the
   no-third-party rule. More code and more to test.
2. **A subscription service such as RevenueCat.** Much less code, a dashboard, and
   Stripe plus Apple unified for us. Rejected: it is a third party that sees every
   purchase and a user identifier, and adds a monthly cost as revenue grows.
3. **No in-app purchase, website only.** Rejected: a likely App Store rejection.

**Where access is decided**

1. **One "entitlement" record per account on the server (chosen).** Every source of
   access (Stripe, Apple, invite code, admin grant) writes to the same place; one
   function answers "does this account have access, and until when". Screens and API
   both ask that function.
2. Ask Stripe or Apple live on each request. Rejected: slow, and an outage at either
   locks everyone out.

## Design

### Access model

A new table `entitlements`, one row per source of access per account:

| Field | Meaning |
| --- | --- |
| `user_id` | the account |
| `source` | `stripe`, `apple`, `invite`, `admin` |
| `status` | `trial`, `active`, `grace` (payment retrying), `expired`, `revoked` |
| `cancel_at_period_end` | the person has cancelled; access runs to `expires_at` |
| `trial_used` (on the account) | this account has had its one free trial |
| `plan` | `monthly`, `annual`, or empty for free passes |
| `expires_at` | end of the paid period; empty for free passes |
| `external_id` | Stripe subscription id or Apple original transaction id |
| `granted_by` | admin who granted it, or the invite code used |

An account **has access** when its role is admin, or it has any row that is `trial`,
`active` or `grace` and not past `expires_at` plus a short allowance (a few days, so a late
renewal notice never locks out a payer).

The existing `access_grants` rows (invite codes already redeemed) are carried over as
`invite` entitlements by the migration, so today's testers keep access untouched.

### Server

- **Sign-up no longer needs an invite code.** The code field becomes optional: a code
  given at sign-up is still claimed on verification, as now.
- **`hasAccess` becomes the single check** and is applied to the entity API and to
  every function except the ones a person without access needs: account, sign-out,
  delete account, invite-code redemption, subscription status and checkout, privacy.
  Today only run upload is gated on the server; this closes that gap.
- **Stripe:** a function creates a Checkout session for the chosen plan (with the
  7-day trial when the account has not had one) and returns
  its address; a webhook endpoint (signature verified) updates the entitlement on
  purchase, renewal, payment failure, cancellation and refund; a function returns a
  link to Stripe's customer portal for managing or cancelling.
- **Apple:** a function accepts the signed transaction from the app, verifies it
  against Apple's keys, and records the entitlement; an endpoint receives App Store
  Server Notifications (version 2) for renewals, failures, refunds and expiry.
- **One account, two stores:** if an account already has an active paid entitlement
  from one source, the other source's purchase button is replaced by "You're
  subscribed" with the right manage link, to prevent paying twice.
- **Admin:** list of accounts with their access and its source; grant free access by
  email; revoke a free pass; the existing invite-code screen stays.

### Website

- Sign-up: the invite code field moves out of the required path (kept as an optional
  "Have an invite code?" line).
- The current "Invite only" gate becomes the **paywall**: what VantraRun does, the two
  plans with the annual saving shown, "Subscribe", and at the bottom "I have an invite
  code". After Stripe returns, the page waits for the entitlement and opens the app.
- Settings gains a "Subscription" card: plan, renewal date, "Manage subscription".
- New public pages: Terms of use; the privacy policy is updated to name Stripe and
  Apple as payment providers.

### Phone app (iOS)

- Sign-up without a code; the existing invite screen becomes the paywall with the same
  content: plans, "Subscribe on the website" (opens the browser), "Subscribe in the
  app" (Apple's purchase sheet), "Restore purchases", "I have an invite code", terms
  and privacy links, sign out, and delete account.
- After a purchase in either place, the app re-checks access when it returns to the
  foreground and opens.
- Settings gains the same "Subscription" card; "Manage" opens Stripe's portal or
  Apple's subscription settings, depending on where they paid.

### Prices

| | Website | In the app |
| --- | --- | --- |
| Monthly | $4.99 | $5.99 |
| Annual | $49.99 | $59.99 |

The in-app prices are a proposal, not the owner's decision: they cover Apple's cut so
the website stays the better deal. The owner may set them equal to the website's.

### Free trial

- Both plans start with 7 days free. A payment method is required to start the trial
  (a card on the website, the Apple ID in the app), and the first charge happens
  automatically when the trial ends unless the person cancels before then.
- During the trial the account has full access. Cancelling during the trial ends
  access when the 7 days are up and nothing is charged.
- One trial per person. On the website the server refuses a second trial to an account
  that has already had one on either platform (the checkout then starts paid at once).
  In the app, Apple allows one introductory trial per Apple ID; the server cannot stop
  a person who used a website trial from also being offered Apple's, so the app hides
  the trial wording and the in-app purchase button's trial claim for such accounts
  where Apple's eligibility check allows it. Residual double trials are accepted as a
  small, known leak.
- The paywall states the terms before the purchase button: "7 days free, then $4.99 a
  month" (or "$49.99 a year"), that it renews automatically, and how to cancel.
- A reminder email is sent two days before the trial ends, saying when and how much
  will be charged and how to cancel. (Several US states require clear renewal terms
  and easy online cancellation; this is good practice in any case.)

### Cancelling and refunds

| | Website (Stripe) | In the app (Apple) |
| --- | --- | --- |
| Cancel | Any time from Settings, in two taps. Access continues to the end of the period paid for; no further charge. | Any time in the phone's subscription settings; same effect. |
| Monthly refund | None once charged. | Apple decides refund requests itself; we cannot grant or refuse them. |
| Annual refund | In full, on request within 14 days of the annual charge. Access ends when the refund is made. | As above: Apple decides. |

- The refund terms are the owner's policy for website purchases and are written into
  the Terms of use and shown on the website's paywall. For purchases made in the app
  Apple's own refund process applies, and the Terms say so.
- Whoever refunds (the owner in Stripe, or Apple), the server receives the notice and
  ends that entitlement at once.
- A cancelled subscription shows in Settings as "Ends on <date>" with a "Resume"
  option until that date.

### Switching it on

Built behind a server setting `SUBSCRIPTIONS=off|on`. While it is off, sign-up still
needs an invite code exactly as today. Turning it on opens sign-up and shows the
paywall. Stripe and Apple both have test modes; the whole flow is tested there before
the switch is turned on for the live site.

## What the owner must set up (cannot be done from here)

1. A Stripe account for the company; two prices created; the keys and webhook secret
   entered in Render. Stripe's trial-ending reminder email switched on.
2. In App Store Connect: the Paid Apps agreement, banking and tax forms; a subscription
   group with the two products, each with a 7-day free introductory offer; the App Store Server API key and the server
   notification address entered.
3. Enrolment in Apple's Small Business Program if eligible (lowers Apple's cut).
4. Terms of use reviewed (including the trial, renewal, cancellation and refund terms),
   and the privacy policy change reviewed.
5. A support address people can write to for an annual refund (proposed:
   info@dtisys.com, already named in the privacy policy).

## Left to the builder

- The in-app-purchase library, chosen for Expo SDK 58 and StoreKit 2 support.
- Exact screen copy within the brand's voice rules.
- Table and column names beyond those above.
- The length of the renewal allowance (proposed: 3 days).

## Open risks

- Apple's reviewers have rejected web-subscription apps even when the rules appear to
  allow them; offering the in-app purchase is the mitigation, not a guarantee.
- Whether Apple takes any commission on US link-out sales is unsettled in court as of
  mid-2026.
- A person could pay in both places before the second button is hidden; the server
  keeps both entitlements and the admin screen shows it, and one is refunded by hand.
