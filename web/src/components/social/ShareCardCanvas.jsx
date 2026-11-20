import { useEffect, useRef, useState } from 'react';
import { CARD_H, CARD_W, drawCard, loadBackground } from '@/lib/shareCard';

// Single source of truth for the generated post: the same canvas is the preview
// and the file that gets saved or shared.
export default function ShareCardCanvas({
  card,
  points,
  backgroundType = 'none',
  backgroundUrl = '',
  canvasRef,
  onDrawn,
}) {
  const localRef = useRef(null);
  const ref = canvasRef || localRef;
  const [media, setMedia] = useState(null);
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    let alive = true;
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (alive) setFontsReady(true);
      });
    } else {
      setFontsReady(true);
    }
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setMedia(null);
    loadBackground(backgroundType, backgroundUrl).then((m) => {
      if (alive) setMedia(m);
    });
    return () => {
      alive = false;
    };
  }, [backgroundType, backgroundUrl]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !fontsReady) return;
    drawCard(canvas.getContext('2d'), { card, points, media });
    onDrawn?.(canvas);
  }, [card, points, media, fontsReady, ref]);

  // Video backgrounds keep redrawing so the preview follows the footage.
  useEffect(() => {
    if (!media || media.type !== 'video') return undefined;
    const id = setInterval(() => {
      const canvas = ref.current;
      if (canvas) drawCard(canvas.getContext('2d'), { card, points, media });
    }, 180);
    return () => clearInterval(id);
  }, [media, card, points, ref]);

  return (
    <canvas
      ref={ref}
      width={CARD_W}
      height={CARD_H}
      className="h-auto w-full rounded-2xl bg-[#0C0C0B]"
    />
  );
}