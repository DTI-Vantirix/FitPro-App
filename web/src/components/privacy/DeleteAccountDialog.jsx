import { useState } from 'react';
import { api } from '@/api/client';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

// "Delete your VantraRun account?", confirmed with the password. The same dialog in
// Settings and on the paywall, so a person who has not paid can delete their account
// too. `children` is the button that opens it.
export default function DeleteAccountDialog({ children }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  const deleteAccount = async (e) => {
    e.preventDefault();
    if (!password || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await api.auth.deleteAccount(password);
      // The account and its session are gone; leave the signed-in app.
      window.location.assign('/login');
    } catch (err) {
      setError(err?.message || 'Could not delete your account. Try again.');
      setDeleting(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (deleting) return;
        setOpen(next);
        setPassword('');
        setError(null);
      }}
    >
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <form onSubmit={deleteAccount} className="space-y-4">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your VantraRun account?</AlertDialogTitle>
            <AlertDialogDescription>
              Your account and everything in it will be removed for good. A subscription bought on the website is
              cancelled and you are not charged again. Enter your password to confirm.
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
              className="mt-1.5 w-full rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm transition-colors focus:border-primary"
            />
          </label>
          {error && <p className="text-xs text-destructive">{error}</p>}
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
  );
}
