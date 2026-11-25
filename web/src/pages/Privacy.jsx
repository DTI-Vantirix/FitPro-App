import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { POLICY_UPDATED } from '@/lib/consent';

const SECTIONS = [
  {
    title: 'Who this covers',
    body: [
      'This policy covers the VantraRun phone app and the VantraRun website. They are the same service: one account, one set of data.',
      'VantraRun is in invite-only testing. It is run by the VantraRun team, the people who gave you your invite code. To ask a question or make a request about your data, contact the person who invited you.',
    ],
  },
  {
    title: 'What we collect',
    body: [
      'Account: your email address, a password (stored only as a one-way hash, never as text), your name if you give one, and the invite code you signed up with.',
      'Training profile: max heart rate and threshold pace, and on the website optionally age, sex, height and weight. These produce your five training zones.',
      'Runs you record: start time, distance, duration, pace, mile splits, the GPS track of the route, the zone you aimed for and how much of the run you spent in it, and heart rate (highest, lowest, average) if you paired a sensor.',
      'Routes: the routes you build on the website, including their turn-by-turn directions when you open one to run.',
      'Activities you import: if you choose to import a run from Apple Health or Health Connect, the details of that run. Only the activities you pick are sent. The app reads from those services and never writes to them.',
      'Things you share: posts, photos or videos you attach, friend connections and challenge results, when you use those features.',
      'Error reports: if the phone app crashes, the error message, where in the code it happened, the app version and the kind of phone. If the server hits an unexpected error while handling your request, the same kind of record is kept with your account. An error report holds no location, heart rate or run data.',
      'Technical records: like any website, the server and its hosting provider see the internet address a request came from, and keep short-lived logs to keep the service running and to limit repeated sign-in attempts.',
    ],
  },
  {
    title: 'What we do not collect',
    body: [
      'No advertising identifiers, no contacts, no microphone, no browsing history, and no location outside a run you started.',
      'No third-party analytics, advertising pixels or session recording, in the app or on the website. There is nothing on a run screen quietly reporting what you do.',
    ],
  },
  {
    title: 'How we use it',
    body: [
      'To do what the app is for: record and show your runs, coach you against your zones, give directions on your routes, show your history and statistics, and run the social features you choose to use.',
      'To keep the service working and secure: sending the sign-up code and password-reset emails, fixing crashes, and blocking abuse.',
      'We do not sell your data, use it for advertising, build a profile of you for anyone else, or share it with data brokers or insurers.',
    ],
  },
  {
    title: 'Permissions the phone app asks for',
    body: [
      'Location, "while using the app": asked when you start a run. It is used only while a run is being recorded, including while the screen is locked, and stops when you finish or discard the run. Without it a run cannot be measured.',
      'Bluetooth: asked only if you choose to connect a heart-rate strap or watch. Without it the app coaches pace only.',
      'Notifications: so that a cue such as "Heart rate above zone" also appears on your lock screen and a paired watch. Without them you still get the spoken cue and the vibration.',
      'Apple Health or Health Connect: asked only if you choose to import a run, and only for reading.',
      'You can change any of these at any time in your phone’s settings.',
    ],
  },
  {
    title: 'Who can see your data',
    body: [
      'You. Your runs, routes, profile and zones are readable only by your account: another signed-in person cannot open them.',
      'People you share with. A post is visible to whoever you chose when you made it: only you, your accepted friends, or everyone using VantraRun. Challenge results are visible to the members of that challenge.',
      'The people who run VantraRun can access stored data when that is needed to operate, secure or fix the service, or to answer a request from you.',
      'We will disclose data if the law requires it, and would tell you unless we are legally prevented from doing so.',
    ],
  },
  {
    title: 'Companies that help run the service',
    body: [
      'Hosting: the server and database run on Render, in the United States. Everything listed above is stored there.',
      'Email: sign-up codes and password-reset links are delivered by Resend, which receives your email address and the message.',
      'Maps and directions: when you build a route or open one to run, its waypoints (coordinates, without your name or account) are sent to a routing service to work out the path and the turns. The map you see is drawn by Apple Maps or Google Maps in the phone app and by OpenStreetMap on the website; like any map, those providers see which area is being displayed.',
      'These companies handle data only to provide their part of the service. None of them is given your data to use for their own advertising.',
    ],
  },
  {
    title: 'How long we keep it',
    body: [
      'There is no fixed period. Your data is kept until you delete it or delete your account.',
      'Deleting your account removes your account and every record tied to it from the live database straight away, including error reports. Copies may remain in the hosting provider’s routine database backups for a short time until those backups expire.',
      'Error reports are also trimmed automatically: only the most recent 2,000 across everyone are kept.',
      'Runs waiting to upload are stored on your phone until the server has them. Deleting your account from the app removes them from the phone as well.',
    ],
  },
  {
    title: 'Your choices',
    body: [
      'See your data: your runs, routes, zones and posts are all visible in the app and on the website. To ask for a copy, contact the person who invited you.',
      'Correct it: edit your profile and zones on the website; delete and re-record or re-import anything that is wrong.',
      'Delete training data: on the website, Settings → Your data wipes your runs, routes, profile and zones immediately. It cannot be undone.',
      'Delete your whole account: in the phone app, Settings → Delete account; on the website, Settings → Your data → Delete account. Both ask for your password, then remove your account and every record tied to it. It cannot be undone.',
      'Withdraw consent: stop using the app and delete your account. Turning off a permission in your phone’s settings stops that kind of data being collected from then on.',
    ],
  },
  {
    title: 'Security',
    body: [
      'Connections to the service are encrypted (HTTPS). Passwords are stored only as salted one-way hashes. On your phone, your sign-in is kept in the device’s secure storage. Each record is checked against its owner before it is shown or changed.',
      'No system is perfectly secure. If we learn of a breach affecting your data we will tell you.',
    ],
  },
  {
    title: 'Where your data is',
    body: [
      'The service is hosted in the United States. If you use VantraRun from another country, your data is transferred to and stored in the United States.',
    ],
  },
  {
    title: 'Not medical advice',
    body: [
      'VantraRun estimates zones, pace targets and heart-rate bands from formulas and the numbers you enter. It is a training aid, not a medical device and not medical advice. Talk to a clinician before starting or changing a training programme, and stop if something hurts.',
    ],
  },
  {
    title: 'Age',
    body: ['VantraRun is not intended for children under 13. If you are under 18, use it with a parent or guardian.'],
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
    document.title = 'Privacy policy · VantraRun';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-10">
      <div>
        <Link to="/" className="text-xs text-muted-foreground transition-colors hover:text-foreground">
          ← Back to VantraRun
        </Link>
        <p className="eyebrow mt-6">Privacy</p>
        <h1 className="mt-1 font-heading text-2xl font-bold leading-tight">Your data stays yours</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          VantraRun records where you run and how hard your heart works. That is sensitive information, so this page says
          exactly what is collected, why, who can see it, how long it is kept and how to delete it.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-border">
        {[
          { label: 'Sold', value: 'Never' },
          { label: 'Ads', value: 'None' },
          { label: 'Kept', value: 'Until you delete' },
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