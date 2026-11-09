// Web Audio sound player. Loops get a crossfade baked in so they repeat without a click.
// In capture mode every sound event is also logged with its time, so the recorder can
// put the same sounds into the exported video.
import { CAPTURE, clock } from './engine.js';

const LOOPS = new Set(['engine', 'ambience']);

export class Sfx {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.buf = {};
    this.muted = false;
    this.log = [];
    this.id = 0;
    window.__sfxLog = this.log;
  }

  async load(names, onEach) {
    await Promise.all(names.map(async (n) => {
      try {
        const ab = await (await fetch(`/assets/sfx/${n}.mp3`)).arrayBuffer();
        let b = await this.ctx.decodeAudioData(ab);
        if (LOOPS.has(n)) b = this.crossfade(b, 0.9);
        this.buf[n] = b;
      } catch (e) {
        console.warn('sound failed', n, e);
      }
      onEach && onEach();
    }));
  }

  unlock() {
    if (this.ctx.state !== 'running') this.ctx.resume();
  }

  crossfade(b, sec) {
    const sr = b.sampleRate, n = Math.floor(sec * sr), len = b.length - n;
    const out = this.ctx.createBuffer(b.numberOfChannels, len, sr);
    for (let ch = 0; ch < b.numberOfChannels; ch++) {
      const s = b.getChannelData(ch), d = out.getChannelData(ch);
      d.set(s.subarray(0, len));
      for (let i = 0; i < n; i++) {
        const t = i / n;
        d[i] = s[i] * t + s[len + i] * (1 - t);
      }
    }
    return out;
  }

  play(name, { vol = 1, rate = 1, loop = false } = {}) {
    const id = ++this.id;
    const self = this;
    if (CAPTURE) this.log.push({ ev: 'play', id, name, t: clock.now, vol, rate, loop });
    const b = this.buf[name];
    const dummy = { setRate() {}, setVol() {}, stop() {} };
    if (!b) return dummy;
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.loop = loop;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.master);
    src.start();
    let lastRate = rate, lastVol = vol, stopped = false;
    return {
      setRate(r) {
        src.playbackRate.setTargetAtTime(r, self.ctx.currentTime, 0.08);
        if (CAPTURE && Math.abs(r - lastRate) > 0.04) { self.log.push({ ev: 'rate', id, t: clock.now, rate: r }); lastRate = r; }
      },
      setVol(v, tc = 0.1) {
        g.gain.setTargetAtTime(v, self.ctx.currentTime, tc);
        if (CAPTURE && Math.abs(v - lastVol) > 0.04) { self.log.push({ ev: 'vol', id, t: clock.now, vol: v }); lastVol = v; }
      },
      stop(fade = 0.15) {
        if (stopped) return;
        stopped = true;
        g.gain.setTargetAtTime(0, self.ctx.currentTime, Math.max(0.01, fade / 3));
        try { src.stop(self.ctx.currentTime + fade + 0.05); } catch (e) { /* already stopped */ }
        if (CAPTURE) self.log.push({ ev: 'stop', id, t: clock.now });
      },
    };
  }

  setMuted(m) {
    this.muted = m;
    this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }
}
