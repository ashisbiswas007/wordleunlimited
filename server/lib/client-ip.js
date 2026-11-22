import { BlockList, isIP } from "node:net";

/**
 * The visitor's address.
 *
 * Every request reaches us as visitor -> Cloudflare -> Traefik -> here, so
 * req.ip (one trusted hop) is a Cloudflare edge. Many visitors share one
 * edge, so limits keyed on req.ip were shared too: eight players behind the
 * same Mumbai edge filled the per-IP socket cap and the ninth was refused.
 *
 * Cloudflare puts the real address in CF-Connecting-IP. That header is only
 * believed when the request really came from a Cloudflare range; the origin
 * also answers directly, and anyone connecting that way can write any header.
 *
 * Ranges: https://www.cloudflare.com/ips/ (unchanged since 2021).
 */
const CLOUDFLARE_V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];
const CLOUDFLARE_V6 = [
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
  "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
];

const cloudflare = new BlockList();
for (const c of CLOUDFLARE_V4) {
  const [a, p] = c.split("/");
  cloudflare.addSubnet(a, Number(p), "ipv4");
}
for (const c of CLOUDFLARE_V6) {
  const [a, p] = c.split("/");
  cloudflare.addSubnet(a, Number(p), "ipv6");
}

function plain(ip) {
  const s = String(ip || "").trim();
  return s.startsWith("::ffff:") && isIP(s.slice(7)) === 4 ? s.slice(7) : s;
}

export function isCloudflare(ip) {
  const a = plain(ip);
  const v = isIP(a);
  return v ? cloudflare.check(a, v === 4 ? "ipv4" : "ipv6") : false;
}

export function clientIp(req) {
  const peer = plain(req.ip);
  const cf = req.headers?.["cf-connecting-ip"];
  if (typeof cf === "string" && isIP(plain(cf)) && isCloudflare(peer)) return plain(cf);
  return peer || "unknown";
}
