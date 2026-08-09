# Tarkov Companion 🎯

🇰🇷 [한국어](README.md) · 🇬🇧 English

[![Daily Briefing](https://github.com/MoriochoRadio/tarkov-companion/actions/workflows/daily-briefing.yml/badge.svg)](https://github.com/MoriochoRadio/tarkov-companion/actions/workflows/daily-briefing.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A Korean-language companion web app for Escape From Tarkov players.
Real-time flea market prices and value-for-money analysis, plus a **daily briefing automatically written by AI every morning at 9 AM**.

**▶ Site: https://moriochoradio.github.io/tarkov-companion/**

> ⚠️ This is an **unofficial**, fan-made tool. It has no relationship or affiliation with Battlestate Games whatsoever, and is a non-commercial project with no ads, sponsorships, or paid features. ([Full disclaimer](#disclaimer))

![Hero intro — first visit](docs/images/hero-desktop.png)

| Desktop | Mobile |
|---|---|
| ![Desktop — today's briefing](docs/images/desktop.png) | ![Mobile — ammo comparison cards](docs/images/mobile.png) |

## Features

Features are organized into 5 groups of tabs. `Ctrl+K` lets you quickly search and jump from any tab.

### 📋 Briefing
| Tab | Description |
|---|---|
| Today's Briefing | Patch notes, community trends, and things to watch out for, summarized in Korean by AI every day at 9 AM (KST). Past dates and weekly meta reports are also available |

### 🗺️ Quest Tools
| Tab | Description |
|---|---|
| Quests | A browser for 500+ quests based on tarkov.dev — trader/map/level filters, Korean/English search, objectives, rewards, and prerequisite/follow-up chains. Includes a separate walkthrough for the 1.0 storyline chapters |
| FIR | A split-screen operations view — on the left, pick trader quests (with an owned-count stepper per required item) or hideout stations (expandable per-level requirements) and press "Cleared" / "Built", and that FIR demand instantly disappears from the categorized (gear, junkbox, food, medical, misc) junkbox grid on the right. Owned counts sync to a single store no matter which side you change them from (tile positions stay fixed when quantities change). A unified checklist, a hideout dependency org-chart, and per-trader detail views are also built in as secondary views |
| Planner | "Push everything in one raid" — multi-select quests per map → objectives grouped by type + a bring-along bag + **marker overlay on the map** (clicking a marker shows the objective description and required keys; keys can be tapped to jump to item search) |
| Unlocks | A reverse index from item → the quest that unlocks it, plus the full prerequisite quest chain (in progression order) |

### 💰 Market Tools
| Tab | Description |
|---|---|
| Item Search | Korean/English name search, flea market average price, change rate, real profit (fees excluded), price sparkline, and price alerts (🔔) |
| Value Ranking | Top 50 by value per slot — what to grab in a raid. Toggle for real profit (fees excluded) |
| Risers/Fallers | Top 20 each by 48-hour change rate (low-price noise filtered out) |
| Money Making | Real-time profit ranking for crafts and barters + key value-for-money (linked to your hideout station levels) |
| Ammo Comparison | 195 rounds — caliber filter, sorting by damage/penetration/armor damage/price + a color chart of penetration effectiveness per armor class |

### 🔫 Modding
| Tab | Description |
|---|---|
| Modding | Recommended weapon builds by level — expand a card and, like the in-game modding screen, see a callout diagram of parts around the weapon image + the cheapest place to buy each part (trader vs flea), two total-cost figures ("traders only" / "flea included"), ergo/recoil adjustments, and recommended ammo. Clicking a part jumps to item search. A separate mode for browsing parts directly is also provided |

### 🗺️ Maps
| Tab | Description |
|---|---|
| Maps | Per-map raid/player-count/boss/required-key info + extraction lists by faction |

> Also: PWA (add to home screen, offline cache), localStorage data backup export/import, full mobile support.

## How It Works — No Server, Zero Operating Cost

```
[Visitor's browser] ──direct calls──> api.tarkov.dev/graphql (free public API)
       │
       └─ GitHub Pages (static hosting)
              ▲
              │ commit → auto deploy (daily 09:00 KST)
[GitHub Actions] ── collect news & community posts → summarize in Korean with GitHub Models → briefing JSON
```

- **Prices**: the visitor's browser calls the [tarkov.dev](https://tarkov.dev/api/) public API directly — no server, no keys, no cost
- **Briefing**: GitHub Actions collects the EFT wiki changelog, Reddit (top posts + bug reports), new YouTube videos, and Steam news every day, runs a 2-stage summary (per-source → combined) with [GitHub Models](https://docs.github.com/en/github-models) (free), and commits it as static JSON — fully automated with no human involvement. A weekly meta report is also published every Monday
- Even on days when AI summarization fails, it falls back to a title+link list, so no day goes without a briefing

For the detailed design, see [docs/DESIGN.md](docs/DESIGN.md); for the briefing data format, see [docs/briefing-schema.md](docs/briefing-schema.md).

## Why I Built It This Way — Technical Choices Q&A

**Q. Why a static site with no server?**
A. "Everything must be free" was this project's first constraint. Prices come from the visitor's browser calling the tarkov.dev public API directly, and hosting is GitHub Pages — so servers, API keys, and operating costs are all zero, with no infrastructure to manage.

**Q. Why React + TypeScript + Vite?**
A. A standard-stack choice premised on single-person maintenance. The build command includes `tsc --noEmit` so that any type error fails the deployment itself, and deploying under a GitHub Pages subpath is solved with a single Vite `base` setting.

**Q. Why GitHub Models for AI summarization?**
A. It can be called for free with just GitHub Actions' default `GITHUB_TOKEN`, so the pipeline is self-contained within the repository with no separate key issuance or billing. A per-process call cap (20 calls) keeps usage at 5 or fewer calls per day normally — under half of the free limit (50/day) — and on days when summarization fails it falls back to a title+link list so no briefing day is ever empty.

**Q. Why register as many as 6 GitHub Actions crons?**
A. Because in production I experienced GitHub's schedule events being dropped entirely for two consecutive days (2026-06-12 and 13). Avoiding on-the-hour times (the congested slots) wasn't enough, and there were days when all 3 crons bunched in the morning died together, so I spread 6 crons across the whole day from 09:00 to 20:00. A guard step at the very front of the workflow makes it idempotent ("skip if today's briefing already exists"), so no matter how many backup crons there are, duplicate AI calls and redeploy costs are zero.

**Q. Why localStorage for user data instead of login?**
A. With no server, self-hosted login is a non-starter, and I concluded that free BaaS offerings push quotas, key management, privacy liability, and vendor lock-in onto a one-person free project — so I decided not to build it. Instead, `navigator.storage.persist()` prevents the browser's automatic storage cleanup, and JSON file backup export/import supports moving between devices.

**Q. Why collect patch notes from the wiki changelog instead of the official news?**
A. The official news page is a JS-rendered SPA whose internal API returns 403, making automated collection impossible (confirmed 2026-06-11). So instead I collect the EFT wiki changelog — where official patch notes are recorded — via the MediaWiki API.

## Local Development

```bash
npm install   # first time only
npm run dev   # dev server (http://localhost:5173)
npm run build # production build
```

Pushing to main triggers automatic build and deployment via GitHub Actions.
The briefing pipeline can be tested by manually running the `daily-briefing` workflow (workflow_dispatch) from the Actions tab.

## Data Sources & Credits

- Price/item data and icons: [tarkov.dev](https://tarkov.dev/) — a free, open-source community API. This site does not store the data; the visitor's browser queries it directly
- Patch notes: [Escape from Tarkov Wiki (Fandom) changelog](https://escapefromtarkov.fandom.com/wiki/Changelog) — wiki text content is licensed under [CC BY-SA](https://www.fandom.com/licensing), and briefings summarize/quote it with source links
- Community trends: [r/EscapefromTarkov](https://www.reddit.com/r/EscapefromTarkov/) — based on the public RSS feed. Rights to each post belong to its author; briefings provide only short summaries with links to the originals
- New videos: public RSS from YouTube channels (노잼망겜, 유우양, Pestily, LVNDMARK) — only titles and links are included; rights to each video belong to its channel
- Official news: Steam news public RSS
- Briefing summary generation: [GitHub Models](https://docs.github.com/en/github-models)
- Map SVGs: [The Hideout community — tarkov-dev-svg-maps](https://github.com/the-hideout/tarkov-dev-svg-maps) ([CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)) · coordinate transform metadata: [the-hideout/tarkov-dev](https://github.com/the-hideout/tarkov-dev) maps.json (MIT) — details in [`public/maps/LICENSE.md`](public/maps/LICENSE.md). **This site is a non-commercial fan project with no ads, sponsorships, or paid features; it complies with the NC (non-commercial) condition and will not be commercialized for as long as it uses these assets.** Quest markers are drawn only as runtime overlays, so no derivative map files are created

## Disclaimer

- This project is an **unofficial**, fan-made tool with no relationship to Battlestate Games, and no affiliation, endorsement, or sponsorship of any kind. All rights to Escape from Tarkov™ and related trademarks, game data, and images belong to Battlestate Games Limited and the respective rights holders.
- **The daily briefing is an AI-generated summary.** It may contain inaccurate or outdated information; for accurate details, check the original source of each item. In-game decisions made using information on this site (including prices and guides), and their consequences, are the user's own responsibility.
- Price data reflects the point in time at which tarkov.dev provides it and may differ from actual in-game prices.
- Map images and quest marker coordinates are based on community-made data and may differ from actual in-game locations depending on game patches. Some objectives have no coordinates in the API and are not shown as markers (noted on screen).
- Upon request from a rights holder (Battlestate Games or an original content creator), the relevant content will be promptly modified or removed. Contact: GitHub Issues

## License

The **source code** in this repository may be freely used, modified, and distributed under the [MIT License](LICENSE).
However, the MIT License does not apply to externally sourced game data, icons, or wiki/community content; the rights to those belong to the respective rights holders listed under "Data Sources" above.
