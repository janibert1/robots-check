# robots-check

See what your site's `robots.txt` **actually serves** — including whether
Cloudflare's "AI Crawl Control" feature is silently appending its own rules
on top of yours.

## Why this exists

While deploying a few small sites behind Cloudflare, we noticed our own
`robots.txt` files weren't what was actually being served. Cloudflare
injects a managed block (look for `# BEGIN Cloudflare Managed content`) that
adds its own AI-crawler-blocking rules — real search engines are usually
left alone, but plenty of site owners have no idea this is happening at all,
and it's easy to assume the file in your repo/origin is the one being served
when it isn't.

`robots-check` fetches the live file over HTTPS and tells you, in plain
terms:

- whether it's Cloudflare-managed (and where to check/adjust it)
- whether real search engines (Googlebot, Bingbot, etc.) are actually
  allowed to crawl
- which AI training/crawling bots (GPTBot, ClaudeBot, Google-Extended,
  CCBot, Bytespider, and others) are blocked vs. allowed
- whether a sitemap is declared at all

No API keys, no signup, no dependencies — just Node's built-in `https`
module.

## Usage

```bash
npx github:janibert1/robots-check example.com
```

Or clone it and run directly:

```bash
git clone https://github.com/janibert1/robots-check
cd robots-check
node robots-check.js example.com
```

Requires Node 18+.

## Example output

```
example.com — 47 non-blank lines

⚠ This robots.txt is (at least partly) Cloudflare-managed.
  Cloudflare's "AI Crawl Control" feature injects its own block into what's
  actually served — your origin server's own robots.txt file may say
  something different from what's shown below. Check your Cloudflare
  dashboard under Bots → AI Crawl Control if this doesn't match your intent.

Real search engines:
  (any not listed above default to the same as User-agent: * → allowed)

AI training/crawling bots:
  gptbot                         blocked
  google-extended                blocked
  ccbot                          blocked
  ...

Sitemap: https://example.com/sitemap.xml
```

## CI mode / GitHub Action

```bash
node robots-check.js example.com --ci                          # exit 1 only if User-agent: * is fully disallowed
node robots-check.js example.com --ci --fail-on-cloudflare-managed  # also exit 1 on any CDN-side rewrite
```

`--ci` catches the failure mode that actually matters for CI: an accidental
site-wide crawl block (e.g. a staging-config `Disallow: /` that leaks into
production, or a CDN/edge rule that blocks everything). It deliberately does
**not** fail just because Cloudflare's AI Crawl Control is present — per the
tool's own philosophy above, that's often intentional. Use
`--fail-on-cloudflare-managed` if you specifically want CI to flag *any*
CDN-side change to what's served, not just a full block.

Usable directly as a GitHub Action:

```yaml
- uses: janibert1/robots-check@master
  with:
    domain: example.com
    fail-on-cloudflare-managed: 'false'  # optional, default false
```

Both CLI exit codes are verified locally against real live sites (a clean
pass and a real `--fail-on-cloudflare-managed` failure), **and the
`action.yml` wrapper itself has been verified in a real GitHub Actions
run** (`.github/workflows/self-test.yml`, triggered on every push to
`master`): one job runs it against a known-clean domain and confirms it
passes, a second runs it with `fail-on-cloudflare-managed: true` against
a domain with a real Cloudflare-managed robots.txt rewrite and asserts
the step actually failed. Both passed for real on 2026-09-09
([run](https://github.com/janibert1/robots-check/actions)).

## What it doesn't do

It can't see your origin server's own `robots.txt` file directly — only
what's actually served over HTTPS to a real request, which is what matters
for crawling anyway. If Cloudflare (or another CDN/WAF) sits in front of
your site, that's the version to trust regardless of what's in your repo.

## License

MIT
