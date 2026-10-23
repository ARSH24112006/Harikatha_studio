const $ = (selector) => document.querySelector(selector);

const storyInput = $("#storyInput");
const scriptOutput = $("#scriptOutput");
const apiKeyInput = $("#apiKeyInput");
const transformButton = $("#transformButton");
const voiceButton = $("#voiceButton");
const scriptPanel = $(".script-panel");
const scriptEmpty = $("#scriptEmpty");
const scriptActions = $("#scriptActions");
const audioPanel = $("#audioPanel");
const audioPlayer = $("#audioPlayer");
const musicLevel = $("#musicLevel");
let mixedWav = null;
let currentAudioUrl = null;
let currentSpeechSegments = null;
let remixTimer = null;

function setStatus(element, message, state = "") {
  element.textContent = message;
  element.dataset.state = state;
}

function apiHeaders() {
  const key = apiKeyInput.value.trim();
  const headers = { "Content-Type": "application/json" };
  if (key) headers["X-OpenAI-API-Key"] = key;
  return headers;
}

function updateProviderMode() {
  const localMode = !apiKeyInput.value.trim();
  $("#voiceSelect").disabled = localMode;
  $("#voiceHint").textContent = localMode ? "Using the Windows built-in voice" : "Using the selected OpenAI voice";
  setStatus($("#transformStatus"), localMode
    ? "No key needed: local mode creates a same-language draft without cloud AI."
    : "Cloud AI is enabled for this session. Your key is not saved here.");
  setStatus($("#speechStatus"), localMode
    ? "Local mode uses your Windows speech voice; narration and music are mixed into a WAV."
    : "OpenAI narration and synthesized music will be mixed into a WAV.");
}

async function postJson(path, payload) {
  if (window.location.protocol === "file:") {
    throw new Error("This page was opened directly. Start Harikatha Studio with run.bat, then use http://127.0.0.1:8765.");
  }
  const response = await fetch(path, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify(payload),
  });
  let data;
  try { data = await response.json(); } catch { throw new Error("The local app returned an unreadable response."); }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function updateScriptState() {
  const hasScript = Boolean(scriptOutput.value.trim());
  scriptPanel.classList.toggle("has-script", hasScript);
  scriptEmpty.setAttribute("aria-hidden", hasScript ? "true" : "false");
  scriptActions.hidden = !hasScript;
  voiceButton.disabled = !hasScript;
  $("#scriptCount").textContent = `${scriptOutput.value.length.toLocaleString()} characters`;
}

function clearPerformance() {
  mixedWav = null;
  currentSpeechSegments = null;
  if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  currentAudioUrl = null;
  audioPlayer.removeAttribute("src");
  audioPlayer.load();
  audioPanel.hidden = true;
}

function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function safeFilename(value) {
  return value.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 48) || "harikatha";
}

function getTitle(text) {
  const firstLine = text.split(/\r?\n/, 1)[0].replace(/^#+\s*/, "").replace(/[*_`]/g, "").trim();
  return firstLine.slice(0, 60) || "harikatha-performance";
}

function base64ToArrayBuffer(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function decodeSegments(encodedSegments) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("This browser does not support audio mixing.");
  const decodeContext = new AudioContextClass();
  try {
    const result = [];
    for (const encoded of encodedSegments) {
      result.push(await decodeContext.decodeAudioData(base64ToArrayBuffer(encoded)));
    }
    return result;
  } finally {
    await decodeContext.close();
  }
}

function makeBell(context, atTime, bus, volume) {
  const notes = [880, 1320, 1760];
  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = index === 0 ? "sine" : "triangle";
    oscillator.frequency.value = frequency;
    const peak = volume * [0.045, 0.021, 0.009][index];
    envelope.gain.setValueAtTime(0.0001, atTime);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), atTime + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, atTime + 1.35 - index * 0.22);
    oscillator.connect(envelope);
    envelope.connect(bus);
    oscillator.start(atTime);
    oscillator.stop(atTime + 1.4);
  });
}

