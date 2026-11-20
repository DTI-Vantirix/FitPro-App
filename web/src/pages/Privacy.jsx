import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { POLICY_UPDATED } from '@/lib/consent';

const SECTIONS = [
  {
    title: 'What FitPro records',
    body: [
      'Account: your email address, and your name if your sign-in method provides one.',
      'Training profile: age, sex, height and weight. These produce your max heart rate, threshold pace and the five pace zones.',
      'Runs: start time, distance, duration, pace, mile splits, the GPS track of the route, heart rate from a strap you paired, and any notes you add.',
      'Routes and workouts: the routes you build or import, the gym location on a route, and the weights, reps and sets you log.',
    ],
  },
  {
    title: 'Where it lives',
    body: [
      'Everything is stored in this app’s own hosted database and is tied to your account. The app is built so that your records are readable only by you: another signed-in person on this app cannot open your runs, routes or workouts.',
      'We do not sell your data, and we do not share it with advertisers, data brokers or insurers.',
    ],
  },
  {
    title: 'No trackers',
    body: [
      'The signed-in app runs no third-party analytics, advertising pixels or session recording. There is nothing on a run screen quietly reporting what you do.',
      'Standard hosting logs may exist at the platform level to keep the service running and secure; those are not used to profile your training.',
    ],
  },
  {
    title: 'Location and heart rate, specifically',
    body: [
      'Location is read only while you have a run tracking, and the resulting track is saved as part of that run. You can run a route without saving a track by not starting tracking.',
      'Heart rate comes from a monitor you pair yourself. The browser connects to it directly; the readings are written to the run record and nowhere else.',
      'Watch and platform syncs, when you turn them on, pull the activities you authorise and nothing more.',
    ],
  },
  {
    title: 'Your choices',
    body: [
      'Delete all training data: Settings → Your data wipes your runs, routes, workouts, profile and zones immediately. It cannot be undone.',
      'Delete your whole account: an app admin can remove your account from the app’s user list, which takes your records with it.',
      'Withdraw consent: stop using the app and delete your data. The next sign-in will ask for consent again only if your account still exists.',
    ],
  },
  {
    title: 'Not medical advice',
    body: [
      'FitPro estimates zones, pace targets and heart-rate bands from formulas and the numbers you enter. It is a training aid, not a medical device and not medical advice. Talk to a clinician before starting or changing a training programme, and stop if something hurts.',
    ],
  },
  {
    title: 'Age',
    body: ['FitPro is not intended for children under 13. If you are under 18, use it with a parent or guardian.'],
  },
  {
    title: 'Changes to this policy',
    body: [
      'If what we collect or how we handle it changes in a meaningful way, this page is updated and the app asks for your consent again. The date below always reflects the current version.',
    ],
  },
];

export default function Privacy() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Privacy policy · FitPro';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-10">
      <div>
        <Link to="/" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
          ← Back to FitPro
        </Link>
        <p className="eyebrow mt-6">Privacy</p>
        <h1 className="mt-1 font-heading text-2xl font-bold leading-tight">Your data stays yours</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          FitPro tracks where you run and how hard your heart works. That is sensitive information, so here is exactly
          what is kept, who can see it, and how to get rid of it.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-border">
        {[
          { label: 'Sold', value: 'Never' },
          { label: 'Ads', value: 'None' },
          { label: 'Who sees', value: 'You' },
        ].map((item) => (
          <div key={item.label} className="bg-card px-3 py-3.5 text-center">
            <p className="eyebrow text-[9px]">{item.label}</p>
            <p className="mt-1 font-heading text-base font-bold leading-none">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {SECTIONS.map((section) => (
          <section key={section.title} className="panel space-y-2 p-5">
            <h2 className="font-heading text-sm font-bold">{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph.slice(0, 40)} className="text-[11px] leading-relaxed text-muted-foreground">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>

      <p className="num text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        Last updated {POLICY_UPDATED}
      </p>
    </div>
  );
}