// ============================================================
// gameEngine.js — Bio-Lab Escape Room (IoT + Wireshark Game)
// ============================================================
// A multiplayer text-based escape room that simulates IoT sensor
// telemetry and Wireshark packet-filtering challenges. Runs
// entirely on the server and broadcasts events via Socket.io.
// ============================================================

const BOT_NAME = "Lab-System";

// ── Wireshark Question Bank ─────────────────────────────────
const QUESTIONS = [
  { q: "Filter for only HTTP traffic", a: "http" },
  { q: "Filter for TCP port 443", a: "tcp.port == 443" },
  { q: "Filter for IP address 10.0.0.5", a: "ip.addr == 10.0.0.5" },
  { q: "Filter for only DNS queries", a: "dns" },
  { q: "Filter for UDP traffic", a: "udp" },
  { q: "Filter for source IP 192.168.1.1", a: "ip.src == 192.168.1.1" },
  { q: "Filter for TCP SYN packets", a: "tcp.flags.syn == 1" },
  { q: "Filter for ICMP (ping) traffic", a: "icmp" },
  { q: "Filter for destination port 80", a: "tcp.dstport == 80" },
  { q: "Filter for ARP packets", a: "arp" },
];

const SECTORS = ["Sector A", "Sector B", "Sector C", "Sector D"];

// ── Per-room game state store ───────────────────────────────
const games = {}; // keyed by room name

function getDefaultState() {
  return {
    isActive: false,
    subjectLocation: "Sector A",
    temperature: 20,
    isLocked: false,
    activeQuestion: null,
    questionTimeout: null,
    penaltyInterval: null,
    telemetryInterval: null,
  };
}

// ── Helpers ─────────────────────────────────────────────────
function randomSector() {
  return SECTORS[Math.floor(Math.random() * SECTORS.length)];
}

function randomQuestion() {
  return QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
}

function formatTime() {
  const d = new Date();
  let h = d.getHours();
  let m = d.getMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  m = m < 10 ? "0" + m : m;
  return `${h}:${m} ${ampm}`;
}

/**
 * Emit a bot message to every socket in the room.
 * Uses the special "bot-message" event so the client can
 * distinguish it from encrypted user messages.
 */
function broadcast(io, room, text) {
  io.to(room).emit("bot-message", {
    n: BOT_NAME,
    t: formatTime(),
    m: text,
  });
}

// ── Cleanup ─────────────────────────────────────────────────
function clearAllTimers(state) {
  if (state.telemetryInterval) clearInterval(state.telemetryInterval);
  if (state.penaltyInterval) clearInterval(state.penaltyInterval);
  if (state.questionTimeout) clearTimeout(state.questionTimeout);
  state.telemetryInterval = null;
  state.penaltyInterval = null;
  state.questionTimeout = null;
}

function resetGame(room) {
  const state = games[room];
  if (state) {
    state.isActive = false;   // Kill any lingering closures that check this
    clearAllTimers(state);
  }
  games[room] = getDefaultState();
}

// ── Loss condition check ────────────────────────────────────
function checkMeltdown(io, room) {
  const state = games[room];
  if (!state || !state.isActive) return;
  if (state.temperature >= 45) {
    broadcast(
      io,
      room,
      "💥 CRITICAL FAILURE: Core temperature exceeded 45°C. Facility has exploded. All personnel lost."
    );
    resetGame(room);
  }
}

// ── Penalty Sequence ────────────────────────────────────────
function startPenalty(io, room) {
  const state = games[room];
  if (!state || !state.isActive) return;

  // Clear any existing penalty interval to prevent stacking
  if (state.penaltyInterval) {
    clearInterval(state.penaltyInterval);
    state.penaltyInterval = null;
  }

  broadcast(
    io,
    room,
    "❌ Override failed! Subject has escaped containment. Cooling system damaged. Temperature rising rapidly."
  );

  state.penaltyInterval = setInterval(() => {
    // Re-fetch the LIVE state from the map (not the closure)
    const current = games[room];
    if (!current || !current.isActive) {
      clearInterval(state.penaltyInterval);
      return;
    }
    current.temperature += 1;
    broadcast(
      io,
      room,
      `🔥 WARNING: Facility temperature at ${current.temperature}°C`
    );
    checkMeltdown(io, room);
  }, 3000);
}

// ── Command handlers ────────────────────────────────────────

function cmdInitiate(io, room) {
  resetGame(room);
  const state = games[room];
  state.isActive = true;
  state.subjectLocation = randomSector();

  broadcast(
    io,
    room,
    "🚨 BIO-LAB SIMULATION INITIATED. Subject Zero has escaped from cryo-containment. All personnel report to stations."
  );
  broadcast(
    io,
    room,
    `📡 IoT GRID ONLINE — Monitoring ${SECTORS.length} sectors. Current temperature: ${state.temperature}°C`
  );
  broadcast(
    io,
    room,
    "📋 COMMANDS: /lockdown [Sector A-D] → attempt containment  |  /answer [filter] → respond to Wireshark challenge  |  /vent-gas → neutralize subject after lockdown"
  );

  // Telemetry loop — every 10 seconds
  state.telemetryInterval = setInterval(() => {
    // Re-fetch the LIVE state from the map (not the closure)
    const current = games[room];
    if (!current || !current.isActive) {
      clearInterval(state.telemetryInterval);
      return;
    }
    current.subjectLocation = randomSector();
    broadcast(
      io,
      room,
      `📡 SENSOR TELEMETRY: Subject detected in ${current.subjectLocation}. Facility temp: ${current.temperature}°C`
    );
    checkMeltdown(io, room);
  }, 10000);
}