function addDrone(context, bus, baseFrequency, volume, duration, frequency, pan) {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  const panner = context.createStereoPanner ? context.createStereoPanner() : null;
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  envelope.gain.setValueAtTime(0.0001, 0);
  envelope.gain.linearRampToValueAtTime(volume, 1.7);
  envelope.gain.setValueAtTime(volume, Math.max(1.71, duration - 1.7));
  envelope.gain.linearRampToValueAtTime(0.0001, duration);
  oscillator.connect(envelope);
  if (panner) {
    panner.pan.value = pan;
    envelope.connect(panner);
    panner.connect(bus);
  } else {
    envelope.connect(bus);
  }
  oscillator.start(0);
  oscillator.stop(duration);
  // A quiet upper partial adds a little string-like shimmer to the steady drone.
  const overtone = context.createOscillator();
  const overtoneGain = context.createGain();
  overtone.type = "sine";
  overtone.frequency.value = frequency * 2;
  overtoneGain.gain.setValueAtTime(0.0001, 0);
  overtoneGain.gain.linearRampToValueAtTime(volume * 0.24, 1.7);
  overtoneGain.gain.setValueAtTime(volume * 0.24, Math.max(1.71, duration - 1.7));
  overtoneGain.gain.linearRampToValueAtTime(0.0001, duration);
  overtone.connect(overtoneGain);
  overtoneGain.connect(bus);
  overtone.start(0);
  overtone.stop(duration);
}

async function mixPerformance(encodedSegments) {
  const decoded = await decodeSegments(encodedSegments);
  const sampleRate = 44100;
  const gapSeconds = 0.16;
  const duration = decoded.reduce((total, segment) => total + segment.duration, 0) + gapSeconds * Math.max(0, decoded.length - 1);
  const totalFrames = Math.ceil(duration * sampleRate);
  const OfflineContextClass = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineContextClass) throw new Error("This browser cannot render the mixed audio file.");
  const context = new OfflineContextClass(2, totalFrames, sampleRate);
  let offset = 0;

  decoded.forEach((segment) => {
    const source = context.createBufferSource();
    source.buffer = segment;
    source.connect(context.destination);
    source.start(offset);
    offset += segment.duration + gapSeconds;
  });

  const musicBus = context.createGain();
  const level = Number(musicLevel.value) / 100;
  musicBus.gain.setValueAtTime(0, 0);
  musicBus.gain.linearRampToValueAtTime(level, Math.min(1.8, duration / 3));
  musicBus.gain.setValueAtTime(level, Math.max(1.81, duration - 1.8));
  musicBus.gain.linearRampToValueAtTime(0, duration);
  musicBus.connect(context.destination);

  const tonic = Number($("#tonicSelect").value);
  addDrone(context, musicBus, tonic, 0.12, duration, tonic, -0.45);
  addDrone(context, musicBus, tonic, 0.082, duration, tonic * 1.5, 0.35);
  addDrone(context, musicBus, tonic, 0.055, duration, tonic * 2, 0.05);
  for (let time = 5.5; time < duration - 1; time += 18) {
    makeBell(context, time, musicBus, Math.max(0.3, level));
  }

  const rendered = await context.startRendering();
  return audioBufferToWav(rendered);
}

function audioBufferToWav(buffer) {
  const channels = 2;
  const sampleRate = buffer.sampleRate;
  const frames = buffer.length;
  const dataBytes = frames * channels * 2;
  const arrayBuffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(arrayBuffer);
  const writeString = (offset, value) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataBytes, true);
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (const channel of [left[i], right[i]]) {
      const sample = Math.max(-1, Math.min(1, channel));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([arrayBuffer], { type: "audio/wav" });
}

storyInput.addEventListener("input", () => {
  $("#storyCount").textContent = `${storyInput.value.length.toLocaleString()} characters`;
});

scriptOutput.addEventListener("input", () => {
  updateScriptState();
  clearPerformance();
});

$("#exampleButton").addEventListener("click", () => {
  storyInput.value = "A young potter lived in a village beside a dry river. Each morning, she carried a small pot to the riverbed and waited, though everyone told her the water would never return. One day she noticed a line of ants carrying drops of water toward a crack in the earth. She followed the trail and found a spring hidden beneath a fallen stone. The villagers helped clear the spring, and water flowed again. The potter shared the first cup with the oldest neighbor, who had once laughed at her hope. The village remembered that patient attention can find what pride overlooks.";
  storyInput.dispatchEvent(new Event("input"));
  storyInput.focus();
});

$("#toggleKey").addEventListener("click", (event) => {
  const show = apiKeyInput.type === "password";
  apiKeyInput.type = show ? "text" : "password";
  event.currentTarget.textContent = show ? "Hide" : "Show";
  event.currentTarget.setAttribute("aria-label", show ? "Hide API key" : "Show API key");
});

