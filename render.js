/* MedUz intro renderer — frame-exact MP4 via Playwright + ffmpeg.
   Loads intro.html, scrubs window.__seek(t) frame by frame, screenshots
   each frame, then encodes to H.264 MP4. Deterministic (no rAF timing). */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT   = __dirname;
const OUT    = path.join(ROOT, 'out');
const FRAMES = path.join(OUT, 'frames');
const W = 1080, H = 1920;
const CHROME  = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FFMPEG  = 'ffmpeg'; // system ffmpeg (libx264). Falls back if not on PATH.

(async () => {
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'],
  });
  const page = await browser.newPage({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
  });

  await page.goto('file://' + path.join(ROOT, 'intro.html'), { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 8000 });

  const fps      = await page.evaluate('window.__FPS');
  const duration = await page.evaluate('window.__DURATION');
  const total    = Math.round(duration * fps); // frames
  await page.evaluate('window.__stopPreview && window.__stopPreview()');

  console.log(`Rendering ${total} frames @ ${fps}fps (${duration}s), ${W}x${H}`);

  for (let f = 0; f < total; f++) {
    const t = f / fps;
    await page.evaluate((tt) => window.__seek(tt), t);
    const name = String(f).padStart(4, '0') + '.png';
    await page.screenshot({
      path: path.join(FRAMES, name),
      clip: { x: 0, y: 0, width: W, height: H },
    });
    if (f % 30 === 0) console.log(`  frame ${f}/${total}  (t=${t.toFixed(3)}s)`);
  }
  await browser.close();
  console.log('Frames done. Encoding MP4…');

  const mp4 = path.join(OUT, 'meduz-intro.mp4');
  const args = [
    '-y', '-framerate', String(fps),
    '-i', path.join(FRAMES, '%04d.png'),
    '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-crf', '17', '-preset', 'slow',
    '-movflags', '+faststart',
    '-vf', 'scale=' + W + ':' + H + ':flags=lanczos',
    mp4,
  ];
  const r = spawnSync(FFMPEG, args, { stdio: 'inherit' });
  if (r.status !== 0) { console.error('ffmpeg failed'); process.exit(1); }

  const sz = (fs.statSync(mp4).size / 1024 / 1024).toFixed(2);
  console.log(`\n✅ ${mp4}  (${sz} MB, ${total} frames)`);
})().catch((e) => { console.error(e); process.exit(1); });
