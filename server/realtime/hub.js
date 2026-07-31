import { Room, PHASE, makeRoomCode, suggestNickname, sanitiseNick } from "./room.js";
import { loadDictionaries } from "../lib/words.js";
import { listTopics, getTopic, seedTopics } from "../lib/topics.js";
import { getSettings } from "../lib/settings.js";
import { query } from "../db/pool.js";
import config from "../config.js";

const TICK_MS = 500;
const HEARTBEAT_MS = 30_000;
const CUSTOM_ROOM_IDLE_MS = 10 * 60_000;
const OPEN_ROOM_IDLE_MS = 5 * 60_000;
const MAX_SOCKETS_PER_IP = 8;
const VOTE_OPTION_COUNT = 4;

/** code -> Room */
const rooms = new Map();
/** open rooms in reveal order; index 0 always exists */
const openRooms = [];
/** ip -> connection count */
const ipCounts = new Map();

let tickTimer = null;
let heartbeatTimer = null;
let started = false;

/* ---------- open room management ---------- */

function settings() {
  return getSettings().multiplayer;
}

function createOpenRoom(index) {
  const s = settings();
  const room = new Room({
    code: `OPEN${index + 1}`,
    kind: "open",
    index,
    label: `Open Room ${index + 1}`,
    format: "race",
    maxPlayers: Math.min(s.maxPlayersPerRoom, 50),
    wordsToWin: s.wordsToWin,
    durationSeconds: s.roundSeconds,
    voteSeconds: s.voteSeconds,
    lobbySeconds: s.lobbySeconds,
    region: "en",
    length: 5,
  });
  wireRoom(room);
  rooms.set(room.code, room);
  openRooms[index] = room;
  return room;
}

/**
 * Rooms are revealed one at a time: room 1 is always listed, and room N+1 only
 * appears once room N is at least `revealNextAtPercent` full. A room that still
 * has players stays visible so a match in progress is never hidden.
 */
function ensureOpenRooms() {
  const s = settings();
  const maxRooms = Math.min(s.maxOpenRooms, config.rooms.maxOpenRooms);

  if (!openRooms[0]) createOpenRoom(0);

  for (let i = 1; i < maxRooms; i++) {
    const prev = openRooms[i - 1];
    if (!prev) break;
    const prevBusy = prev.fillPercent >= s.revealNextAtPercent;
    if (prevBusy && !openRooms[i]) createOpenRoom(i);
    if (!prevBusy) break;
  }
}

function visibleOpenRooms() {
  const s = settings();
  ensureOpenRooms();

  const out = [];
  for (let i = 0; i < openRooms.length; i++) {
    const room = openRooms[i];
    if (!room) continue;
    if (i === 0 || room.isActive) {
      out.push(room);
      continue;
    }
    const prev = openRooms[i - 1];
    if (prev && prev.fillPercent >= s.revealNextAtPercent) out.push(room);
    else break;
  }
  return out;
}

export function listOpenRooms() {
  if (!settings().enabled) return [];
  return visibleOpenRooms().map((r) => r.describe());
}

/** The first visible open room with space; used by "Quick play". */
function bestOpenRoom() {
  const visible = visibleOpenRooms();
  return visible.find((r) => !r.isFull) || null;
}

/* ---------- custom rooms ---------- */

export function createCustomRoom(opts = {}) {
  const s = settings();
  const customCount = [...rooms.values()].filter((r) => r.kind === "custom").length;
  if (customCount >= config.rooms.maxCustomRooms) {
    return { error: "too_many_rooms", message: "Too many rooms right now, try again shortly." };
  }

  let code = makeRoomCode();
  let guard = 0;
  while (rooms.has(code) && guard++ < 20) code = makeRoomCode();
  if (rooms.has(code)) return { error: "code_collision" };

  const room = new Room({
    ...opts,
    code,
    kind: "custom",
    maxPlayers: Math.min(opts.maxPlayers ?? 8, s.maxPlayersPerRoom),
    lobbySeconds: s.lobbySeconds,
    voteSeconds: s.voteSeconds,
  });
  wireRoom(room);
  rooms.set(code, room);
  return { code, room };
}

export function describeRoom(code) {
  const room = rooms.get(String(code || "").toUpperCase());
  if (!room) return null;
  return room.describe();
}

/* ---------- shared room wiring ---------- */

function wireRoom(room) {
  room.pickVoteOptions = pickVoteOptions;
  room.loadTopic = (slug) => getTopic(slug);
  room.onMatchFinished = persistMatch;
}