function cmdLockdown(io, room, sector) {
  const state = games[room];
  if (!state || !state.isActive) {
    return broadcast(io, room, "⚙️ No active simulation. Type /initiate-lab-simulation to begin.");
  }
  if (state.isLocked) {
    return broadcast(io, room, "🔒 Sector is already locked. Type /vent-gas to neutralize the subject.");
  }
  if (state.activeQuestion) {
    return broadcast(io, room, "⏳ An override challenge is already active. Type /answer [filter] to respond.");
  }

  const normalizedSector = sector.trim();
  if (!SECTORS.includes(normalizedSector)) {
    return broadcast(io, room, `❓ Unknown sector "${normalizedSector}". Valid sectors: ${SECTORS.join(", ")}`);
  }

  if (normalizedSector !== state.subjectLocation) {
    broadcast(
      io,
      room,
      `🔍 Lockdown failed — Subject is NOT in ${normalizedSector}. Wait for the next sensor telemetry update.`
    );
    return;
  }

  // Subject is in this sector — issue Wireshark challenge
  const q = randomQuestion();
  state.activeQuestion = q;

  broadcast(
    io,
    room,
    `⚠️ WIRESHARK OVERRIDE REQUIRED to seal ${normalizedSector}: "${q.q}" — You have 15 seconds. Type /answer [filter]`
  );

  state.questionTimeout = setTimeout(() => {
    if (!state.isActive) return;
    state.activeQuestion = null;
    startPenalty(io, room);
  }, 15000);
}

function cmdAnswer(io, room, answer) {
  const state = games[room];
  if (!state || !state.isActive) {
    return broadcast(io, room, "⚙️ No active simulation. Type /initiate-lab-simulation to begin.");
  }
  if (!state.activeQuestion) {
    return broadcast(io, room, "❓ No active override challenge right now.");
  }

  const correct = answer.trim().toLowerCase() === state.activeQuestion.a.toLowerCase();

  // Clear question state
  clearTimeout(state.questionTimeout);
  state.questionTimeout = null;
  state.activeQuestion = null;

  if (correct) {
    state.isLocked = true;
    broadcast(
      io,
      room,
      "✅ OVERRIDE ACCEPTED. Wireshark filter verified. Sector hermetically sealed. Subject contained."
    );
    broadcast(io, room, "🧪 Awaiting final command: Type /vent-gas to neutralize Subject Zero.");
  } else {
    broadcast(io, room, `❌ Incorrect filter. Expected: "${state.activeQuestion?.a ?? "unknown"}".`);
    startPenalty(io, room);
  }
}

function cmdVentGas(io, room) {
  const state = games[room];
  if (!state || !state.isActive) {
    return broadcast(io, room, "⚙️ No active simulation. Type /initiate-lab-simulation to begin.");
  }
  if (!state.isLocked) {
    return broadcast(
      io,
      room,
      "🔓 Cannot vent gas — sector is not locked. Use /lockdown [Sector] first."
    );
  }

  broadcast(
    io,
    room,
    "🎉 VICTORY: Sedative gas deployed. Subject Zero neutralized. Facility secured. Well done, agents!"
  );
  broadcast(
    io,
    room,
    `📊 FINAL REPORT — Facility temperature at shutdown: ${state.temperature}°C | Sectors scanned: ${SECTORS.length} | Threat level: CONTAINED`
  );
  resetGame(room);
}

function cmdAbort(io, room) {
  const state = games[room];
  if (!state || !state.isActive) {
    return broadcast(io, room, "⚙️ No active simulation to abort.");
  }
  broadcast(io, room, "🛑 SIMULATION ABORTED by operator command. All systems resetting.");
  resetGame(room);
}

// ── Main exported handler ───────────────────────────────────
/**
 * handleCommand — Called from socketio.js for every incoming message.
 *
 * @param {object}  io      The Socket.io Server instance.
 * @param {string}  room    The chat room the message was sent in.
 * @param {string}  text    The raw plaintext message string.
 * @returns {boolean}       true if the message was a game command
 *                          (so socketio.js should NOT broadcast it
 *                           as a normal encrypted message).
 */
function handleCommand(io, room, text) {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();

  if (trimmed === "/initiate-lab-simulation") {
    cmdInitiate(io, room);
    return true;
  }

  if (trimmed.startsWith("/lockdown ")) {
    const sector = trimmed.slice("/lockdown ".length);
    cmdLockdown(io, room, sector);
    return true;
  }

  if (trimmed.startsWith("/answer ")) {
    const answer = trimmed.slice("/answer ".length);
    cmdAnswer(io, room, answer);
    return true;
  }

  if (trimmed === "/vent-gas") {
    cmdVentGas(io, room);
    return true;
  }

  if (trimmed === "/abort-simulation") {
    cmdAbort(io, room);
    return true;
  }

  return false; // Not a game command — let normal chat flow continue
}

module.exports = { handleCommand, resetGame };
