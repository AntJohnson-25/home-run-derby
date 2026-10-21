// WebAudio synth: bat crack, swing whoosh, machine thunk + hum, net, crowd swell. No files.
let ctx = null, master = null, muted = false, level = 1, noiseBuf = null, hum = null;

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55 * level;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume();
}
// HopLobby owns volume and mute (its Esc menu): vol 0..1 (master x sfx), mute on/off.
export function setAudio(vol, mute) {
  level = Math.max(0, Math.min(1, vol));
  muted = !!mute;
  if (master) master.gain.value = muted ? 0 : 0.55 * level;
}
const live = () => ctx && !muted && ctx.state === "running";

function tone(freq, t0, dur, type, vol, slide) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type || "sine";
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol || 0.2, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
// Filtered noise burst. f/f2: filter frequency start/end; q: resonance.
function noise(t0, dur, type, f, f2, q, vol, attack) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const fl = ctx.createBiquadFilter();
  fl.type = type; fl.Q.value = q || 1;
  fl.frequency.setValueAtTime(f, t0);
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + (attack || 0.004));
  g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
  s.connect(fl); fl.connect(g); g.connect(master);
  s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.05);
}

export function sfx(name, k) {
  if (!live()) return;
  const t = ctx.currentTime;
  if (name === "swing") noise(t, 0.28, "bandpass", 500, 1800, 1.2, 0.22, 0.12);
  else if (name === "crack") {
    // k = quality 0..1: 1 = barrel (bright crack), 0 = off the handle (dull thud).
    const q = k == null ? 1 : k;
    noise(t, 0.09 + q * 0.05, "highpass", 1200 + q * 1800, 0, 0.7, 0.55 + q * 0.4, 0.001);
    tone(1500 + q * 900, t, 0.07 + q * 0.05, "triangle", 0.18 + q * 0.2);
    tone(180, t, 0.12, "sine", 0.35 - q * 0.15, 90);
  } else if (name === "thunk") { tone(140, t, 0.16, "sine", 0.4, 60); noise(t, 0.06, "lowpass", 900, 0, 1, 0.25); }
  else if (name === "net") noise(t, 0.22, "lowpass", 1400, 400, 0.8, 0.22 * (k || 1), 0.01);
  else if (name === "bounce") tone(320 + Math.random() * 120, t, 0.05, "sine", 0.08 * (k || 1));
  else if (name === "clang") { [620, 937, 1410].forEach((f) => tone(f, t, 0.6, "triangle", 0.12)); }
  else if (name === "ready") tone(880, t, 0.08, "sine", 0.06);
  else if (name === "hr") {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, t + 0.25 + i * 0.09, 0.35, "triangle", 0.16));
    noise(t, 2.4, "bandpass", 700, 1000, 0.5, 0.35, 0.6);   // the "ooooh" of a crowd that isn't there
  } else if (name === "good") [659, 784].forEach((f, i) => tone(f, t + 0.15 + i * 0.08, 0.25, "triangle", 0.12));
  else if (name === "whiff") tone(200, t + 0.15, 0.25, "sine", 0.08, 120);
  else if (name === "round") [392, 523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, t + i * 0.11, 0.35, "triangle", 0.15));
  else if (name === "click") tone(660, t, 0.05, "triangle", 0.1);
}

// The machine's motors: a low hum while a bucket is running.
export function machineHum(on) {
  if (!ctx) return;
  if (on && !hum) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = "sawtooth"; o.frequency.value = 58; o2.type = "sawtooth"; o2.frequency.value = 59.3;
    f.type = "lowpass"; f.frequency.value = 260;
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.045, ctx.currentTime + 0.8);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(master);
    o.start(); o2.start();
    hum = { o, o2, g };
  } else if (!on && hum) {
    const h = hum; hum = null;
    h.g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
    setTimeout(() => { h.o.stop(); h.o2.stop(); }, 800);
  }
}
