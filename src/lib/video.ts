import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";

// Montador de vídeos de anuncio (9:16, 1080x1920) a partir de fotos de nuestro producto, copiando la forma de un vídeo
// de referencia: escenas con su duración, corte seco o fundido, zoom lento opcional, textos encima con sus tiempos y música.
// scale > 1 encuadra más cerca (1.6 = el producto ocupa más); focusY dice dónde mirar (0 arriba, 0.5 centro, 1 abajo).
export type Scene = { photo: string; seconds: number; zoom?: boolean; scale?: number; focusY?: number };
export type Caption = { text: string; from: number; to: number };
export type VideoPlan = { scenes: Scene[]; captions: Caption[]; transition?: "cut" | "fade" };

const W = 1080, H = 1920, FPS = 30, FADE = 0.4;
const FONT = path.join(process.cwd(), "src/fonts/Montserrat-Bold.ttf");
const run = promisify(execFile);

// La fuente solo tiene letras: los emojis se quitan del texto.
const noEmoji = (s: string) => s.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, "").replace(/\s+/g, " ").trim();
// Partir en líneas de ~22 caracteres para que quepa en el ancho del vídeo.
function wrap(s: string, max = 22) {
  const lines: string[] = [];
  for (const w of s.split(" ")) {
    const last = lines[lines.length - 1];
    if (last && (last + " " + w).length <= max) lines[lines.length - 1] = last + " " + w; else lines.push(w);
  }
  return lines.join("\n");
}

// Texto sobreimpreso como imagen (el ffmpeg de Vercel no trae el filtro de texto): letra negra en etiqueta blanca redondeada.
async function captionPng(text: string): Promise<Buffer> {
  const esc = wrap(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const t = sharp({ text: { text: `<span foreground="black">${esc}</span>`, font: "Montserrat Bold 46", fontfile: FONT, align: "center", rgba: true, dpi: 100 } });
  const { width = 600, height = 80 } = await t.metadata();
  const pad = 30, w = width + pad * 2, h = height + pad * 1.4;
  const box = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="18" fill="white"/></svg>`);
  return sharp(box).composite([{ input: await t.png().toBuffer(), left: pad, top: Math.round(pad * 0.7) }]).png().toBuffer();
}

async function fetchTo(url: string, file: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudo descargar ${url} (${r.status})`);
  await writeFile(file, Buffer.from(await r.arrayBuffer()));
}

export async function renderVideo(plan: VideoPlan, musicUrl?: string | null): Promise<Buffer> {
  if (!plan.scenes.length) throw new Error("El vídeo no tiene escenas.");
  const dir = await mkdtemp(path.join(tmpdir(), "video-"));
  try {
    const args: string[] = ["-y", "-loglevel", "error"];
    const fade = plan.transition === "fade";
    for (const [i, s] of plan.scenes.entries()) {
      const f = path.join(dir, `p${i}`);
      await fetchTo(s.photo, f);
      // Con fundido cada escena dura un poco más para que el solape no acorte el vídeo. Con zoom entra una sola imagen
      // (zoompan saca todos los fotogramas de ella); sin zoom, la imagen se repite durante la escena.
      if (s.zoom) args.push("-i", f);
      else args.push("-loop", "1", "-t", String(s.seconds + (fade && i < plan.scenes.length - 1 ? FADE : 0)), "-i", f);
    }
    const n = plan.scenes.length;
    const total = plan.scenes.reduce((t, s) => t + s.seconds, 0);
    if (musicUrl) { await fetchTo(musicUrl, path.join(dir, "music")); args.push("-i", path.join(dir, "music")); }

    const f: string[] = [];
    // Cada foto rellena el 9:16 (recorte centrado); con zoom, se acerca despacio.
    plan.scenes.forEach((s, i) => {
      const k = Math.min(3, Math.max(1, s.scale || 1)), fy = Math.min(1, Math.max(0, s.focusY ?? 0.5));
      const fill = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},crop=iw/${k}:ih/${k}:(iw-ow)/2:(ih-oh)*${fy},scale=${W}:${H},setsar=1`;
      const frames = Math.round((s.seconds + (fade ? FADE : 0)) * FPS);
      f.push(s.zoom
        ? `[${i}]${fill},scale=${W * 2}:${H * 2},zoompan=z='min(zoom+0.0012,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS}[v${i}]`
        : `[${i}]${fill},fps=${FPS}[v${i}]`);
    });
    if (fade && n > 1) {
      let prev = "v0", t = 0;
      for (let i = 1; i < n; i++) {
        t += plan.scenes[i - 1].seconds;
        f.push(`[${prev}][v${i}]xfade=transition=fade:duration=${FADE}:offset=${t.toFixed(2)}[x${i}]`);
        prev = `x${i}`;
      }
      f.push(`[${prev}]null[base]`);
    } else f.push(`${plan.scenes.map((_, i) => `[v${i}]`).join("")}concat=n=${n}:v=1[base]`);

    // Textos: etiqueta arriba, centrada, cada una en su tramo de tiempo.
    let last = "base", input = n + (musicUrl ? 1 : 0);
    for (const [i, c] of plan.captions.entries()) {
      const text = noEmoji(c.text);
      if (!text) continue;
      const cf = path.join(dir, `t${i}.png`);
      await writeFile(cf, await captionPng(text));
      args.push("-i", cf);
      f.push(`[${last}][${input}]overlay=x=(W-w)/2:y=110:enable='between(t,${c.from},${c.to})'[c${i}]`);
      last = `c${i}`; input++;
    }
    f.push(`[${last}]format=yuv420p[out]`);
    if (musicUrl) f.push(`[${n}:a]atrim=0:${total},afade=t=in:d=0.5,afade=t=out:st=${Math.max(0, total - 1)}:d=1,loudnorm=I=-16[aout]`);

    const out = path.join(dir, "out.mp4");
    args.push("-filter_complex", f.join(";"), "-map", "[out]");
    if (musicUrl) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "160k");
    args.push("-t", String(total), "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-movflags", "+faststart", out);
    await run(ffmpegPath as unknown as string, args, { maxBuffer: 1 << 24 });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
