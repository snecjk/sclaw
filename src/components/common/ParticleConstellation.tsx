/**
 * ParticleConstellation - Canvas 2D particle network background
 * Renders floating particles connected by lines when nearby,
 * creating a constellation / neural-network ambient effect.
 */
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  opacity: number;
}

interface ParticleConstellationProps {
  particleCount?: number;
  connectionDistance?: number;
  speed?: number;
  className?: string;
}

function createParticles(count: number, w: number, h: number, speed: number): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const v = (Math.random() * 0.4 + 0.1) * speed;
    particles.push({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: Math.cos(angle) * v,
      vy: Math.sin(angle) * v,
      radius: Math.random() * 1.8 + 1.85,
      opacity: Math.random() * 0.28 + 0.48,
    });
  }
  return particles;
}

function readThemeColors(): { dot: string; line: string } {
  const style = getComputedStyle(document.documentElement);
  const primary = style.getPropertyValue('--primary').trim();
  const isDark = document.documentElement.classList.contains('dark');
  const dotAlpha = isDark ? 0.52 : 0.4;
  const lineAlpha = isDark ? 0.28 : 0.22;
  return {
    dot: `hsl(${primary} / ${dotAlpha})`,
    line: `hsl(${primary} / ${lineAlpha})`,
  };
}

export function ParticleConstellation({
  particleCount = 45,
  connectionDistance = 120,
  speed = 0.3,
  className,
}: ParticleConstellationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animFrameRef = useRef(0);
  const colorsRef = useRef(readThemeColors());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const count = Math.min(particleCount, 60);
    const connDist = connectionDistance;
    const connDistSq = connDist * connDist;

    // ── Sizing ──────────────────────────────────────────────
    const syncSize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Re-init particles on first size or when canvas grows significantly
      const w = rect.width;
      const h = rect.height;
      if (particlesRef.current.length === 0) {
        particlesRef.current = createParticles(count, w, h, speed);
      } else {
        // Clamp any out-of-bounds particles
        for (const p of particlesRef.current) {
          if (p.x > w) p.x = w - 1;
          if (p.y > h) p.y = h - 1;
        }
      }
    };

    syncSize();

    const ro = new ResizeObserver(syncSize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    // ── Theme observation ───────────────────────────────────
    colorsRef.current = readThemeColors();
    const mo = new MutationObserver(() => {
      colorsRef.current = readThemeColors();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // ── Reduced motion ──────────────────────────────────────
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reducedMotion = mql.matches;
    const onMotionChange = (e: MediaQueryListEvent) => {
      reducedMotion = e.matches;
    };
    mql.addEventListener('change', onMotionChange);

    // ── Draw ────────────────────────────────────────────────
    const draw = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = parent.getBoundingClientRect().width;
      const h = parent.getBoundingClientRect().height;
      const particles = particlesRef.current;
      const { dot, line } = colorsRef.current;

      ctx.clearRect(0, 0, w, h);

      // Update positions (skip if reduced motion)
      if (!reducedMotion) {
        for (const p of particles) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > w) p.vx *= -1;
          if (p.y < 0 || p.y > h) p.vy *= -1;
          p.x = Math.max(0, Math.min(w, p.x));
          p.y = Math.max(0, Math.min(h, p.y));
        }
      }

      // Draw connections
      ctx.strokeStyle = line;
      ctx.lineWidth = 0.5;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distSq = dx * dx + dy * dy;
          if (distSq < connDistSq) {
            const alpha = 1 - Math.sqrt(distSq) / connDist;
            ctx.globalAlpha = alpha;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw particles
      for (const p of particles) {
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = dot;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;

      if (!reducedMotion) {
        animFrameRef.current = requestAnimationFrame(draw);
      }
    };

    // Start
    animFrameRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      ro.disconnect();
      mo.disconnect();
      mql.removeEventListener('change', onMotionChange);
    };
  }, [particleCount, connectionDistance, speed]);

  return (
    <canvas
      ref={canvasRef}
      className={cn('absolute inset-0 pointer-events-none', className)}
    />
  );
}
