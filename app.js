const workInput = document.querySelector("#work");
const restInput = document.querySelector("#rest");
const roundsInput = document.querySelector("#rounds");
const setupPanel = document.querySelector("#setup");
const sessionPanel = document.querySelector("#session");
const donePanel = document.querySelector("#done");
const labelEl = document.querySelector("#label");
const timeEl = document.querySelector("#time");
const roundEl = document.querySelector("#round");
const leftEl = document.querySelector("#left");
const summaryEl = document.querySelector("#summary");
const pauseBtn = document.querySelector("#pause");
const themeMeta = document.querySelector('meta[name="theme-color"]');

const themeColors = {
  idle: "#16171d",
  countdown: "#1c1917",
  work: "#c2410c",
  rest: "#155e75",
  done: "#166534",
};

const phaseLabels = {
  countdown: "Get ready",
  work: "Work",
  rest: "Rest",
};

const AudioContextClass = window.AudioContext || window.webkitAudioContext;

let audioCtx = null;
let wakeLock = null;
let timerId = null;

let mode = "idle";
let pausedFrom = null;
let round = 1;
let totalRounds = 8;
let workMs = 30000;
let restMs = 15000;
let phaseEndsAt = 0;
let remainingMs = 0;
let lastBeepSecond = null;

document.querySelectorAll(".stepper button").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.target);
    input.value = String(Number(input.value || input.min) + Number(button.dataset.delta));
    clampInput(input);
  });
});

[workInput, restInput, roundsInput].forEach((input) => {
  input.addEventListener("change", () => clampInput(input));
  input.addEventListener("blur", () => clampInput(input));
});

document.querySelector("#start").addEventListener("click", start);
pauseBtn.addEventListener("click", togglePause);
document.querySelector("#stop").addEventListener("click", stop);
document.querySelector("#back").addEventListener("click", stop);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && isWorkoutActive()) {
    requestWakeLock();
  }
});

function clampInput(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  let value = Math.round(Number(input.value));
  if (!Number.isFinite(value)) value = min;
  input.value = String(Math.min(max, Math.max(min, value)));
}

function readSettings() {
  [workInput, restInput, roundsInput].forEach(clampInput);
  workMs = Number(workInput.value) * 1000;
  restMs = Number(restInput.value) * 1000;
  totalRounds = Number(roundsInput.value);
}

function start() {
  readSettings();
  ensureAudio();
  requestWakeLock();
  round = 1;
  enterPhase("countdown", 3000, performance.now());
  startTicking();
}

function togglePause() {
  if (mode === "paused") {
    mode = pausedFrom;
    phaseEndsAt = performance.now() + remainingMs;
    startTicking();
    return;
  }
  remainingMs = Math.max(0, phaseEndsAt - performance.now());
  pausedFrom = mode;
  mode = "paused";
  stopTicking();
  render();
}

function stop() {
  mode = "idle";
  pausedFrom = null;
  stopTicking();
  releaseWakeLock();
  render();
}

function finish() {
  mode = "done";
  pausedFrom = null;
  stopTicking();
  releaseWakeLock();
  summaryEl.textContent =
    totalRounds === 1 ? "1 round complete" : `${totalRounds} rounds complete`;
  render();
}

function isWorkoutActive() {
  return mode === "countdown" || mode === "work" || mode === "rest" || mode === "paused";
}

function enterPhase(next, durationMs, startedAt) {
  mode = next;
  phaseEndsAt = startedAt + durationMs;
  lastBeepSecond = null;
}

function advance(playTone) {
  const endedAt = phaseEndsAt;
  if (mode === "countdown") {
    enterPhase("work", workMs, endedAt);
    return;
  }
  if (mode === "work") {
    if (playTone) playPhaseEnd();
    if (round >= totalRounds) {
      finish();
      return;
    }
    enterPhase("rest", restMs, endedAt);
    return;
  }
  if (mode === "rest") {
    if (playTone) playPhaseEnd();
    round += 1;
    enterPhase("work", workMs, endedAt);
  }
}

function startTicking() {
  stopTicking();
  timerId = setInterval(tick, 100);
  tick();
}

function stopTicking() {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}

function tick() {
  const now = performance.now();
  let guard = 0;
  while (
    (mode === "countdown" || mode === "work" || mode === "rest") &&
    now >= phaseEndsAt &&
    guard < 50
  ) {
    advance(now - phaseEndsAt < 500);
    guard += 1;
  }
  if (mode === "done" || mode === "idle" || mode === "paused") {
    render();
    return;
  }
  maybeBeep(phaseEndsAt - now);
  render();
}

function maybeBeep(remaining) {
  const secondsLeft = Math.ceil(remaining / 1000);
  const countingDown = mode === "countdown" || (mode === "rest" && secondsLeft <= 3);
  if (!countingDown || secondsLeft <= 0 || secondsLeft === lastBeepSecond) return;
  lastBeepSecond = secondsLeft;
  playCountdownBeep();
}

function render() {
  const screen = mode === "paused" ? pausedFrom : mode;
  document.body.dataset.screen = screen;
  document.body.dataset.paused = mode === "paused" ? "true" : "false";
  themeMeta.setAttribute("content", themeColors[screen] || themeColors.idle);

  setupPanel.hidden = mode !== "idle";
  sessionPanel.hidden = mode === "idle" || mode === "done";
  donePanel.hidden = mode !== "done";

  if (sessionPanel.hidden) return;

  const remaining = mode === "paused" ? remainingMs : phaseEndsAt - performance.now();
  const secondsLeft = Math.max(0, Math.ceil(remaining / 1000));
  const left = totalRounds - round + 1;

  labelEl.textContent = mode === "paused" ? "Paused" : phaseLabels[mode];
  timeEl.textContent = formatTime(secondsLeft);
  roundEl.textContent = `Round ${round} of ${totalRounds}`;
  leftEl.textContent = left === 1 ? "1 left" : `${left} left`;
  pauseBtn.textContent = mode === "paused" ? "Resume" : "Pause";
}

function formatTime(seconds) {
  if (seconds < 60) return String(seconds);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function ensureAudio() {
  if (!AudioContextClass) return;
  if (!audioCtx) audioCtx = new AudioContextClass();
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function playCountdownBeep() {
  tone(880, 0.12, "sine");
}

function playPhaseEnd() {
  tone(392, 0.28, "triangle");
  window.setTimeout(() => tone(294, 0.36, "triangle"), 150);
}

function tone(frequency, duration, type) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain).connect(audioCtx.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    wakeLock = null;
  }
}

async function releaseWakeLock() {
  if (!wakeLock) return;
  try {
    await wakeLock.release();
  } catch {
    /* already released */
  }
  wakeLock = null;
}
