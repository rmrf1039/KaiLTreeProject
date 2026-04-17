const PALETTE: Array<[number, number, number]> = [
  [86, 140, 58],
  [142, 168, 64],
  [202, 168, 56],
  [215, 134, 52],
  [168, 84, 48],
  [74, 112, 48],
  [112, 152, 72],
  [196, 172, 84],
  [120, 86, 54],
];

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export async function generateFallbackLeaves(count: number, size = 256): Promise<ImageBitmap[]> {
  const out: ImageBitmap[] = [];
  for (let i = 0; i < count; i++) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2d unavailable');
    const base = PALETTE[i % PALETTE.length]!;
    const [r, g, b] = base;
    const grad = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `rgb(${clamp(r + 36)},${clamp(g + 36)},${clamp(b + 36)})`);
    grad.addColorStop(0.7, `rgb(${r},${g},${b})`);
    grad.addColorStop(1, `rgb(${clamp(r - 32)},${clamp(g - 32)},${clamp(b - 32)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 2;
    for (let j = 0; j < 7; j++) {
      ctx.beginPath();
      const ang = (j / 7) * Math.PI * 2 + i * 0.4;
      ctx.moveTo(size / 2, size / 2);
      ctx.lineTo(
        size / 2 + Math.cos(ang) * size * 0.42,
        size / 2 + Math.sin(ang) * size * 0.42,
      );
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.arc(size * 0.38, size * 0.38, size * 0.18, 0, Math.PI * 2);
    ctx.fill();

    out.push(canvas.transferToImageBitmap());
  }
  return out;
}
