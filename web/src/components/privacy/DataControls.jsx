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
import DeleteAccountDialog from '@/components/privacy/DeleteAccountDialog';

// Workout stays in this list while gym is hidden, so stored gym logs are still wiped.
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
        <h2 className="font-heading text-base">Your data</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          VantraRun keeps your GPS tracks and heart rate so you can look back at them. You can erase all of it
          yourself, without asking anyone.
        </p>
      </div>

      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3">
        <p className="text-xs font-medium text-foreground">Delete all training data</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Removes every run, route, pace zone and your training profile. Permanent — there is no undo and no
          backup.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              disabled={busy}
              className="mt-3 rounded-full border border-destructive/50 px-3.5 py-1.5 text-[11px] font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
            >
              {busy ? 'Deleting…' : 'Delete everything'}
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete all your training data?</AlertDialogTitle>
              <AlertDialogDescription>
                Every run, route, pace zone and your profile will be removed from this app. This cannot be
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
          Closes your VantraRun account and removes everything tied to it: your login, training data, posts, friends and
          challenge entries. Permanent — there is no undo and no backup.
        </p>
        <DeleteAccountDialog>
          <button
            type="button"
            className="mt-3 rounded-full border border-destructive/50 px-3.5 py-1.5 text-[11px] font-semibold text-destructive transition hover:bg-destructive/10"
          >
            Delete account
          </button>
        </DeleteAccountDialog>
      </div>

      <Link to="/privacy" className="inline-block text-xs text-primary hover:underline">
        Read the privacy policy
      </Link>
    </section>
  );
}