/** CSGO-style map vote: a few real topics plus an always-present random option. */
async function pickVoteOptions(room) {
  const s = getSettings();
  const options = [];

  if (s.modes.topic) {
    const all = await listTopics({ region: room.region });
    if (all.length) {
      const pool = all.slice();
      // Bias towards popular topics without making the vote identical every round.
      pool.sort((a, b) => b.plays - a.plays);
      const head = pool.slice(0, Math.min(24, pool.length));
      for (let i = head.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        [head[i], head[j]] = [head[j], head[i]];
      }
      for (const t of head.slice(0, VOTE_OPTION_COUNT - 1)) {
        options.push({ slug: t.slug, name: t.name, icon: t.icon, category: t.category, count: t.count });
      }
    }
  }

  options.push({
    slug: "__random__",
    name: "Random Words",
    icon: "shuffle",
    category: "classic",
    count: 0,
  });

  return options;
}

async function persistMatch(room, standings, winner, reason) {
  if (!standings.length) return;
  // Never let analytics writing block or crash a live room.
  query(
    `INSERT INTO match_results
       (room_code, room_kind, format, region, topic_slug, player_count,
        winner_name, winner_score, duration_s, standings)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [
      room.code,
      room.kind,
      room.format,
      room.region,
      room.topicSlug,
      standings.length,
      winner?.nick || null,
      winner?.solved ?? null,
      room.durationSeconds,
      JSON.stringify(standings.slice(0, 20)),
    ]
  ).catch(() => {});
}

/* ---------- the single global tick ---------- */

function tick() {
  const now = Date.now();
  const s = settings();

  for (const room of [...rooms.values()]) {
    // Phase transitions
    if (room.phase === PHASE.LOBBY) {
      if (room.players.size >= (room.kind === "open" ? 1 : 2)) {
        if (!room.phaseEndsAt) {
          room.phaseEndsAt = now + room.lobbySeconds * 1000;
          room.broadcast({
            t: "lobby",
            startsAt: room.phaseEndsAt,
            seconds: room.lobbySeconds,
            players: room.players.size,
          });
        } else if (now >= room.phaseEndsAt) {
          if (room.kind === "open") room.startVoting().catch(logRoomError);
          else room.startRound(room.topicSlug ? { slug: room.topicSlug } : null).catch(logRoomError);
        }
      } else if (room.phaseEndsAt) {
        // Dropped below the minimum while counting down — hold.
        room.phaseEndsAt = 0;
        room.broadcast({ t: "lobby_hold", players: room.players.size });
      }
    } else if (room.phase === PHASE.VOTING) {
      if (now >= room.phaseEndsAt) {
        const choice = room.resolveVote();
        room.broadcast({ t: "vote_result", choice, tally: room.voteTally() });
        room.startRound(choice).catch(logRoomError);
      }
    } else if (room.phase === PHASE.PLAYING) {
      if (now >= room.phaseEndsAt) room.endRound("time");
      else if (room.players.size === 0) {
        room.phase = PHASE.LOBBY;
        room.phaseEndsAt = 0;
      }
    } else if (room.phase === PHASE.RESULTS) {
      if (now >= room.phaseEndsAt) {
        if (room.players.size === 0) {
          room.phase = PHASE.LOBBY;
          room.phaseEndsAt = 0;
        } else if (room.kind === "open") {
          room.startVoting().catch(logRoomError);
        } else {
          room.phase = PHASE.LOBBY;
          room.phaseEndsAt = 0;
          room.broadcast({ t: "lobby", startsAt: 0, players: room.players.size });
        }
      }
    }

    room.flushBoard(now);
  }

  // Reap idle rooms. Open room 0 is permanent so the lobby is never empty.
  for (const [code, room] of rooms) {
    if (room.players.size > 0) continue;
    const idleFor = now - (room.emptySince || room.lastActivityAt);
    if (room.kind === "custom" && idleFor > CUSTOM_ROOM_IDLE_MS) {
      rooms.delete(code);
    } else if (room.kind === "open" && room.index > 0 && idleFor > OPEN_ROOM_IDLE_MS) {
      rooms.delete(code);
      openRooms[room.index] = undefined;
      // Collapse trailing holes so reveal order stays contiguous.
      while (openRooms.length && !openRooms[openRooms.length - 1]) openRooms.pop();
    }
  }

  if (s.enabled) ensureOpenRooms();
}

function logRoomError(err) {
  console.error("[room] phase transition failed:", err?.message || err);
}

function heartbeat() {
  for (const room of rooms.values()) {
    for (const p of room.players.values()) {
      const sock = p.socket;
      if (!sock) continue;
      if (sock.isAlive === false) {
        try {
          sock.terminate();
        } catch {
          /* already gone */
        }
        continue;
      }
      sock.isAlive = false;
      try {
        sock.ping();
      } catch {
        /* ignore */
      }
    }
  }
}

/* ---------- websocket endpoint ---------- */

export async function registerRealtime(app) {
  await loadDictionaries();
  await seedTopics().catch((err) => console.warn("[topics] seed skipped:", err.message));

  app.get("/ws", { websocket: true }, (socket, req) => {
    const ip = req.ip || "unknown";
    const count = (ipCounts.get(ip) || 0) + 1;

    if (count > MAX_SOCKETS_PER_IP) {
      safeSend(socket, { t: "error", code: "too_many_connections" });
      socket.close(1008, "too many connections");
      return;
    }
    ipCounts.set(ip, count);

    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    let joined = null; // { room, player }
    let lastMessageAt = 0;
    let messageBudget = 0;

    const detach = () => {
      const n = (ipCounts.get(ip) || 1) - 1;
      if (n <= 0) ipCounts.delete(ip);
      else ipCounts.set(ip, n);

      if (joined) {
        joined.room.removePlayer(joined.player.id);
        joined = null;
      }
    };

    socket.on("close", detach);
    socket.on("error", detach);

    socket.on("message", (raw) => {
      // Cheap flood guard: 25 messages/second per socket, then drop.
      const now = Date.now();
      if (now - lastMessageAt > 1000) {
        lastMessageAt = now;
        messageBudget = 0;
      }
      if (++messageBudget > 25) return;

      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== "string") return;

      const s = getSettings();
      if (!s.modes.multiplayer || !s.multiplayer.enabled) {
        safeSend(socket, { t: "error", code: "disabled" });
        return;
      }

      switch (msg.t) {
        case "join": {
          if (joined) return;

          let room = null;
          if (msg.room === "quick" || !msg.room) {
            room = bestOpenRoom();
            if (!room) {
              safeSend(socket, { t: "error", code: "all_rooms_full" });
              return;
            }
          } else {
            room = rooms.get(String(msg.room).toUpperCase());
          }

          if (!room) {
            safeSend(socket, { t: "error", code: "room_not_found" });
            return;
          }

          const res = room.addPlayer({
            socket,
            nick: msg.nick,
            avatar: Number(msg.avatar),
          });
          if (res.error) {
            safeSend(socket, { t: "error", code: res.error });
            return;
          }

          joined = { room, player: res.player };

          safeSend(socket, {
            t: "joined",
            you: { id: res.player.id, nick: res.player.nick, avatar: res.player.avatar },
            room: room.describe(),
            board: room.boardPayload(),
            feed: room.feed.slice(-15),
            voteOptions: room.phase === PHASE.VOTING ? room.voteOptions : null,
            tally: room.phase === PHASE.VOTING ? room.voteTally() : null,
          });

          if (room.phase === PHASE.PLAYING) room.sendWord(res.player);
          room.boardDirty = true;
          break;
        }

        case "guess": {
          if (!joined) return;
          const out = joined.room.submitGuess(joined.player, msg.g);
          if (out.error) safeSend(socket, { t: "reject", code: out.error });
          break;
        }

        case "vote": {
          if (!joined) return;
          joined.room.castVote(joined.player.id, String(msg.topic || ""));
          break;
        }

        case "start": {
          // Any player may start a custom room once it has two people in it.
          if (!joined) return;
          const room = joined.room;
          if (room.kind !== "custom" || room.phase !== PHASE.LOBBY) return;
          if (room.players.size < 2) {
            safeSend(socket, { t: "error", code: "need_two_players" });
            return;
          }
          room.phaseEndsAt = Date.now();
          break;
        }

        case "leave": {
          if (!joined) return;
          joined.room.removePlayer(joined.player.id);
          joined = null;
          safeSend(socket, { t: "left" });
          break;
        }

        case "nick": {
          if (!joined) return;
          joined.player.nick = sanitiseNick(msg.nick);
          joined.room.boardDirty = true;
          safeSend(socket, { t: "nick_ok", nick: joined.player.nick });
          break;
        }

        case "ping":
          safeSend(socket, { t: "pong", now: Date.now() });
          break;

        default:
          break;
      }
    });

    safeSend(socket, {
      t: "hello",
      suggestedNick: suggestNickname(),
      rooms: listOpenRooms(),
      settings: {
        maxPlayers: settings().maxPlayersPerRoom,
        wordsToWin: settings().wordsToWin,
      },
    });
  });

  if (!started) {
    started = true;
    tickTimer = setInterval(tick, TICK_MS);
    tickTimer.unref?.();
    heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
    heartbeatTimer.unref?.();
    ensureOpenRooms();
  }
}

function safeSend(socket, msg) {
  try {
    if (socket.readyState === 1) socket.send(JSON.stringify(msg));
  } catch {
    /* ignore */
  }
}

export function shutdownRealtime() {
  if (tickTimer) clearInterval(tickTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  tickTimer = heartbeatTimer = null;
  started = false;

  for (const room of rooms.values()) {
    room.broadcast({ t: "server_shutdown" });
    for (const p of room.players.values()) {
      try {
        p.socket?.close(1001, "server restarting");
      } catch {
        /* ignore */
      }
    }
  }
  rooms.clear();
  openRooms.length = 0;
  ipCounts.clear();
}

export function hubStats() {
  const all = [...rooms.values()];
  return {
    rooms: all.length,
    open: all.filter((r) => r.kind === "open").length,
    custom: all.filter((r) => r.kind === "custom").length,
    players: all.reduce((n, r) => n + r.players.size, 0),
    detail: all.map((r) => r.describe()),
  };
}
