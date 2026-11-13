// ===================== Settings & state =====================

const DEFAULTS = { focus: 25, short: 5, long: 15, every: 4, sound: true, auto: false };

// Load saved settings from the browser (falls back to defaults)
function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("pomo-settings")) };
  } catch {
    return { ...DEFAULTS };
  }
}

let settings = loadSettings();

const LABELS = { focus: "Time to focus", short: "Take a breather", long: "Enjoy a long break" };

const state = {
  mode: "focus",
  remaining: settings.focus * 60, // seconds left
  total: settings.focus * 60,     // seconds in this session
  running: false,
  endTime: null,                  // timestamp when the timer hits 0
  intervalId: null,
  completed: 0,                   // focus sessions finished today
};

// Restore today's completed count
try {
  const saved = JSON.parse(localStorage.getItem("pomo-count"));
  if (saved && saved.date === new Date().toDateString()) state.completed = saved.count;
} catch {}

// ===================== DOM references =====================

const $ = (id) => document.getElementById(id);
const timeEl = $("time");
const labelEl = $("label");
const ringEl = $("ringProgress");
const startBtn = $("startBtn");
const startText = $("startText");
const dotsEl = $("dots");
const countEl = $("count");
const card = document.querySelector(".card");
const pill = document.querySelector(".pill");
const modeBtns = document.querySelectorAll(".mode");

const CIRCUMFERENCE = 2 * Math.PI * 130; // matches r="130" in the SVG

// ===================== Rendering =====================

function format(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function render() {
  const t = format(state.remaining);
  timeEl.textContent = t;
  labelEl.textContent = LABELS[state.mode];

  // Shrink the ring as time passes
  const progress = state.remaining / state.total;
  ringEl.style.strokeDashoffset = CIRCUMFERENCE * (1 - progress);

  startText.textContent = state.running ? "Pause" : state.remaining < state.total ? "Resume" : "Start";
  document.body.classList.toggle("running", state.running);

  // Show the countdown in the browser tab
  const icon = state.mode === "focus" ? "🍅" : "☕";
  document.title = state.running ? `${t} ${icon} Pomodoro` : "Pomodoro";

  renderDots();
}

function renderDots() {
  const filled = state.completed % settings.every;
  // Once a full cycle is done, show all dots filled during the long break
  const show = filled === 0 && state.completed > 0 && state.mode === "long" ? settings.every : filled;
  dotsEl.innerHTML = "";
  for (let i = 0; i < settings.every; i++) {
    const d = document.createElement("span");
    d.className = "dot" + (i < show ? " done" : "");
    dotsEl.appendChild(d);
  }
  countEl.textContent = state.completed;
}

function movePill() {
  const index = ["focus", "short", "long"].indexOf(state.mode);
  pill.style.transform = `translateX(${index * 100}%)`;
  modeBtns.forEach((b) => b.classList.toggle("active", b.dataset.mode === state.mode));
  document.body.dataset.mode = state.mode;
}

// ===================== Timer logic =====================

function tick() {
  // Calculate from the real clock so the timer stays accurate
  // even if the browser slows down background tabs.
  state.remaining = Math.max(0, Math.round((state.endTime - Date.now()) / 1000));
  render();
  if (state.remaining === 0) finish();
}

function start() {
  if (state.running) return;
  state.running = true;
  state.endTime = Date.now() + state.remaining * 1000;
  state.intervalId = setInterval(tick, 250);
  render();
}

function pause() {
  state.running = false;
  clearInterval(state.intervalId);
  render();
}

function reset() {
  pause();
  state.remaining = state.total;
  render();
}

function setMode(mode) {
  pause();
  state.mode = mode;
  state.total = settings[mode] * 60;
  state.remaining = state.total;
  movePill();
  render();
}

function nextMode() {
  if (state.mode === "focus") {
    return state.completed > 0 && state.completed % settings.every === 0 ? "long" : "short";
  }
  return "focus";
}

function finish() {
  pause();
  if (state.mode === "focus") {
    state.completed++;
    localStorage.setItem("pomo-count", JSON.stringify({ date: new Date().toDateString(), count: state.completed }));
  }
  if (settings.sound) chime();
  notify();
  card.classList.remove("celebrate");
  void card.offsetWidth; // restart the CSS animation
  card.classList.add("celebrate");

  setMode(nextMode());
  if (settings.auto) start();
}

function skip() {
  setMode(nextMode());
}

// ===================== Sound & notifications =====================

// A soft three-note chime generated with the Web Audio API (no sound file needed)
function chime() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = ctx.currentTime + i * 0.18;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 1.3);
  });
}

function notify() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const msg = state.mode === "focus" ? "Focus session done — take a break!" : "Break's over — back to focus!";
  new Notification("Pomodoro", { body: msg });
}

// ===================== Settings modal =====================

const modal = $("modal");
const fields = { focus: $("setFocus"), short: $("setShort"), long: $("setLong"), every: $("setEvery") };

function openSettings() {
  for (const k in fields) fields[k].value = settings[k];
  $("setSound").checked = settings.sound;
  $("setAuto").checked = settings.auto;
  modal.hidden = false;
}

function saveSettings() {
  for (const k in fields) {
    const v = parseInt(fields[k].value, 10);
    if (v > 0) settings[k] = v;
  }
  settings.sound = $("setSound").checked;
  settings.auto = $("setAuto").checked;
  localStorage.setItem("pomo-settings", JSON.stringify(settings));
  modal.hidden = true;
  setMode(state.mode); // apply new durations
}

// ===================== Events =====================

startBtn.addEventListener("click", () => {
  // Ask for notification permission on first interaction
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  state.running ? pause() : start();
});
$("resetBtn").addEventListener("click", reset);
$("skipBtn").addEventListener("click", skip);
modeBtns.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

$("settingsBtn").addEventListener("click", openSettings);
$("cancelBtn").addEventListener("click", () => (modal.hidden = true));
$("saveBtn").addEventListener("click", saveSettings);
modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });

document.addEventListener("keydown", (e) => {
  if (!modal.hidden) {
    if (e.key === "Escape") modal.hidden = true;
    return;
  }
  if (e.target.tagName === "INPUT") return;
  if (e.code === "Space") { e.preventDefault(); startBtn.click(); }
  if (e.key === "r" || e.key === "R") reset();
  if (e.key === "s" || e.key === "S") skip();
});

// ===================== Init =====================
movePill();
render();
