import { randomBytes } from "node:crypto";

function bool(v, dflt = false) {
  if (v == null || v === "") return dflt;
  return /^(1|true|yes|on)$/i.test(String(v));
}

function int(v, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : dflt;
}

const NODE_ENV = process.env.NODE_ENV || "development";
const isProd = NODE_ENV === "production";

// A missing SESSION_SECRET in production is a real security problem, not a warning:
// admin sessions would be signed with a key that changes on every restart.
let sessionSecret = process.env.SESSION_SECRET || "";
if (!sessionSecret) {
  if (isProd) {
    throw new Error(
      "SESSION_SECRET is required in production. Generate one with:\n" +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  sessionSecret = randomBytes(32).toString("hex");
}

export const config = {
  env: NODE_ENV,
  isProd,
  port: int(process.env.PORT, 3000),
  host: process.env.HOST || "0.0.0.0",
  trustProxy: bool(process.env.TRUST_PROXY, isProd),

  siteUrl: (process.env.SITE_URL || "https://wordleunlimited.dev").replace(/\/+$/, ""),

  databaseUrl: process.env.DATABASE_URL || "",

  sessionSecret,
  admin: {
    user: process.env.ADMIN_USER || "admin",
    passwordHash: process.env.ADMIN_PASSWORD_HASH || "",
    sessionTtlMs: 12 * 60 * 60 * 1000,
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
  },

  // Multiplayer caps. Admin can lower these at runtime; these are the ceilings.
  rooms: {
    maxOpenRooms: int(process.env.MAX_OPEN_ROOMS, 5),
    maxPlayersPerRoom: int(process.env.MAX_PLAYERS_PER_ROOM, 50),
    revealNextAtPercent: int(process.env.REVEAL_NEXT_AT_PERCENT, 80),
    maxCustomRooms: int(process.env.MAX_CUSTOM_ROOMS, 500),
    roundSeconds: int(process.env.ROUND_SECONDS, 600),
    voteSeconds: int(process.env.VOTE_SECONDS, 20),
    lobbySeconds: int(process.env.LOBBY_SECONDS, 15),
  },

  // Regions are the three published pages. `dir` maps to public/src/dict/<dir>.
  regions: [
    { code: "en", dir: "en", path: "/", lang: "en", name: "English" },
    { code: "gb", dir: "gb", path: "/wordle-uk/", lang: "en-GB", name: "UK" },
    { code: "id", dir: "id", path: "/id/", lang: "id", name: "Indonesia" },
  ],
};

export default config;
