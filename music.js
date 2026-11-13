// ===================== Generative lo-fi music =====================
// Every sound here is synthesized live with the Web Audio API —
// no audio files. A "scheduler" loop books notes slightly ahead of
// time so the rhythm stays tight even if JavaScript is busy.

const Music = (() => {
  const BPM = 70;
  const STEP = 60 / BPM / 2; // length of one 8th note in seconds
  const LOOKAHEAD = 1.2;     // seconds of music scheduled in advance

  // [bass note, chord voicing] as MIDI numbers — Am9, Fmaj7, Dm9, Em7
  const CHORDS = [
    [45, [60, 64, 67, 71]],
    [41, [57, 60, 64, 67]],
    [38, [53, 57, 60, 64]],
    [40, [55, 59, 62, 67]],
  ];
  const MELODY = [69, 72, 74, 76, 79, 81]; // A minor pentatonic

  let ctx, master, echo, noiseBuf;
  let timerId = null, stopTimeout = null;
  let step = 0, nextTime = 0, playing = false, volume = 0.5;

  const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);

  function setup() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Everything -> master volume -> lowpass filter (warm, muffled lo-fi tone) -> speakers
    master = ctx.createGain();
    master.gain.value = 0;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2400;
    master.connect(tone).connect(ctx.destination);

    // Echo effect for the piano notes (delay feeding back into itself)
    echo = ctx.createDelay();
    echo.delayTime.value = STEP * 3;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;
    const echoOut = ctx.createGain();
    echoOut.gain.value = 0.4;
    echo.connect(feedback).connect(echo);
    echo.connect(echoOut).connect(master);

    // 2 seconds of white noise, reused for drums and vinyl texture
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Constant soft vinyl hiss
    const hiss = ctx.createBufferSource();
    hiss.buffer = noiseBuf;
    hiss.loop = true;
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = "bandpass";
    hissFilter.frequency.value = 3000;
    hissFilter.Q.value = 0.5;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.012;
    hiss.connect(hissFilter).connect(hissGain).connect(master);
    hiss.start();
  }

  // ---------- Instruments ----------

  // Helper: a gain node with an attack/decay envelope
  function envelope(t, peak, attack, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  function pad(midi, t, dur) {
    // Two slightly detuned oscillators = a soft, chorus-y pad
    [-7, 7].forEach((detune) => {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = freq(midi);
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.03, t + 0.6);
      g.gain.setValueAtTime(0.03, t + dur - 0.6);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
  }

  function bass(midi, t, dur) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = freq(midi);
    const g = envelope(t, 0.2, 0.02, dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  function keys(midi, t) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = freq(midi);
    const g = envelope(t, 0.07, 0.01, 1.4);
    o.connect(g);
    g.connect(master);
    g.connect(echo);
    o.start(t);
    o.stop(t + 1.5);
  }

  function kick(t) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = envelope(t, 0.45, 0.005, 0.35);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.4);
  }

  // Short burst of filtered noise — used for snare, hi-hat and crackle
  function noise(t, type, cutoff, peak, decay) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = cutoff;
    const g = envelope(t, peak, 0.002, decay);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 1.5, decay + 0.05);
  }

  // ---------- Sequencer ----------

  function scheduleStep(s, t) {
    const pos = s % 8; // position inside the bar (8 eighth-notes)
    const [root, voicing] = CHORDS[Math.floor(s / 8) % CHORDS.length];
    if (pos % 2) t += STEP * 0.18; // swing: delay off-beats slightly

    if (pos === 0) {
      voicing.forEach((m) => pad(m, t, STEP * 8));
      bass(root, t, STEP * 3.5);
    }
    if (pos === 4) bass(root, t, STEP * 3);
    if (pos === 0 || pos === 5) kick(t);
    if (pos === 2 || pos === 6) noise(t, "bandpass", 1500, 0.1, 0.18); // snare
    noise(t, "highpass", 7000, pos % 2 ? 0.015 : 0.03, 0.05);         // hi-hat

    if (Math.random() < 0.28) keys(MELODY[Math.floor(Math.random() * MELODY.length)], t);
    if (Math.random() < 0.3) noise(t + Math.random() * STEP, "highpass", 2000, 0.04, 0.004); // crackle
  }

  function scheduler() {
    while (nextTime < ctx.currentTime + LOOKAHEAD) {
      scheduleStep(step, nextTime);
      step++;
      nextTime += STEP;
    }
  }

  function fadeTo(value, seconds) {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(value, now + seconds);
  }

  // ---------- Public API ----------

  function start() {
    if (playing) return;
    playing = true;
    if (!ctx) setup();
    ctx.resume();
    clearTimeout(stopTimeout);
    if (!timerId) {
      nextTime = ctx.currentTime + 0.1;
      timerId = setInterval(scheduler, 100);
    }
    fadeTo(volume, 2); // fade in
  }

  function stop() {
    if (!playing) return;
    playing = false;
    fadeTo(0, 1.2); // fade out, then actually stop
    stopTimeout = setTimeout(() => {
      clearInterval(timerId);
      timerId = null;
      ctx.suspend();
    }, 1300);
  }

  function setVolume(v) {
    volume = v;
    if (playing) master.gain.setTargetAtTime(v, ctx.currentTime, 0.1);
  }

  return { start, stop, setVolume };
})();
