#!/usr/bin/env node
"use strict";

// robots-check: fetches the LIVE robots.txt a domain actually serves and
// tells you what's really in it -- including whether Cloudflare's "AI Crawl
// Control" feature is silently appending/overriding rules you never wrote.
//
// Why this exists: while shipping several small sites in September 2026, we
// noticed our own origin robots.txt files were NOT what was actually being
// served -- Cloudflare was injecting a "BEGIN Cloudflare Managed content"
// block with its own AI-bot-blocking rules on top. That's often fine (real
// search crawling is usually left untouched), but plenty of site owners have
// no idea it's happening at all, and some Cloudflare Content-Signal defaults
// might not match what you actually intend. This checks what's *really*
// being served, not what you think you wrote.
//
// Usage:
//   npx github:janibert1/robots-check example.com
//   node robots-check.js example.com
//
// Zero dependencies -- just Node's built-in https module.

const https = require("https");
const { URL } = require("url");

const RESET = "\x1b[0m", BOLD = "\x1b[1m", DIM = "\x1b[2m";
const RED = "\x1b[31m", GREEN = "\x1b[32m", YELLOW = "\x1b[33m", CYAN = "\x1b[36m";

const KNOWN_SEARCH_BOTS = ["googlebot", "bingbot", "duckduckbot", "slurp", "yandexbot", "baiduspider"];
const KNOWN_AI_TRAIN_BOTS = [
  "gptbot", "google-extended", "ccbot", "claudebot", "bytespider", "amazonbot",
  "applebot-extended", "meta-externalagent", "cloudflarebrowserrenderingcrawler",
  "perplexitybot", "diffbot", "cohere-ai", "omgili",
];

function fetchText(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "robots-check/1.0 (+https://github.com/janibert1/robots-check)" } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        resolve(fetchText(next, redirects - 1));
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data, url }));
    }).on("error", reject);
  });
}

function parseRobots(text) {
  const lines = text.split(/\r?\n/);
  const groups = {}; // agent(lowercase) -> {disallow:[], allow:[]}
  let current = [];
  let sitemaps = [];
  for (let raw of lines) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    if (!rawKey) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      // A run of consecutive User-agent lines all belong to the same group
      if (current.length && groups[current[current.length - 1]] && groups[current[current.length - 1]]._justStarted === false) {
        current = [];
      }
      const agent = value.toLowerCase();
      if (!groups[agent]) groups[agent] = { disallow: [], allow: [], _justStarted: true };
      current.push(agent);
    } else if (key === "disallow") {
      current.forEach((a) => { groups[a].disallow.push(value); groups[a]._justStarted = false; });
    } else if (key === "allow") {
      current.forEach((a) => { groups[a].allow.push(value); groups[a]._justStarted = false; });
    } else if (key === "sitemap") {
      sitemaps.push(value);
    } else {
      current.forEach((a) => { groups[a]._justStarted = false; });
    }
  }
  Object.values(groups).forEach((g) => delete g._justStarted);
  return { groups, sitemaps };
}

function isBlocked(group) {
  if (!group) return null; // no rule at all
  return group.disallow.some((d) => d === "/" || d === "");
}

async function main() {
  const domain = process.argv[2];
  if (!domain) {
    console.error(`${BOLD}robots-check${RESET} — see what your site's robots.txt actually serves\n`);
    console.error(`Usage: npx github:janibert1/robots-check <domain>`);
    console.error(`   or: node robots-check.js <domain>\n`);
    process.exit(1);
  }
  const host = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const url = `https://${host}/robots.txt`;

  console.log(`${DIM}Fetching ${url} ...${RESET}\n`);
  let res;
  try {
    res = await fetchText(url);
  } catch (err) {
    console.error(`${RED}Could not fetch ${url}: ${err.message}${RESET}`);
    process.exit(1);
  }
  if (res.status !== 200) {
    console.log(`${YELLOW}${host} responded ${res.status} for /robots.txt${RESET} — no robots.txt served (or blocked). That means every crawler, AI bots included, is implicitly allowed everywhere.`);
    process.exit(0);
  }

  const text = res.body;
  const { groups, sitemaps } = parseRobots(text);
  const isCloudflareManaged = /BEGIN Cloudflare Managed content/i.test(text);

  console.log(`${BOLD}${host}${RESET} — ${text.split(/\r?\n/).filter((l) => l.trim()).length} non-blank lines\n`);

  if (isCloudflareManaged) {
    console.log(`${YELLOW}${BOLD}⚠ This robots.txt is (at least partly) Cloudflare-managed.${RESET}`);
    console.log(`${DIM}  Cloudflare's "AI Crawl Control" feature injects its own block into what's${RESET}`);
    console.log(`${DIM}  actually served — your origin server's own robots.txt file may say${RESET}`);
    console.log(`${DIM}  something different from what's shown below. Check your Cloudflare${RESET}`);
    console.log(`${DIM}  dashboard under Bots → AI Crawl Control if this doesn't match your intent.${RESET}\n`);
  }

  const star = groups["*"];
  const starBlocked = isBlocked(star);
  if (starBlocked) {
    console.log(`${RED}${BOLD}✗ User-agent: * is fully disallowed ("Disallow: /").${RESET} Nothing crawls this site by default unless a more specific rule overrides it.\n`);
  }

  console.log(`${BOLD}Real search engines:${RESET}`);
  for (const bot of KNOWN_SEARCH_BOTS) {
    const g = groups[bot];
    const blocked = g ? isBlocked(g) : starBlocked;
    const label = blocked ? `${RED}blocked${RESET}` : `${GREEN}allowed${RESET}`;
    if (g || blocked) console.log(`  ${bot.padEnd(14)} ${label}`);
  }
  console.log(`  ${DIM}(any not listed above default to the same as User-agent: * → ${starBlocked ? "blocked" : "allowed"})${RESET}\n`);

  console.log(`${BOLD}AI training/crawling bots:${RESET}`);
  let anyAiFound = false;
  for (const bot of KNOWN_AI_TRAIN_BOTS) {
    const g = groups[bot];
    if (!g) continue;
    anyAiFound = true;
    const blocked = isBlocked(g);
    const label = blocked ? `${GREEN}blocked${RESET}` : `${YELLOW}allowed${RESET}`;
    console.log(`  ${bot.padEnd(30)} ${label}`);
  }
  if (!anyAiFound) {
    console.log(`  ${DIM}No AI-bot-specific rules found — they fall back to User-agent: * (${starBlocked ? "blocked" : "allowed"}).${RESET}`);
  }
  console.log();

  console.log(`${BOLD}Sitemap:${RESET} ${sitemaps.length ? sitemaps.join(", ") : `${YELLOW}none declared${RESET}`}`);
  console.log();

  const totalGroups = Object.keys(groups).length;
  console.log(`${DIM}${totalGroups} user-agent group(s) parsed total. Run with the full domain (e.g. www.example.com) if a subdomain serves a different robots.txt.${RESET}`);
}

main();