transformButton.addEventListener("click", async () => {
  transformButton.disabled = true;
  const localMode = !apiKeyInput.value.trim();
  setStatus($("#transformStatus"), localMode ? "Shaping a local Harikatha-style draft…" : "Listening to the story and shaping the telling…", "busy");
  try {
    const data = await postJson("/api/transform", {
      story: storyInput.value,
      language: $("#languageInput").value.trim() || "Same as the story",
      tone: $("#toneSelect").value,
      minutes: Number($("#durationSelect").value),
    });
    scriptOutput.value = data.script;
    updateScriptState();
    clearPerformance();
    setStatus($("#transformStatus"), data.provider === "windows-local"
      ? "Local draft ready. It keeps the story's language and plot; you can edit it before speaking."
      : "Script ready. Read it, make it yours, then create the spoken performance.", "success");
    scriptOutput.focus();
  } catch (error) {
    setStatus($("#transformStatus"), error.message, "error");
  } finally {
    transformButton.disabled = false;
  }
});

voiceButton.addEventListener("click", async () => {
  voiceButton.disabled = true;
  clearPerformance();
  const localMode = !apiKeyInput.value.trim();
  setStatus($("#speechStatus"), localMode ? "Generating narration with the Windows speech voice…" : "The storyteller is warming up; composing each passage…", "busy");
  try {
    const data = await postJson("/api/speech", {
      script: scriptOutput.value,
      voice: $("#voiceSelect").value,
      language: $("#languageInput").value.trim() || "the script's language",
    });
    currentSpeechSegments = data.segments;
    setStatus($("#speechStatus"), "Mixing the voice with the tanpura-inspired music bed…", "busy");
    mixedWav = await mixPerformance(data.segments);
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = URL.createObjectURL(mixedWav);
    audioPlayer.src = currentAudioUrl;
    audioPanel.hidden = false;
    setStatus($("#speechStatus"), data.provider === "windows-local"
      ? "Local narration is ready with the music bed. Play or download the WAV."
      : "Your audio performance is ready to play and download.", "success");
    audioPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    setStatus($("#speechStatus"), error.message, "error");
  } finally {
    voiceButton.disabled = !scriptOutput.value.trim();
  }
});

$("#copyScript").addEventListener("click", async (event) => {
  try {
    await navigator.clipboard.writeText(scriptOutput.value);
    event.currentTarget.textContent = "Copied";
    setTimeout(() => { event.currentTarget.textContent = "Copy text"; }, 1500);
  } catch {
    scriptOutput.focus();
    scriptOutput.select();
    setStatus($("#speechStatus"), "Select and copy the script text.", "");
  }
});

$("#downloadScript").addEventListener("click", () => {
  downloadBlob(new Blob([scriptOutput.value], { type: "text/plain;charset=utf-8" }), `${safeFilename(getTitle(scriptOutput.value))}.txt`);
});

$("#downloadAudio").addEventListener("click", () => {
  if (!mixedWav) return;
  downloadBlob(mixedWav, `${safeFilename(getTitle(scriptOutput.value))}.wav`);
});

musicLevel.addEventListener("input", () => {
  $("#musicLevelLabel").textContent = `${musicLevel.value}%`;
  scheduleRemix();
});

apiKeyInput.addEventListener("input", updateProviderMode);

$("#tonicSelect").addEventListener("change", scheduleRemix);

function scheduleRemix() {
  if (!currentSpeechSegments || audioPanel.hidden) return;
  clearTimeout(remixTimer);
  remixTimer = setTimeout(async () => {
    const downloadButton = $("#downloadAudio");
    const previousTime = audioPlayer.currentTime;
    const wasPlaying = !audioPlayer.paused;
    downloadButton.disabled = true;
    setStatus($("#speechStatus"), "Updating the accompaniment mix in this browser…", "busy");
    try {
      mixedWav = await mixPerformance(currentSpeechSegments);
      if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
      currentAudioUrl = URL.createObjectURL(mixedWav);
      audioPlayer.src = currentAudioUrl;
      audioPlayer.addEventListener("loadedmetadata", () => {
        audioPlayer.currentTime = Math.min(previousTime, Math.max(0, audioPlayer.duration - 0.1));
        if (wasPlaying) audioPlayer.play().catch(() => {});
      }, { once: true });
      setStatus($("#speechStatus"), "Accompaniment updated. Download the refreshed WAV when ready.", "success");
    } catch (error) {
      setStatus($("#speechStatus"), error.message, "error");
    } finally {
      downloadButton.disabled = false;
    }
  }, 350);
}

updateScriptState();
updateProviderMode();
