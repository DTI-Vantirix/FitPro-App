import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

const PURGE = [
  ['Run', 'runs'],
  ['Route', 'routes'],
  ['Workout', 'workouts'],
  ['PaceZone', 'pace zones'],
  ['Profile', 'training profile'],
];

export default function DataControls() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const deleteAccount = async (e) => {
    e.preventDefault();
    if (!password || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.auth.deleteAccount(password);
      // The account and its session are gone; leave the signed-in app.
      window.location.assign('/login');
    } catch (err) {
      setDeleteError(err?.message || 'Could not delete your account. Try again.');
      setDeleting(false);
    }
  };

  const wipe = async () => {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const user = await api.auth.me();
      for (const [entity] of PURGE) {
        await api.entities[entity].deleteMany({ created_by_id: user.id });
      }
      setDone(true);
    } catch (err) {
      setError(err?.message || 'Could not delete everything. Try again.');
    }
    setBusy(false);
  };

  return (
    <section className="panel space-y-3 p-5">
      <div>
        <h2 className="font-heading text-base font-bold">Your data</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          FitPro keeps your GPS tracks, heart rate and gym logs so you can look back at them. You can erase all of it
          yourself, without asking anyone.
        </p>
      </div>

      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3">
        <p className="text-xs font-medium text-foreground">Delete all training data</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Removes every run, route, workout, pace zone and your training profile. Permanent — there is no undo and no
          backup.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              disabled={busy}
              className="mt-3 rounded-full border border-destructive/50 px-3.5 py-1.5 font-heading text-[11px] font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
            >
              {busy ? 'Deleting…' : 'Delete everything'}
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete all your training data?</AlertDialogTitle>
              <AlertDialogDescription>
                Every run, route, workout, pace zone and your profile will be removed from this app. This cannot be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep my data</AlertDialogCancel>
              <AlertDialogAction onClick={wipe}>Delete it all</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {done && <p className="text-xs text-primary">Deleted. The app is empty and ready for a fresh start.</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3">
        <p className="text-xs font-medium text-foreground">Delete account</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Closes your FitPro account and removes everything tied to it: your login, training data, posts, friends and
          challenge entries. Permanent — there is no undo and no backup.
        </p>
        <AlertDialog
          open={deleteOpen}
          onOpenChange={(open) => {
            if (deleting) return;
            setDeleteOpen(open);
            setPassword('');
            setDeleteError(null);
          }}
        >
          <AlertDialogTrigger asChild>
            <button
              type="button"
              className="mt-3 rounded-full border border-destructive/50 px-3.5 py-1.5 font-heading text-[11px] font-semibold text-destructive transition hover:bg-destructive/10"
            >
              Delete account
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <form onSubmit={deleteAccount} className="space-y-4">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your FitPro account?</AlertDialogTitle>
                <AlertDialogDescription>
                  Your account and everything in it will be removed for good. Enter your password to confirm.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <label className="block">
                <span className="eyebrow">Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-primary/60"
                />
              </label>
              {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Keep my account</AlertDialogCancel>
                <button
                  type="submit"
                  disabled={!password || deleting}
                  className="inline-flex h-9 items-center justify-center rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground transition hover:bg-destructive/90 disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Delete my account'}
                </button>
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Link to="/privacy" className="inline-block text-xs text-primary hover:underline">
        Read the privacy policy
      </Link>
    </section>
  );
}