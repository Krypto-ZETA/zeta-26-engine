'use client';

import { useRef, useEffect, useCallback } from 'react';
import { useEngineStore, readPositionsFromWasm } from '@/lib/engine';

const TOTAL_PLANET_IMAGES = 11;
const ANIMATION_TOTAL_MS = 5000;

function preloadPlanetImages(): HTMLImageElement[] {
  const imgs: HTMLImageElement[] = [];
  for (let i = 1; i <= TOTAL_PLANET_IMAGES; i++) {
    const img = new Image();
    img.src = `/assets/planets/${i}.png`;
    imgs.push(img);
  }
  return imgs;
}

const planetImages = preloadPlanetImages();

interface TrailPoint { x: number; y: number; }

interface CachedLayout {
  pos: { x: number; y: number }[];
  codexMap: Map<string, number>;
  atmosphereMap: Map<string, number>;
  maxAtmosphere: number;
  pathEdges: Set<string>;
  onPathPlanets: Set<number>;
  nodeIds: string[];
  edges: Uint32Array;
  routePath: number[] | null;
  canvasW: number;
  canvasH: number;
  staticCanvas: HTMLCanvasElement | null;
  staticDirty: boolean;
}

function drawStars(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const DIM_STARS = 60;
  const BRIGHT_STARS = 5;
  let seed = 42;
  const rand = () => { seed = (seed * 16807 + 0) % 2147483647; return seed / 2147483647; };

  for (let i = 0; i < DIM_STARS; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const opacity = 0.15 + rand() * 0.25;
    const size = 0.4 + rand() * 0.6;
    ctx.fillStyle = `rgba(255,255,255,${opacity.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < BRIGHT_STARS; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const r = 1.0 + rand() * 0.8;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
    glow.addColorStop(0, 'rgba(200,220,255,0.2)');
    glow.addColorStop(1, 'rgba(200,220,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function buildStaticCanvas(
  ctx: Canvas2DRenderingContext,
  layout: CachedLayout,
  W: number,
  H: number,
): HTMLCanvasElement {
  if (layout.staticCanvas && !layout.staticDirty) {
    return layout.staticCanvas;
  }

  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const octx = off.getContext('2d')!;
  octx.clearRect(0, 0, W, H);

  drawStars(octx, W, H);

  const { pos, nodeIds, edges, onPathPlanets, codexMap, atmosphereMap, maxAtmosphere } = layout;
  const n = nodeIds.length;

  const isLarge = n > 50;

  octx.beginPath();
  for (let k = 0; k < edges.length; k += 2) {
    const ei = edges[k], ej = edges[k + 1];
    if (ei * 4 + 1 >= pos.length || ej * 4 + 1 >= pos.length) continue;
    const aX = pos[ei * 4], aY = pos[ei * 4 + 1];
    const bX = pos[ej * 4], bY = pos[ej * 4 + 1];
    octx.moveTo(aX, aY);
    octx.lineTo(bX, bY);
  }
  octx.strokeStyle = 'rgba(255,255,255,0.06)';
  octx.lineWidth = 0.6;
  octx.stroke();

  for (let i = 0; i < n; i++) {
    const id = nodeIds[i], p = pos[i];
    const onPath = onPathPlanets.has(i);
    const R = onPath ? 28 : (isLarge ? 10 : 20);

    if (!isLarge || onPath) {
      const glowColor = `rgba(96,165,250,0.15)`;
      const glow = octx.createRadialGradient(p.x, p.y, R * 0.4, p.x, p.y, R * 2.2);
      glow.addColorStop(0, onPath ? 'rgba(96,165,250,0.2)' : glowColor);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      octx.fillStyle = glow;
      octx.beginPath();
      octx.arc(p.x, p.y, R * 2.2, 0, Math.PI * 2);
      octx.fill();
    }

    const codex = codexMap.get(id);
    const imgIdx = codex ? ((codex - 1) % TOTAL_PLANET_IMAGES) : (i % TOTAL_PLANET_IMAGES);
    const img = planetImages[imgIdx];
    if (img && img.complete && img.naturalWidth > 0) {
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const side = Math.min(iw, ih);
      const sx = (iw - side) / 2, sy = (ih - side) / 2;
      octx.save();
      octx.beginPath();
      octx.arc(p.x, p.y, R, 0, Math.PI * 2);
      octx.closePath();
      octx.clip();
      octx.drawImage(img, sx, sy, side, side, p.x - R, p.y - R, R * 2, R * 2);
      octx.restore();
      if (onPath) {
        octx.beginPath();
        octx.arc(p.x, p.y, R, 0, Math.PI * 2);
        octx.strokeStyle = '#93c5fd';
        octx.lineWidth = 2;
        octx.stroke();
      }
    } else {
      const grad = octx.createRadialGradient(p.x - R * 0.3, p.y - R * 0.3, R * 0.08, p.x, p.y, R);
      if (onPath) {
        grad.addColorStop(0, '#93c5fd');
        grad.addColorStop(1, '#3b82f6');
      } else {
        grad.addColorStop(0, '#888');
        grad.addColorStop(1, '#444');
      }
      octx.beginPath();
      octx.arc(p.x, p.y, R, 0, Math.PI * 2);
      octx.fillStyle = grad;
      octx.fill();
      octx.strokeStyle = onPath ? '#93c5fd' : 'rgba(255,255,255,0.15)';
      octx.lineWidth = onPath ? 2 : 0.8;
      octx.stroke();
    }

    if (maxAtmosphere > 0) {
      const atm = atmosphereMap.get(id) ?? 0;
      if (atm > 0) {
        const atmosPx = (atm / maxAtmosphere) * 14;
        octx.beginPath();
        octx.arc(p.x, p.y, R + atmosPx, 0, Math.PI * 2);
        octx.strokeStyle = onPath ? 'rgba(96,165,250,0.3)' : 'rgba(147,197,253,0.15)';
        octx.lineWidth = 1;
        octx.setLineDash([2, 3]);
        octx.stroke();
        octx.setLineDash([]);
      }
    }

    octx.textAlign = 'center';
    octx.fillStyle = onPath ? '#e2e8f0' : '#999';
    octx.font = `${onPath ? '600' : '500'} ${onPath ? 12 : (isLarge ? 8 : 11)}px -apple-system, BlinkMacSystemFont, sans-serif`;
    octx.fillText(id, p.x, p.y + R + (isLarge ? 10 : 16));
  }

  layout.staticCanvas = off;
  layout.staticDirty = false;
  return off;
}

export default function UniverseCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const routeStartTimeRef = useRef<number>(0);
  const trailRef = useRef<TrailPoint[]>([]);
  const layoutRef = useRef<CachedLayout | null>(null);

  const drawNet = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    const state = useEngineStore.getState();
    const ids = state.nodeIds;
    const es = state.edges;
    const al = state.alive;
    const rp = state.routePath;
    const rr = state.routeResult;
    const cfg = state.config;
    const rs = state.routeStatus;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);

    if (!ids.length) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#333';
      ctx.font = "500 15px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText('Upload a config file to visualize the network', W / 2, H / 2);
      return;
    }

    let layout = layoutRef.current;
    const layoutValid = layout &&
      layout.nodeIds === ids &&
      layout.edges === es &&
      layout.routePath === rp &&
      layout.canvasW === W &&
      layout.canvasH === H;

    if (!layoutValid) {
      const wasmPositions = readPositionsFromWasm();
      const n = ids.length;
      const xs = new Float64Array(n);
      const ys = new Float64Array(n);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        xs[i] = wasmPositions[i * 2];
        ys[i] = wasmPositions[i * 2 + 1];
        if (xs[i] < minX) minX = xs[i];
        if (xs[i] > maxX) maxX = xs[i];
        if (ys[i] < minY) minY = ys[i];
        if (ys[i] > maxY) maxY = ys[i];
      }
      const pad = 80;
      const pos = ids.map((_, i) => ({
        x: (xs[i] - minX) / ((maxX - minX) || 1) * (W - pad * 2) + pad,
        y: H - ((ys[i] - minY) / ((maxY - minY) || 1) * (H - pad * 2) + pad),
      }));

      const codexMap = new Map<string, number>();
      const atmosphereMap = new Map<string, number>();
      let maxAtmosphere = 0;
      if (cfg?.nodes) {
        for (const node of cfg.nodes) {
          codexMap.set(node.id, node.codex);
          atmosphereMap.set(node.id, node.atmosphere_thickness_km);
          if (node.atmosphere_thickness_km > maxAtmosphere) {
            maxAtmosphere = node.atmosphere_thickness_km;
          }
        }
      }

      const pathEdges = new Set<string>();
      const onPathPlanets = new Set<number>();
      if (rp && rp.length > 1) {
        for (let k = 0; k < rp.length - 1; k++) {
          const a = Math.min(rp[k], rp[k + 1]);
          const b = Math.max(rp[k], rp[k + 1]);
          pathEdges.add(`${a},${b}`);
          onPathPlanets.add(rp[k]);
        }
        onPathPlanets.add(rp[rp.length - 1]);
      }

      layout = {
        pos, codexMap, atmosphereMap, maxAtmosphere, pathEdges, onPathPlanets,
        nodeIds: ids, edges: es, routePath: rp,
        canvasW: W, canvasH: H, staticCanvas: null, staticDirty: true,
      };
      layoutRef.current = layout;
    }

    const staticCanvas = buildStaticCanvas(ctx, layout, W, H);
    if (staticCanvas.width > 0 && staticCanvas.height > 0) {
      ctx.drawImage(staticCanvas, 0, 0);
    }

    const { pos, pathEdges, onPathPlanets, nodeIds } = layout;

    const isLargeDynamic = nodeIds.length > 50;
    if (!isLargeDynamic) {
      for (let k = 0; k < es.length; k += 2) {
        const ei = es[k], ej = es[k + 1];
        const iDead = !al[nodeIds[ei]];
        const jDead = !al[nodeIds[ej]];
        if (!iDead && !jDead) continue;
        if (ei * 4 + 1 >= pos.length || ej * 4 + 1 >= pos.length) continue;
        const aX = pos[ei * 4], aY = pos[ei * 4 + 1];
        const bX = pos[ej * 4], bY = pos[ej * 4 + 1];
        ctx.beginPath();
        ctx.moveTo(aX, aY);
        ctx.lineTo(bX, bY);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 0.6;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    for (let i = 0; i < nodeIds.length; i++) {
      const id = nodeIds[i], p = pos[i];
      const dead = !al[id];
      if (!dead) continue;
      const onPath = onPathPlanets.has(i);
      const R = onPath ? 28 : (isLargeDynamic ? 10 : 20);
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.5;
      const xSize = R * 0.6;
      ctx.beginPath();
      ctx.moveTo(p.x - xSize, p.y - xSize);
      ctx.lineTo(p.x + xSize, p.y + xSize);
      ctx.moveTo(p.x + xSize, p.y - xSize);
      ctx.lineTo(p.x - xSize, p.y + xSize);
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }

    if (rp && rp.length > 1) {
      ctx.beginPath();
      for (let k = 0; k < rp.length - 1; k++) {
        const a = pos[rp[k]], b = pos[rp[k + 1]];
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.strokeStyle = 'rgba(96,165,250,0.45)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }

    if (rp && rp.length > 1 && rr) {
      const hopLog = rr.hop_log;
      const segmentDurations: number[] = [];
      let totalLat = 0;
      for (let i = 0; i < rp.length - 1; i++) {
        const hopOrigin = hopLog[i];
        const hopDest = hopLog[i + 1];
        const tp = hopOrigin ? hopOrigin.tp_ms : 0;
        const tv = hopDest ? (hopDest.tv_from_prev_ms ?? 0) : 0;
        segmentDurations.push(tp + tv);
        totalLat += tp + tv;
      }
      const lastHop = hopLog[hopLog.length - 1];
      if (lastHop) totalLat += lastHop.tp_ms;
      if (totalLat <= 0) {
        for (let i = 0; i < segmentDurations.length; i++) segmentDurations[i] = 1;
        totalLat = segmentDurations.length;
      }

      const segmentStarts: number[] = [0];
      for (let i = 0; i < segmentDurations.length; i++) {
        segmentStarts.push(segmentStarts[i] + segmentDurations[i]);
      }

      const elapsed = Date.now() - routeStartTimeRef.current;
      const animTime = (elapsed % ANIMATION_TOTAL_MS);
      const scaledTime = (animTime / ANIMATION_TOTAL_MS) * totalLat;

      let segIdx = 0;
      for (let i = 0; i < segmentDurations.length; i++) {
        if (scaledTime >= segmentStarts[i] && scaledTime < segmentStarts[i + 1]) {
          segIdx = i;
          break;
        }
        if (i === segmentDurations.length - 1) segIdx = i;
      }

      const segDuration = segmentDurations[segIdx];
      const segStart = segmentStarts[segIdx];
      const frac = segDuration > 0 ? Math.min((scaledTime - segStart) / segDuration, 1) : 0;

      if (rp[segIdx] < pos.length && rp[segIdx + 1] < pos.length) {
        const a = pos[rp[segIdx]], b = pos[rp[segIdx + 1]];
        const px = a.x + (b.x - a.x) * frac;
        const py = a.y + (b.y - a.y) * frac;

        trailRef.current.push({ x: px, y: py });
        if (trailRef.current.length > 5) trailRef.current.shift();

        for (let t = 0; t < trailRef.current.length; t++) {
          const tp = trailRef.current[t];
          const alpha = 0.05 + (t / trailRef.current.length) * 0.15;
          const trailR = 2 + (t / trailRef.current.length) * 3;
          ctx.beginPath();
          ctx.arc(tp.x, tp.y, trailR, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(96,165,250,${alpha})`;
          ctx.fill();
        }

        const pglow = ctx.createRadialGradient(px, py, 0, px, py, 18);
        pglow.addColorStop(0, 'rgba(96,165,250,0.6)');
        pglow.addColorStop(0.5, 'rgba(96,165,250,0.2)');
        pglow.addColorStop(1, 'rgba(96,165,250,0)');
        ctx.fillStyle = pglow;
        ctx.beginPath();
        ctx.arc(px, py, 18, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(96,165,250,0.8)';
        ctx.fill();
      }
    }

    if (rs === 'undeliverable') {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(239,68,68,0.8)';
      ctx.font = '600 18px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillText('UNDELIVERABLE', W / 2, H / 2 - 10);
      ctx.font = '400 12px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = 'rgba(239,68,68,0.5)';
      ctx.fillText('No viable route exists between these planets', W / 2, H / 2 + 14);
    }
  }, []);

  const animate = useCallback(() => {
    drawNet();
    animRef.current = requestAnimationFrame(animate);
  }, [drawNet]);

  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.parentElement!.getBoundingClientRect();
      const newW = Math.floor(rect.width);
      const newH = Math.floor(rect.height);
      if (canvas.width !== newW || canvas.height !== newH) {
        canvas.width = newW;
        canvas.height = newH;
        if (layoutRef.current) layoutRef.current.staticDirty = true;
      }
      drawNet();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [drawNet]);

  useEffect(() => {
    const unsub = useEngineStore.subscribe((state, prev) => {
      if (state.routePath !== prev.routePath) {
        if (state.routePath && state.routePath.length > 1) {
          routeStartTimeRef.current = Date.now();
          trailRef.current = [];
          if (layoutRef.current) layoutRef.current.staticDirty = true;
          if (!animRef.current) {
            animRef.current = requestAnimationFrame(animate);
          }
        } else {
          if (animRef.current) cancelAnimationFrame(animRef.current);
          animRef.current = 0;
          trailRef.current = [];
          if (layoutRef.current) layoutRef.current.staticDirty = true;
          drawNet();
        }
      }
      if (state.nodeIds !== prev.nodeIds || state.edges !== prev.edges) {
        if (layoutRef.current) layoutRef.current.staticDirty = true;
        drawNet();
      }
      if (state.alive !== prev.alive || state.routeStatus !== prev.routeStatus) {
        drawNet();
      }
    });
    return () => {
      unsub();
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [animate, drawNet]);

  return (
    <canvas ref={canvasRef} />
  );
}
