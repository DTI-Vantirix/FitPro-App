import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ZONE_COLORS } from '@/lib/zones';
import { formatPace, parsePace } from '@/lib/format';

export default function ZoneEditor({ open, onOpenChange, zone, onSave }) {
  const [name, setName] = useState('');
  const [fast, setFast] = useState('');
  const [slow, setSlow] = useState('');
  const [color, setColor] = useState(ZONE_COLORS[1]);

  useEffect(() => {
    if (!open) return;
    setName(zone?.name || '');
    setFast(zone ? formatPace(zone.fast_sec) : '');
    setSlow(zone ? formatPace(zone.slow_sec) : '');
    setColor(zone?.color || ZONE_COLORS[1]);
  }, [open, zone]);

  const fastSec = parsePace(fast);
  const slowSec = parsePace(slow);
  const valid = name.trim() && fastSec > 0 && slowSec > fastSec;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-heading">{zone ? 'Edit zone' : 'New pace zone'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block">
            <span className="eyebrow">Zone name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Easy"
              className="mt-1.5 w-full rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm outline-none focus:border-primary/60"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="eyebrow">Fastest /mi</span>
              <input
                value={fast}
                onChange={(e) => setFast(e.target.value)}
                placeholder="9:00"
                inputMode="numeric"
                className="num mt-1.5 w-full rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm outline-none focus:border-primary/60"
              />
            </label>
            <label className="block">
              <span className="eyebrow">Slowest /mi</span>
              <input
                value={slow}
                onChange={(e) => setSlow(e.target.value)}
                placeholder="10:00"
                inputMode="numeric"
                className="num mt-1.5 w-full rounded-xl border border-border bg-secondary/60 px-3.5 py-2.5 text-sm outline-none focus:border-primary/60"
              />
            </label>
          </div>
          <div>
            <span className="eyebrow">Colour</span>
            <div className="mt-2 flex gap-2">
              {ZONE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Use colour ${c}`}
                  className="h-8 w-8 rounded-full border-2 transition-transform"
                  style={{
                    background: c,
                    borderColor: color === c ? '#fff' : 'transparent',
                    transform: color === c ? 'scale(1.08)' : 'none',
                  }}
                />
              ))}
            </div>
          </div>
          <button
            type="button"
            disabled={!valid}
            onClick={() => onSave({ name: name.trim(), fast_sec: fastSec, slow_sec: slowSec, color })}
            className="w-full rounded-full bg-primary py-3 font-heading text-sm font-semibold text-primary-foreground transition hover:brightness-95 disabled:opacity-40"
          >
            Save zone
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}