const workInput = document.querySelector("#work");
const restInput = document.querySelector("#rest");
const roundsInput = document.querySelector("#rounds");
const setupPanel = document.querySelector("#setup");
const presetsPanel = document.querySelector("#presets");
const editorPanel = document.querySelector("#editor");
const sessionPanel = document.querySelector("#session");
const donePanel = document.querySelector("#done");
const presetList = document.querySelector("#preset-list");
const presetEmpty = document.querySelector("#preset-empty");
const presetLimit = document.querySelector("#preset-limit");
const addPresetBtn = document.querySelector("#add-preset");
const editorTitle = document.querySelector("#editor-title");
const presetName = document.querySelector("#preset-name");
const presetWork = document.querySelector("#preset-work");
const presetRest = document.querySelector("#preset-rest");
const presetRounds = document.querySelector("#preset-rounds");
const presetError = document.querySelector("#preset-error");
const deletePresetBtn = document.querySelector("#delete-preset");
const labelEl = document.querySelector("#label");
const timeEl = document.querySelector("#time");
const ringEl = document.querySelector("#ring");
const ringSvg = document.querySelector(".ring");
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
const PRESET_KEY = "interval-presets";
const MAX_PRESETS = 5;
const PENCIL_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;

let audioCtx = null;
let wakeLock = null;
let timerId = null;

let mode = "idle";
let view = "setup";
let presets = loadPresets();
let editingId = null;
let pausedFrom = null;
let round = 1;
let totalRounds = 8;
let workMs = 30000;
let restMs = 15000;
let phaseEndsAt = 0;
let phaseDurationMs = 0;
let remainingMs = 0;
let lastBeepSecond = null;

document.querySelectorAll(".stepper button").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.target);
    input.value = String(Number(input.value || input.min) + Number(button.dataset.delta));
    clampInput(input);
  });
});

document.querySelectorAll(".stepper input").forEach((input) => {
  input.addEventListener("change", () => clampInput(input));
  input.addEventListener("blur", () => clampInput(input));
});

document.querySelector("#start").addEventListener("click", start);
document.querySelector("#open-presets").addEventListener("click", () => showView("presets"));
document.querySelector("#presets-back").addEventListener("click", () => showView("setup"));
document.querySelector("#editor-back").addEventListener("click", () => showView("presets"));
addPresetBtn.addEventListener("click", () => openEditor(null));
document.querySelector("#save-preset").addEventListener("click", savePreset);
deletePresetBtn.addEventListener("click", deletePreset);
presetName.addEventListener("input", () => {
  presetError.hidden = true;
});
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
  phaseDurationMs = durationMs;
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

  setupPanel.hidden = mode !== "idle" || view !== "setup";
  presetsPanel.hidden = mode !== "idle" || view !== "presets";
  editorPanel.hidden = mode !== "idle" || view !== "editor";
  sessionPanel.hidden = mode === "idle" || mode === "done";
  donePanel.hidden = mode !== "done";

  if (sessionPanel.hidden) return;

  const remaining = mode === "paused" ? remainingMs : phaseEndsAt - performance.now();
  const secondsLeft = Math.max(0, Math.ceil(remaining / 1000));
  const left = totalRounds - round + 1;

  labelEl.textContent = mode === "paused" ? "Paused" : phaseLabels[mode];
  timeEl.textContent = formatTime(secondsLeft);
  drawRing(screen, remaining);
  roundEl.textContent = `Round ${round} of ${totalRounds}`;
  leftEl.textContent = left === 1 ? "1 left" : `${left} left`;
  pauseBtn.textContent = mode === "paused" ? "Resume" : "Pause";
}

function drawRing(screen, remaining) {
  const active = screen === "work" || screen === "rest";
  ringSvg.hidden = !active;
  if (!active || phaseDurationMs <= 0) return;

  const progress = Math.min(1, Math.max(0, 1 - remaining / phaseDurationMs));
  const drawn = progress >= 1 ? 1 : Math.max(progress, 0.012);
  ringEl.style.strokeDasharray = `${drawn} 1`;
}

function showView(next) {
  view = next;
  if (next === "presets") renderPresetList();
  render();
}

function loadPresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PRESET_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPreset).slice(0, MAX_PRESETS);
  } catch {
    return [];
  }
}

function isPreset(preset) {
  return Boolean(
    preset &&
      typeof preset.id === "string" &&
      typeof preset.name === "string" &&
      preset.name.trim() &&
      Number.isFinite(preset.work) &&
      Number.isFinite(preset.rest) &&
      Number.isFinite(preset.rounds)
  );
}

function persistPresets() {
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
}

function renderPresetList() {
  presetList.replaceChildren();
  presetEmpty.hidden = presets.length > 0;
  addPresetBtn.hidden = presets.length >= MAX_PRESETS;
  presetLimit.hidden = presets.length < MAX_PRESETS;

  presets.forEach((preset) => {
    const item = document.createElement("li");
    item.className = "preset-row";

    const useBtn = document.createElement("button");
    useBtn.type = "button";
    useBtn.className = "preset-load";
    const name = document.createElement("span");
    name.className = "preset-name";
    name.textContent = preset.name;
    const meta = document.createElement("span");
    meta.className = "preset-meta";
    meta.textContent = `${preset.work}s work · ${preset.rest}s rest · ${preset.rounds} rounds`;
    useBtn.append(name, meta);
    useBtn.addEventListener("click", () => applyPreset(preset.id));

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "icon-btn";
    editBtn.setAttribute("aria-label", `Edit ${preset.name}`);
    editBtn.innerHTML = PENCIL_SVG;
    editBtn.addEventListener("click", () => openEditor(preset.id));

    item.append(useBtn, editBtn);
    presetList.append(item);
  });
}

function openEditor(id) {
  if (!id && presets.length >= MAX_PRESETS) return;
  editingId = id;
  const preset = presets.find((item) => item.id === id);
  editorTitle.textContent = preset ? "Edit preset" : "New preset";
  deletePresetBtn.hidden = !preset;
  presetError.hidden = true;
  presetName.value = preset ? preset.name : "";
  presetWork.value = String(preset ? preset.work : workInput.value);
  presetRest.value = String(preset ? preset.rest : restInput.value);
  presetRounds.value = String(preset ? preset.rounds : roundsInput.value);
  showView("editor");
}

function savePreset() {
  [presetWork, presetRest, presetRounds].forEach(clampInput);
  const name = presetName.value.trim();
  if (!name) {
    presetError.hidden = false;
    return;
  }

  const next = {
    id: editingId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    name,
    work: Number(presetWork.value),
    rest: Number(presetRest.value),
    rounds: Number(presetRounds.value),
  };

  if (editingId) {
    presets = presets.map((item) => (item.id === editingId ? next : item));
  } else if (presets.length < MAX_PRESETS) {
    presets = [...presets, next];
  }

  persistPresets();
  showView("presets");
}

function deletePreset() {
  presets = presets.filter((item) => item.id !== editingId);
  editingId = null;
  persistPresets();
  showView("presets");
}

function applyPreset(id) {
  const preset = presets.find((item) => item.id === id);
  if (!preset) return;
  workInput.value = String(preset.work);
  restInput.value = String(preset.rest);
  roundsInput.value = String(preset.rounds);
  showView("setup");
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
