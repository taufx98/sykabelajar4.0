import { useEffect, useRef } from 'react';

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  rotation: number;
  vr: number;
  shape: 'rect' | 'circle';
}

const COLORS = ['#10b981', '#34d399', '#6ee7b7', '#fbbf24', '#f59e0b', '#38bdf8'];

export function fireConfetti(duration = 2500) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:200;';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  const pieces: Piece[] = [];
  for (let i = 0; i < 140; i++) {
    pieces.push({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 200,
      y: window.innerHeight / 2,
      vx: (Math.random() - 0.5) * 12,
      vy: Math.random() * -14 - 4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: Math.random() * 8 + 4,
      rotation: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.3,
      shape: Math.random() > 0.5 ? 'rect' : 'circle',
    });
  }

  let start = performance.now();
  function frame(now: number) {
    const elapsed = now - start;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach((p) => {
      p.vy += 0.35;
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - elapsed / duration);
      if (p.shape === 'rect') {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
    if (elapsed < duration) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
    }
  }
  requestAnimationFrame(frame);
}

export function ConfettiBurst({ fire }: { fire: boolean }) {
  const ref = useRef(false);
  useEffect(() => {
    if (fire && !ref.current) {
      ref.current = true;
      fireConfetti();
      setTimeout(() => { ref.current = false; }, 3000);
    }
  }, [fire]);
  return null;
}
