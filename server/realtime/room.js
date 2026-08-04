import { randomBytes } from "node:crypto";
import {
  wordSequence,
  isValidGuess,
  evaluate,
  encodePattern,
} from "../lib/words.js";
import { defaultClue, ensureClue } from "../lib/topics.js";

export const PHASE = {
  LOBBY: "lobby",
  PLAYING: "playing",
  RESULTS: "results",
  VOTING: "voting",
};

const MAX_GUESSES = 6;
const BOARD_FLUSH_MS = 500;
// Must match the AV list in public/src/multiplayer.js.
const AVATAR_COUNT = 24;

/* Nicknames are the first thing anyone sees in a room, so the pool is wide
   enough that a 50-player lobby rarely collides: 96 x 96 pairs, and a number is
   only appended when it has to be. */
const ADJECTIVES = [
  "Swift", "Brave", "Clever", "Silent", "Golden", "Rapid", "Lucky", "Sharp",
  "Cosmic", "Neon", "Turbo", "Mighty", "Wild", "Sly", "Bold", "Frosty",
  "Crimson", "Shadow", "Atomic", "Rogue", "Quantum", "Stealth", "Blazing", "Iron",
  "Velvet", "Obsidian", "Electric", "Feral", "Lunar", "Solar", "Arctic", "Ember",
  "Midnight", "Savage", "Gilded", "Prime", "Vivid", "Storm", "Titan", "Onyx",
  "Radiant", "Nimble", "Ghost", "Chrome", "Scarlet", "Astral", "Wicked", "Nova",
  "Thunder", "Frantic", "Grim", "Jade", "Crystal", "Phantom", "Feisty", "Zen",
  "Hyper", "Cobalt", "Ruthless", "Dizzy", "Sonic", "Amber", "Fearless", "Sublime",
  "Rebel", "Cyber", "Marble", "Reckless", "Noble", "Plasma", "Steel", "Vortex",
  "Crafty", "Epic", "Furious", "Glacial", "Hollow", "Infinite", "Jolly", "Keen",
  "Lethal", "Mystic", "Nordic", "Opal", "Primal", "Quiet", "Royal", "Sterling",
  "Twilight", "Umbral", "Valiant", "Warp", "Zealous", "Blitz", "Dusk", "Echo",
];
const NOUNS = [
  "Falcon", "Tiger", "Comet", "Otter", "Panther", "Raven", "Fox", "Wolf",
  "Dragon", "Viper", "Hawk", "Bison", "Lynx", "Cobra", "Badger", "Jaguar",
  "Phoenix", "Puma", "Orca", "Rhino", "Gecko", "Mantis", "Heron", "Ibex",
  "Kraken", "Griffin", "Wyvern", "Basilisk", "Chimera", "Sphinx", "Hydra", "Titan",
  "Nebula", "Quasar", "Pulsar", "Meteor", "Eclipse", "Zenith", "Nomad", "Corsair",
  "Ronin", "Samurai", "Valkyrie", "Paladin", "Sentinel", "Ranger", "Bandit", "Maverick",
  "Osprey", "Kestrel", "Falconer", "Marten", "Stoat", "Serval", "Caracal", "Ocelot",
  "Narwhal", "Manta", "Barracuda", "Piranha", "Stingray", "Marlin", "Tarpon", "Sable",
  "Mamba", "Adder", "Python", "Iguana", "Chameleon", "Axolotl", "Pangolin", "Tapir",
  "Wombat", "Quokka", "Meerkat", "Mongoose", "Wolverine", "Grizzly", "Cougar", "Bobcat",
  "Condor", "Albatross", "Peregrine", "Shrike", "Magpie", "Puffin", "Toucan", "Macaw",
  "Cyclone", "Avalanche", "Monsoon", "Tempest", "Blizzard", "Inferno", "Torrent", "Mirage",
];

export function suggestNickname() {
  const a = ADJECTIVES[(Math.random() * ADJECTIVES.length) | 0];
  const n = NOUNS[(Math.random() * NOUNS.length) | 0];
  return `${a}${n}`;
}

