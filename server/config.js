import { randomBytes } from "node:crypto";

function bool(v, dflt = false) {
  if (v == null || v === "") return dflt;
  return /^(1|true|yes|on)$/i.test(String(v));
}

/**
 * TRUST_PROXY is a hop count: "1" means one proxy (Coolify's Traefik) sits in
 * front, so req.ip is the address Traefik itself saw. Trusting every hop
 * ("true") would let a client write its own X-Forwarded-For and choose its IP.
 */
function hops(v, dflt) {
  if (v == null || v === "") return dflt;
  const n = parseInt(v, 10);
  if (Number.isFinite(n)) return n > 0 ? n : false;
  return /^(true|yes|on)$/i.test(String(v)) ? 1 : false;
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
  trustProxy: hops(process.env.TRUST_PROXY, isProd ? 1 : false),

  siteUrl: (process.env.SITE_URL || "https://wordleunlimited.dev").replace(/\/+$/, ""),

  databaseUrl: process.env.DATABASE_URL || "",

  sessionSecret,
  admin: {
    user: process.env.ADMIN_USER || "admin",
    // Pre-hashed (preferred) or plain text typed into the deploy environment.
    // If neither is set, one is generated at boot — see lib/admin-auth.js.
    passwordHash: process.env.ADMIN_PASSWORD_HASH || "",
    password: process.env.ADMIN_PASSWORD || "",
    sessionTtlMs: 12 * 60 * 60 * 1000,
    // The admin panel has its own listener, never published and never routed
    // by the proxy, so the public site has no /admin at all. The way in is an
    // SSH tunnel to the container (scripts/admin-tunnel.sh).
    port: int(process.env.ADMIN_PORT, 3901),
    host: process.env.ADMIN_HOST || "0.0.0.0",
    // Puts /admin back on the public site as well. Off unless set on purpose.
    public: bool(process.env.ADMIN_PUBLIC, false),
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    // Search Console token, rendered as a <meta> tag on every page. Google's
    // OAuth review requires the home page to be a domain you have verified.
    siteVerification: (process.env.GOOGLE_SITE_VERIFICATION || "").trim(),
  },

  // Multiplayer caps. Admin can lower these at runtime; these are the ceilings.
  rooms: {
    maxOpenRooms: int(process.env.MAX_OPEN_ROOMS, 5),
    maxPlayersPerRoom: int(process.env.MAX_PLAYERS_PER_ROOM, 50),
    revealNextAtPercent: int(process.env.REVEAL_NEXT_AT_PERCENT, 80),
    maxCustomRooms: int(process.env.MAX_CUSTOM_ROOMS, 500),
    // 28 minutes of play, then a 2 minute scoreboard that doubles as the vote
    // for the next topic — a 30 minute cycle on the server's clock.
    roundSeconds: int(process.env.ROUND_SECONDS, 1680),
    resultsSeconds: int(process.env.RESULTS_SECONDS, 120),
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
