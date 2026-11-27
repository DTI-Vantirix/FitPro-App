// OWNER: this page needs a lawyer's review before SUBSCRIPTIONS is turned on for the
// live site (docs/launch-checklist.md, "Decisions still yours"). The sentences about
// price, trial, renewal, cancelling and refunds state what the product does and must
// stay in step with web/src/lib/plans.js and the paywall. "Liability" and "Governing
// law" are placeholders in plain words: the lawyer names the state and settles the wording.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { TERMS_UPDATED } from '@/lib/consent';

const SECTIONS = [
  {
    title: 'The service',
    body: [
      'VantraRun is a run coach: it records your runs, coaches each one against your own five training zones, and keeps your routes, history and challenges. It is a phone app and a website sharing one account.',
      'VantraRun is run by Dynamic Technology Integration. It is sold in the United States. To reach us, email info@dtisys.com.',
      'By creating an account or subscribing you agree to these terms.',
    ],
  },
  {
    title: 'Your account',
    body: [
      'An account is for one person. Keep your password private; you are responsible for what is done with your account.',
      'You must be 13 or older to use VantraRun. If you are under 18, use it with a parent or guardian.',
    ],
  },
  {
    title: 'Subscription and free trial',
    body: [
      'VantraRun costs $4.99 a month or $49.99 a year when bought on the website.',
      'A new subscription starts with 7 days free, once per person. A payment card is needed to start the trial.',
      'If you do not cancel before the trial ends, the plan you chose is charged on the day it ends.',
      'We email you two days before the trial ends.',
      'Payment on the website is taken by Stripe. We never receive or store your card number.',
    ],
  },
  {
    title: 'Automatic renewal',
    body: [
      'Your subscription renews automatically at the same price every month or every year until you cancel.',
      'If a payment fails we try again; access ends three days after the period you paid for if no payment succeeds.',
    ],
  },
  {
    title: 'Cancelling',
    body: [
      'You can cancel at any time in Settings, under Subscription. Access continues to the end of the period you have paid for and you are not charged again.',
      'A subscription you have cancelled can be resumed until that date.',
    ],
  },
  {
    title: 'Refunds',
    body: [
      'Monthly payments are not refundable once charged.',
      'An annual payment is refunded in full if you ask within 14 days of the charge, by emailing info@dtisys.com from the address on your account. Access ends when the refund is made.',
    ],
  },
  {
    title: 'Purchases made in the iPhone app',
    body: [
      'Subscriptions bought in the iPhone app are billed by Apple, at the price shown there. Apple handles cancellations and refunds for those purchases through your Apple account; we cannot grant or refuse them.',
    ],
  },
  {
    title: 'Invite codes and free access',
    body: [
      'We may give an account free access, with an invite code or directly, and we may withdraw it. Free access never asks for payment details.',
    ],
  },
  {
    title: 'Deleting your account',
    body: [
      'You can delete your account at any time. Deleting it cancels a subscription bought on the website, and you are not charged again. Time left on a period you have paid for is not refunded, except as described under Refunds.',
      'A subscription bought in the iPhone app is cancelled in your Apple account, not by deleting your VantraRun account.',
    ],
  },
  {
    title: 'Not medical advice',
    body: [
      'VantraRun estimates zones, pace targets and heart-rate bands from formulas and the numbers you enter. It is a training aid, not a medical device and not medical advice. Talk to a clinician before starting or changing a training programme, and stop if something hurts.',
    ],
  },
  {
    title: 'Acceptable use',
    body: [
      'Use VantraRun for your own training. Do not try to reach another person’s data, interfere with the service, copy it in bulk, or use posts, friend requests or challenges to harass anyone.',
      'We may suspend or close an account that does any of these.',
    ],
  },
  {
    title: 'Changes to the price or these terms',
    body: [
      'If the price of your plan changes, we email you at least 30 days before the new price takes effect at your next renewal. You can cancel before then and pay nothing more.',
      'If these terms change in a way that matters, this page is updated and we tell you by email. The date below always reflects the current version.',
    ],
  },
  {
    title: 'Liability',
    body: [
      'VantraRun is provided as it is. We work to keep it available and accurate, but we do not promise it will be free of faults or interruptions.',
      'To the extent the law allows, Dynamic Technology Integration is not liable for indirect or consequential loss, and its total liability to you is limited to the amount you paid for VantraRun in the twelve months before the claim. Nothing in these terms limits rights that the law does not allow to be limited.',
    ],
  },
  {
    title: 'Governing law',
    body: [
      'These terms are governed by the laws of the United States and of the state in which Dynamic Technology Integration is registered.',
    ],
  },
  {
    title: 'Contact',
    body: ['Questions about these terms, a subscription or a refund: info@dtisys.com.'],
  },
];

export default function Terms() {
  // The terms only mean something once subscriptions are sold. While the server's
  // SUBSCRIPTIONS switch is off the page says so and shows no price; nothing links here then.
  const [inEffect, setInEffect] = useState(null);

  useEffect(() => {
    const previous = document.title;
    document.title = 'Terms of use · VantraRun';
    let alive = true;
    api.auth
      .options()
      .then((options) => alive && setInEffect(options?.subscriptions === true))
      .catch(() => alive && setInEffect(false));
    return () => {
      alive = false;
      document.title = previous;
    };
  }, []);

  if (inEffect !== true) {
    return (
      <div className="mx-auto max-w-2xl space-y-5 px-4 py-10">
        <div>
          <Link to="/" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
            ← Back to VantraRun
          </Link>
          <p className="eyebrow mt-6">Terms</p>
          <h1 className="mt-1 font-heading text-2xl leading-tight">Terms of use</h1>
          {inEffect === false && (
            <>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">These terms are not yet in effect.</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                VantraRun is in invite-only testing and nothing is for sale. The terms will be published here before
                subscriptions open. How we handle your data is in the{' '}
                <Link to="/privacy" className="text-primary hover:underline">
                  Privacy policy
                </Link>
                .
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-10">
      <div>
        <Link to="/" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
          ← Back to VantraRun
        </Link>
        <p className="eyebrow mt-6">Terms</p>
        <h1 className="mt-1 font-heading text-2xl leading-tight">Terms of use</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          What you get, what it costs, how it renews and how to stop. How we handle your data is in the{' '}
          <Link to="/privacy" className="text-primary hover:underline">
            Privacy policy
          </Link>
          .
        </p>
      </div>

      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-border">
        {[
          { label: 'Monthly', value: '$4.99' },
          { label: 'Annual', value: '$49.99' },
          { label: 'Free trial', value: '7 days' },
        ].map((item) => (
          <div key={item.label} className="bg-card px-3 py-3.5 text-center">
            <p className="eyebrow text-[9px]">{item.label}</p>
            <p className="mt-1 font-heading text-base leading-none">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {SECTIONS.map((section) => (
          <section key={section.title} className="panel space-y-2 p-5">
            <h2 className="font-heading text-sm">{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph.slice(0, 40)} className="text-[11px] leading-relaxed text-muted-foreground">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>

      <p className="vr-label text-[10px]">Last updated {TERMS_UPDATED}</p>
    </div>
  );
}