export function sanitiseNick(raw) {
  const cleaned = String(raw || "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/[^\p{L}\p{N}_ -]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
  return cleaned.length >= 2 ? cleaned : suggestNickname();
}

export function makeRoomCode() {
  // Ambiguous characters removed so codes survive being read aloud or retyped.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

let playerSeq = 0;

export class Room {
  constructor(opts = {}) {
    this.code = opts.code || makeRoomCode();
    this.kind = opts.kind === "open" ? "open" : "custom";
    this.index = opts.index ?? 0;
    this.label = opts.label || null;

    this.format = opts.format === "timed" ? "timed" : "race";
    this.maxPlayers = clamp(opts.maxPlayers ?? 50, 2, 50);
    this.wordsToWin = clamp(opts.wordsToWin ?? 10, 3, 30);
    this.durationSeconds = clamp(opts.durationSeconds ?? 600, 60, 1800);
    this.length = clamp(opts.length ?? 5, 3, 7);
    this.region = ["en", "gb", "id"].includes(opts.region) ? opts.region : "en";
    this.isPrivate = Boolean(opts.private);

    this.lobbySeconds = opts.lobbySeconds ?? 15;
    this.resultsSeconds = opts.resultsSeconds ?? 120;

    // Every round gets its own id. The client stores it so a refresh can
    // rejoin the same match, and so a kicked player can be kept out of it.
    this.matchId = null;
    this.kicked = new Set();
    this.hostId = null;

    this.topicSlug = opts.topic || null;
    this.topicName = null;

    this.players = new Map();
    this.phase = PHASE.LOBBY;
    this.phaseEndsAt = 0;
    this.round = 0;

    this.words = [];
    this.voteOptions = [];
    this.votes = new Map();

    this.createdAt = Date.now();
    this.lastActivityAt = Date.now();
    this.emptySince = Date.now();

    this.boardDirty = false;
    this.lastBoardFlush = 0;
    this.feed = [];

    // Injected by the hub.
    this.onBroadcast = () => {};
    this.onMatchFinished = () => {};
    this.pickVoteOptions = async () => [];
    this.loadTopic = async () => null;
    this.pickDefaultTopic = async () => null;
  }

  /* ---------- derived ---------- */

  get playerCount() {
    return this.players.size;
  }

  get fillPercent() {
    return this.maxPlayers ? Math.round((this.players.size / this.maxPlayers) * 100) : 0;
  }

  get isFull() {
    return this.players.size >= this.maxPlayers;
  }

  get isActive() {
    return this.players.size > 0;
  }

  /**
   * Only custom rooms have a ready step. Open rooms run a continuous public
   * cycle that players drop in and out of, so gating them on readiness would
   * leave the room permanently stuck waiting for a stranger to click a button.
   */
  get requiresReady() {
    return this.kind === "custom";
  }

  /** Players dealt into the current round. Spectators are excluded. */
  get participants() {
    return [...this.players.values()].filter((p) => p.playing);
  }

  describe() {
    return {
      code: this.code,
      matchId: this.matchId,
      kind: this.kind,
      index: this.index,
      label: this.label,
      format: this.format,
      phase: this.phase,
      players: this.players.size,
      maxPlayers: this.maxPlayers,
      fillPercent: this.fillPercent,
      region: this.region,
      length: this.length,
      wordsToWin: this.wordsToWin,
      durationSeconds: this.durationSeconds,
      resultsSeconds: this.resultsSeconds,
      topic: this.topicSlug,
      // The real name is resolved when a round builds its word list; until then
      // fall back to the slug so a waiting lobby does not claim "Random words".
      topicName: this.topicName || titleFromSlug(this.topicSlug),
      round: this.round,
      // Absolute end time, so every client counts down against the same clock
      // instead of drifting from its own.
      endsAt: this.phaseEndsAt,
      endsIn: this.phaseEndsAt ? Math.max(0, Math.round((this.phaseEndsAt - Date.now()) / 1000)) : 0,
      serverNow: Date.now(),
      isPrivate: this.isPrivate,
      hostId: this.hostId,
      requiresReady: this.requiresReady,
      readyCount: [...this.players.values()].filter((p) => p.ready).length,
    };
  }

  /**
   * True when every player present has readied up — the host included. The host
   * plays the round like anyone else, so exempting them meant the lobby could
   * report "everyone ready" while the host had not actually confirmed.
   */
  allReady() {
    if (!this.players.size) return false;
    for (const p of this.players.values()) {
      if (!p.ready) return false;
    }
    return true;
  }

  /** Host is the earliest joiner still present. */
  reassignHost() {
    if (this.hostId && this.players.has(this.hostId)) return;
    let earliest = null;
    for (const p of this.players.values()) {
      if (!earliest || p.joinedAt < earliest.joinedAt) earliest = p;
    }
    this.hostId = earliest ? earliest.id : null;
  }

  setReady(playerId, ready) {
    const p = this.players.get(playerId);
    if (!p) return false;
    // Readiness decides who is dealt into the *next* round, so it can only be
    // changed in the lobby. Toggling it mid-round must not affect play.
    if (this.phase !== PHASE.LOBBY) return false;
    p.ready = Boolean(ready);
    this.boardDirty = true;
    this.broadcast({ t: "room", room: this.describe(), players: this.lobbyList() });
    return true;
  }

  /** Lobby view: who is here, who has readied up, and who is sitting this round out. */
  lobbyList() {
    return [...this.players.values()].map((p) => ({
      id: p.id,
      nick: p.nick,
      avatar: p.avatar,
      ready: Boolean(p.ready),
      playing: Boolean(p.playing),
      isHost: p.id === this.hostId,
    }));
  }

  kick(hostId, targetId) {
    if (hostId !== this.hostId) return { error: "not_host" };
    if (targetId === this.hostId) return { error: "cannot_kick_host" };
    const target = this.players.get(targetId);
    if (!target) return { error: "not_found" };

    // Blocked for this match only; a new round mints a new id.
    this.kicked.add(targetId);
    this.send(target, { t: "kicked", matchId: this.matchId, code: this.code });
    try {
      target.socket?.close(4003, "kicked");
    } catch {
      /* ignore */
    }
    this.removePlayer(targetId);
    this.broadcast({ t: "room", room: this.describe(), players: this.lobbyList() });
    return { ok: true };
  }

  /* ---------- membership ---------- */

  addPlayer({ socket, nick, avatar, clientId }) {
    /* A reconnect from the same browser reclaims its own seat.
       Closing a tab does not always deliver a close frame, so the old player
       can still be sitting in the room when you come back. Without this, the
       returning player is a stranger whose name is already taken, so they
       become "abcd2", then "abcd3", and their score is left behind on a ghost. */
    if (clientId) {
      for (const existing of this.players.values()) {
        if (existing.clientId !== clientId) continue;
        if (existing.socket && existing.socket !== socket) {
          try {
            existing.socket.close(4004, "reconnected");
          } catch {
            /* already gone */
          }
        }
        existing.socket = socket;
        if (Number.isInteger(avatar)) existing.avatar = Math.abs(avatar) % AVATAR_COUNT;
        this.lastActivityAt = Date.now();
        this.emptySince = 0;
        this.boardDirty = true;
        return { player: existing, resumed: true };
      }
    }

    if (this.isFull) return { error: "room_full" };

    const id = `p${++playerSeq}${randomBytes(3).toString("hex")}`;
    let name = sanitiseNick(nick);

    // Two players with the same name make the leaderboard unreadable.
    const taken = new Set([...this.players.values()].map((p) => p.nick.toLowerCase()));
    if (taken.has(name.toLowerCase())) {
      let n = 2;
      while (taken.has(`${name}${n}`.toLowerCase()) && n < 99) n++;
      name = `${name}${n}`;
    }

    const player = {
      id,
      clientId: clientId || null,
      socket,
      nick: name,
      avatar: Number.isInteger(avatar)
        ? Math.abs(avatar) % AVATAR_COUNT
        : (Math.random() * AVATAR_COUNT) | 0,
      wordIndex: 0,
      guesses: [],
      solved: 0,
      points: 0,
      streak: 0,
      bestStreak: 0,
      wordStartedAt: 0,
      finishedAt: 0,
      joinedAt: Date.now(),
      ready: false,
      // Open rooms are drop-in, so an arrival is a player straight away. In a
      // custom room you are only dealt in once you have readied up.
      playing: !this.requiresReady,
    };

    this.players.set(id, player);
    this.reassignHost();
    this.lastActivityAt = Date.now();
    this.emptySince = 0;
    this.boardDirty = true;

    if (this.phase === PHASE.PLAYING) {
      if (this.requiresReady) {
        // Arriving mid-round in a custom room means watching this one out and
        // being dealt in at the next lobby — the alternative is joining a race
        // that is already half over.
        player.playing = false;
      } else {
        // A player joining a match already in progress starts at the current word
        // rather than word 1, so they are not permanently a lap behind.
        player.wordIndex = this.lowestCommonWordIndex();
        player.wordStartedAt = Date.now();
      }
    }

    this.pushFeed({ type: "join", nick: player.nick, avatar: player.avatar });
    return { player };
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.boardDirty = true;
    this.lastActivityAt = Date.now();
    if (this.players.size === 0) this.emptySince = Date.now();
    if (this.hostId === id) this.reassignHost();
    this.pushFeed({ type: "leave", nick: p.nick });
  }

  /** Where a late joiner should start: the word most players are furthest behind on. */
  lowestCommonWordIndex() {
    if (!this.players.size) return 0;
    let min = Infinity;
    for (const p of this.players.values()) min = Math.min(min, p.wordIndex);
    return Number.isFinite(min) ? min : 0;
  }

  /* ---------- phases ---------- */

  async startVoting() {
    this.phase = PHASE.VOTING;
    this.votes.clear();
    this.voteOptions = await this.pickVoteOptions(this);
    // The vote runs on the scoreboard clock; there is no separate vote timer.
    this.phaseEndsAt = Date.now() + this.resultsSeconds * 1000;

    this.broadcast({
      t: "vote_open",
      options: this.voteOptions,
      endsAt: this.phaseEndsAt,
      seconds: this.resultsSeconds,
    });
  }

  castVote(playerId, slug) {
    // Voting runs during the scoreboard, not in a phase of its own.
    if (this.phase !== PHASE.RESULTS && this.phase !== PHASE.VOTING) return false;
    if (!this.players.has(playerId)) return false;
    if (!this.voteOptions.some((o) => o.slug === slug)) return false;

    this.votes.set(playerId, slug);
    this.broadcast({ t: "vote_update", tally: this.voteTally(), voters: this.votes.size });
    return true;
  }

  voteTally() {
    const tally = Object.create(null);
    for (const o of this.voteOptions) tally[o.slug] = 0;
    for (const slug of this.votes.values()) {
      if (slug in tally) tally[slug]++;
    }
    return tally;
  }

  resolveVote() {
    if (!this.voteOptions.length) return null;
    const tally = this.voteTally();

    let best = -1;
    let winners = [];
    for (const o of this.voteOptions) {
      const n = tally[o.slug];
      if (n > best) {
        best = n;
        winners = [o];
      } else if (n === best) {
        winners.push(o);
      }
    }
    // Nobody voted, or a tie — pick randomly among the leaders, CS-style.
    return winners[(Math.random() * winners.length) | 0];
  }

  async startRound(option) {
    let choice = option || this.resolveVote();

    // A public room always opens on a topic. Random words are only ever the
    // result of players actually voting for them, never the default a room
    // falls into because nobody has voted yet.
    if (this.kind === "open" && (!choice || choice.slug === "__random__") && !this.votes.size) {
      const picked = await this.pickDefaultTopic(this);
      if (picked) choice = picked;
    }
    this.topicSlug = choice && choice.slug !== "__random__" ? choice.slug : null;
    this.topicName = choice && choice.slug !== "__random__" ? choice.name : null;

    this.words = await this.buildWordList();
    if (!this.words.length) {
      // Dictionary genuinely unavailable — do not spin players in a dead round.
      this.topicSlug = null;
      this.topicName = null;
      this.words = await this.buildWordList();
    }

    this.round++;
    this.matchId = `${this.code}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
    this.phase = PHASE.PLAYING;
    this.phaseEndsAt = Date.now() + this.durationSeconds * 1000;
    this.feed = [];
    this.votes.clear();
    this.voteOptions = [];

    const now = Date.now();
    for (const p of this.players.values()) {
      // Who is dealt in is decided here, once, from who had readied up when the
      // round began. Consuming the flag now means the next lobby starts clean
      // instead of inheriting stale "ready" ticks from the previous round.
      p.playing = this.requiresReady ? Boolean(p.ready) : true;
      p.ready = false;
      p.wordIndex = 0;
      p.guesses = [];
      p.solved = 0;
      p.points = 0;
      p.streak = 0;
      p.bestStreak = 0;
      p.finishedAt = 0;
      p.wordStartedAt = now;
    }

    this.broadcast({
      t: "round_start",
      round: this.round,
      matchId: this.matchId,
      format: this.format,
      topic: this.topicSlug,
      topicName: this.topicName,
      wordsToWin: this.wordsToWin,
      total: this.words.length,
      endsAt: this.phaseEndsAt,
      durationSeconds: this.durationSeconds,
    });

    for (const p of this.players.values()) {
      if (p.playing) this.sendWord(p);
      else this.send(p, { t: "spectating", reason: "not_ready", endsAt: this.phaseEndsAt });
    }
    this.boardDirty = true;
  }

  async buildWordList() {
    const target = this.format === "race" ? this.wordsToWin + 6 : 40;

    if (this.topicSlug) {
      const entry = await this.loadTopic(this.topicSlug);
      if (entry && entry.items.length) {
        this.topicName = entry.topic.name;
        const shuffled = shuffle(entry.items.slice());
        return shuffled
          .slice(0, target)
          .map((it) => ({
            answer: it.answer,
            length: it.length,
            clue: ensureClue(it.answer, it.clue),
          }));
      }
    }

    // Random-word rounds get a clue too. The open rooms have no hint button —
    // the clue is the help — so leaving these blank meant the default public
    // room was the one place you played with nothing at all.
    return wordSequence(this.region, this.length, target, (Math.random() * 2 ** 31) | 0).map(
      (w) => ({ answer: w, length: w.length, clue: defaultClue(w) })
    );
  }

  /**
   * Ends play and opens the scoreboard. The scoreboard doubles as the vote for
   * the next topic, so the whole cycle is play -> results+vote -> play.
   */
  async endRound(reason = "time") {
    if (this.phase !== PHASE.PLAYING) return;

    this.phase = PHASE.RESULTS;
    this.phaseEndsAt = Date.now() + this.resultsSeconds * 1000;

    const standings = this.standings();
    const winner = standings[0] || null;

    this.votes.clear();
    this.voteOptions = this.kind === "open" ? await this.pickVoteOptions(this) : [];

    this.broadcast({
      t: "round_end",
      reason,
      standings,
      topic: this.topicSlug,
      topicName: this.topicName,
      // Reveal the answers only now, so nothing can be spoiled mid-round.
      words: this.words.map((w) => w.answer),
      endsAt: this.phaseEndsAt,
      seconds: this.resultsSeconds,
      voteOptions: this.voteOptions,
      tally: this.voteTally(),
      matchId: this.matchId,
    });

    this.onMatchFinished(this, standings, winner, reason);
  }

  standings() {
    // Spectators are not in the race, so they do not appear on the scoreboard.
    return this.participants
      .map((p) => ({
        id: p.id,
        nick: p.nick,
        avatar: p.avatar,
        solved: p.solved,
        points: p.points,
        bestStreak: p.bestStreak,
        finishedAt: p.finishedAt,
        done: p.wordIndex >= this.words.length && this.words.length > 0,
        wordIndex: p.wordIndex,
      }))
      .sort(
        (a, b) =>
          b.solved - a.solved ||
          // Whoever reached the same count first ranks higher.
          (a.finishedAt && b.finishedAt ? a.finishedAt - b.finishedAt : 0) ||
          b.points - a.points ||
          a.nick.localeCompare(b.nick)
      )
      .map((p, i) => ({ ...p, rank: i + 1 }));
  }

  /* ---------- gameplay ---------- */

  currentWord(player) {
    return this.words[player.wordIndex] || null;
  }

  sendWord(player) {
    const w = this.currentWord(player);
    if (!w) {
      this.send(player, { t: "word_done", message: "You cleared every word." });
      return;
    }
    player.guesses = [];
    player.wordStartedAt = Date.now();
    // Length and clue only — never the answer.
    this.send(player, {
      t: "word",
      index: player.wordIndex,
      length: w.length,
      clue: w.clue,
      maxGuesses: MAX_GUESSES,
      total: this.words.length,
    });
  }

  submitGuess(player, rawGuess) {
    if (this.phase !== PHASE.PLAYING) {
      return { error: "not_playing" };
    }
    // The real ready gate: readying up is what deals you in, so anyone who did
    // not is a spectator and cannot score, however they reach this point.
    if (!player.playing) {
      return { error: "spectating" };
    }
    const word = this.currentWord(player);
    if (!word) return { error: "no_word" };

    const guess = String(rawGuess || "").toUpperCase().replace(/[^A-Z]/g, "");
    if (guess.length !== word.length) return { error: "wrong_length" };
    if (player.guesses.length >= MAX_GUESSES) return { error: "out_of_guesses" };

    // Topic answers (character names, brands) are not in the dictionary, so they
    // are accepted on their own terms; classic rounds go through the word list.
    const acceptable =
      guess === word.answer ||
      (this.topicSlug
        ? isValidGuess(this.region, word.length, guess) || guess === word.answer
        : isValidGuess(this.region, word.length, guess));

    if (!acceptable) return { error: "not_in_list" };

    player.guesses.push(guess);
    this.lastActivityAt = Date.now();

    const evals = evaluate(guess, word.answer);
    const correct = guess === word.answer;
    const guessesUsed = player.guesses.length;

    const result = {
      t: "result",
      index: player.wordIndex,
      guess,
      pattern: encodePattern(evals),
      correct,
      guessesUsed,
      guessesLeft: MAX_GUESSES - guessesUsed,
    };

    if (correct) {
      const seconds = Math.max(0, (Date.now() - player.wordStartedAt) / 1000);
      const speedBonus = Math.max(0, Math.round(60 - seconds));
      const efficiency = (MAX_GUESSES - guessesUsed) * 10;

      player.solved++;
      player.points += 100 + speedBonus + efficiency;
      player.streak++;
      player.bestStreak = Math.max(player.bestStreak, player.streak);
      player.wordIndex++;

      result.points = 100 + speedBonus + efficiency;
      result.solved = player.solved;

      this.pushFeed({
        type: "solved",
        nick: player.nick,
        avatar: player.avatar,
        // Word number only — revealing the answer would spoil it for everyone behind.
        wordNumber: player.solved,
      });

      this.boardDirty = true;
      this.send(player, result);

      // Running out of words never ends the round — the clock does. The player
      // sits on a waiting screen with their score locked in, and everyone else
      // keeps playing.
      if (player.wordIndex >= this.words.length) {
        player.finishedAt = Date.now();
        this.send(player, {
          t: "you_finished",
          solved: player.solved,
          points: player.points,
          endsAt: this.phaseEndsAt,
        });
        this.boardDirty = true;
        return { ok: true, finished: true };
      }

      this.sendWord(player);
      return { ok: true };
    }

    player.streak = 0;

    if (guessesUsed >= MAX_GUESSES) {
      result.failed = true;
      result.answer = word.answer; // this player is done with it, safe to reveal
      player.wordIndex++;
      this.boardDirty = true;
      this.send(player, result);
      this.sendWord(player);
      return { ok: true };
    }

    this.send(player, result);
    return { ok: true };
  }

  /* ---------- messaging ---------- */

  send(player, msg) {
    if (!player?.socket) return;
    try {
      if (player.socket.readyState === 1) player.socket.send(JSON.stringify(msg));
    } catch {
      /* socket is going away; the close handler will clean up */
    }
  }

  broadcast(msg, exceptId = null) {
    // Serialise once, not once per socket — this is the difference between
    // 1 and 50 JSON encodes for a full room.
    const payload = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.id === exceptId) continue;
      try {
        if (p.socket?.readyState === 1) p.socket.send(payload);
      } catch {
        /* ignore */
      }
    }
    this.onBroadcast(this, msg);
  }

  pushFeed(entry) {
    this.feed.push({ ...entry, at: Date.now() });
    if (this.feed.length > 40) this.feed.splice(0, this.feed.length - 40);
    this.broadcast({ t: "feed", entry });
  }

  boardPayload() {
    return {
      t: "board",
      phase: this.phase,
      round: this.round,
      endsAt: this.phaseEndsAt,
      players: this.standings().slice(0, 50),
      count: this.players.size,
    };
  }

  flushBoard(now) {
    if (!this.boardDirty) return;
    if (now - this.lastBoardFlush < BOARD_FLUSH_MS) return;
    this.boardDirty = false;
    this.lastBoardFlush = now;
    this.broadcast(this.boardPayload());
  }
}

function titleFromSlug(slug) {
  if (!slug) return null;
  return String(slug)
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function clamp(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export { MAX_GUESSES };
