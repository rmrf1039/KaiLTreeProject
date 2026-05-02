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

const PARTICLE_COUNT = 750;
const EXCLUSION_HALF_W = 210;
const EXCLUSION_HALF_H = 130;
const EXCLUSION_BUFFER_PX = 40;
const MAX_SPEED = 24;
const PUSH_STRENGTH = 220;

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
    let clusters: Array<{ x: number; y: number; spread: number; weight: number }> = [];

    function gaussian(): number {
      const u = Math.random() || 1e-9;
      const v = Math.random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    function buildClusters(): void {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const cx = w / 2;
      const cy = h / 2;
      const n = 5 + Math.floor(Math.random() * 4);
      clusters = [];
      for (let i = 0; i < n; i++) {
        let x = 0;
        let y = 0;
        for (let tries = 0; tries < 8; tries++) {
          x = Math.random() * w;
          y = Math.random() * h;
          if (Math.abs(x - cx) >= EXCLUSION_HALF_W || Math.abs(y - cy) >= EXCLUSION_HALF_H) break;
        }
        const r = Math.random();
        clusters.push({
          x,
          y,
          spread: 80 + Math.random() * 200,
          weight: 0.45 + Math.pow(r, 0.75) * 3.0,
        });
      }
    }

    function pickCluster(): { x: number; y: number; spread: number; weight: number } {
      let total = 0;
      for (const c of clusters) total += c.weight;
      let r = Math.random() * total;
      for (const c of clusters) {
        r -= c.weight;
        if (r <= 0) return c;
      }
      return clusters[clusters.length - 1]!;
    }

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
      const size = 30 + depth * 14;
      const speed = 3 + (1 - depth) * 8;
      const angle = Math.random() * Math.PI * 2;
      const cx = w / 2;
      const cy = h / 2;
      const useCluster = Math.random() < 0.85 && clusters.length > 0;
      let x = 0;
      let y = 0;
      for (let tries = 0; tries < 16; tries++) {
        if (useCluster) {
          const c = pickCluster();
          x = c.x + gaussian() * c.spread;
          y = c.y + gaussian() * c.spread * (0.7 + Math.random() * 0.6);
        } else {
          x = Math.random() * w;
          y = Math.random() * h;
        }
        const inX = x >= -50 && x <= w + 50;
        const inY = y >= -50 && y <= h + 50;
        const outsideExclusion =
          Math.abs(x - cx) >= EXCLUSION_HALF_W || Math.abs(y - cy) >= EXCLUSION_HALF_H;
        if (inX && inY && outsideExclusion) break;
      }
      return {
        imgIdx: Math.floor(Math.random() * Math.max(1, images.length)),
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size,
        rot: 0,
        vrot: 0,
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

      const cx = w / 2;
      const cy = h / 2;

      for (const p of particles) {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        const ox = Math.max(0, adx - EXCLUSION_HALF_W);
        const oy = Math.max(0, ady - EXCLUSION_HALF_H);
        const outDist = Math.hypot(ox, oy);

        if (outDist === 0) {
          const dxToEdge = EXCLUSION_HALF_W - adx;
          const dyToEdge = EXCLUSION_HALF_H - ady;
          let ux: number;
          let uy: number;
          if (dxToEdge < dyToEdge) {
            ux = Math.sign(dx) || 1;
            uy = 0;
          } else {
            ux = 0;
            uy = Math.sign(dy) || 1;
          }
          p.vx += ux * PUSH_STRENGTH * dt;
          p.vy += uy * PUSH_STRENGTH * dt;
        } else if (outDist < EXCLUSION_BUFFER_PX) {
          const ux = (Math.sign(dx) * ox) / outDist;
          const uy = (Math.sign(dy) * oy) / outDist;
          const strength = (EXCLUSION_BUFFER_PX - outDist) / EXCLUSION_BUFFER_PX;
          p.vx += ux * PUSH_STRENGTH * strength * dt;
          p.vy += uy * PUSH_STRENGTH * strength * dt;
        }

        const speed = Math.hypot(p.vx, p.vy);
        if (speed > MAX_SPEED) {
          p.vx *= MAX_SPEED / speed;
          p.vy *= MAX_SPEED / speed;
        }

        p.x += p.vx * dt;
        p.y += p.vy * dt;

        const dx2 = p.x - cx;
        const dy2 = p.y - cy;
        const adx2 = Math.abs(dx2);
        const ady2 = Math.abs(dy2);
        if (adx2 < EXCLUSION_HALF_W && ady2 < EXCLUSION_HALF_H) {
          const dxToEdge = EXCLUSION_HALF_W - adx2;
          const dyToEdge = EXCLUSION_HALF_H - ady2;
          if (dxToEdge < dyToEdge) {
            p.x = cx + Math.sign(dx2 || 1) * EXCLUSION_HALF_W;
            if ((p.vx > 0) !== (dx2 > 0)) p.vx = 0;
          } else {
            p.y = cy + Math.sign(dy2 || 1) * EXCLUSION_HALF_H;
            if ((p.vy > 0) !== (dy2 > 0)) p.vy = 0;
          }
        }

        const margin = p.size;
        if (p.x < -margin) p.x = w + margin;
        else if (p.x > w + margin) p.x = -margin;
        if (p.y < -margin) p.y = h + margin;
        else if (p.y > h + margin) p.y = -margin;

        const img = images[p.imgIdx % images.length]!;
        if (!img.complete || img.naturalWidth === 0) continue;

        const half = p.size / 2;
        const x = p.x - half;
        const y = p.y - half;
        ctx!.drawImage(img, x, y, p.size, p.size);
        ctx!.strokeStyle = '#ffffff';
        ctx!.lineWidth = 0.75;
        ctx!.strokeRect(x + 0.375, y + 0.375, p.size - 0.75, p.size - 0.75);
      }

      raf = requestAnimationFrame(draw);
    }

    resize();
    buildClusters();
    spawnAll();
    function onResize(): void {
      resize();
      buildClusters();
      spawnAll();
    }
    window.addEventListener('resize', onResize);

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
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="bg-field" aria-hidden="true" />;
}
