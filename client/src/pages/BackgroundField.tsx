import { useEffect, useRef } from 'react';

type Particle = {
  imgIdx: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vrot: number;
  alpha: number;
  depth: number;
};

const PARTICLE_COUNT = 380;

export function BackgroundField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let cancelled = false;
    let raf = 0;
    let lastT = performance.now();
    const images: HTMLImageElement[] = [];
    let particles: Particle[] = [];

    function resize(): void {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      canvas!.style.width = `${w}px`;
      canvas!.style.height = `${h}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function makeParticle(): Particle {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const depth = Math.random();
      const size = 36 + depth * 96;
      const speed = 4 + (1 - depth) * 10;
      const angle = Math.random() * Math.PI * 2;
      return {
        imgIdx: Math.floor(Math.random() * Math.max(1, images.length)),
        x: Math.random() * w,
        y: Math.random() * h,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size,
        rot: (Math.random() - 0.5) * 0.35,
        vrot: (Math.random() - 0.5) * 0.04,
        alpha: 0.35 + depth * 0.55,
        depth,
      };
    }

    function spawnAll(): void {
      particles = new Array(PARTICLE_COUNT).fill(0).map(() => makeParticle());
      particles.sort((a, b) => a.depth - b.depth);
    }

    function draw(now: number): void {
      if (cancelled) return;
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;

      const w = window.innerWidth;
      const h = window.innerHeight;

      ctx!.fillStyle = '#ffffff';
      ctx!.fillRect(0, 0, w, h);

      if (images.length === 0) {
        raf = requestAnimationFrame(draw);
        return;
      }

      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;

        const margin = p.size;
        if (p.x < -margin) p.x = w + margin;
        else if (p.x > w + margin) p.x = -margin;
        if (p.y < -margin) p.y = h + margin;
        else if (p.y > h + margin) p.y = -margin;

        const img = images[p.imgIdx % images.length]!;
        if (!img.complete || img.naturalWidth === 0) continue;

        ctx!.save();
        ctx!.globalAlpha = p.alpha;
        ctx!.translate(p.x, p.y);
        ctx!.rotate(p.rot);
        const half = p.size / 2;
        ctx!.drawImage(img, -half, -half, p.size, p.size);
        ctx!.restore();
      }

      raf = requestAnimationFrame(draw);
    }

    resize();
    spawnAll();
    window.addEventListener('resize', resize);

    raf = requestAnimationFrame(draw);

    void (async () => {
      try {
        const r = await fetch('/api/bg-images');
        if (!r.ok) return;
        const data = (await r.json()) as { images: string[] };
        if (cancelled) return;
        const loaded: HTMLImageElement[] = [];
        await Promise.all(
          data.images.map(
            (url) =>
              new Promise<void>((resolve) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                  loaded.push(img);
                  resolve();
                };
                img.onerror = () => resolve();
                img.src = url;
              }),
          ),
        );
        if (cancelled) return;
        images.push(...loaded);
        for (const p of particles) {
          p.imgIdx = Math.floor(Math.random() * Math.max(1, images.length));
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="bg-field" aria-hidden="true" />;
}
