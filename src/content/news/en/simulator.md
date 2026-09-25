---
lang: en
anchor: team-simulator
title: Team simulator, leaked characters and full weapon art
summary: Simulate your own team's damage from your showcase right in the browser, "Is it worth pulling" for 11 more characters, Mitya and Valery marked BETA, and plenty of interface fixes.
date: 2026-09-26T12:00:00+05:00
---

A big update: you can now calculate the damage of **your own** team instead of only looking at reference numbers.

### Team simulator

The [team simulator](/en/tools/simulator/) takes the characters from your profile showcase and simulates their team with your builds:

- enter your UID and pick a character, and their team from our simulations opens up;
- anyone in your showcase gets your level, constellations, talents, weapon and refinement, sets and the exact stats of every artifact; everyone else uses the reference build;
- the fight is simulated by [gcsim](https://github.com/genshinsim/gcsim) right in your browser: no data is sent anywhere, and after the first load the engine works even offline;
- you get your team's damage compared with the reference (C0, 4★ weapon, KQM-standard stats) and each character's contribution.

The Traveler isn't supported yet. If a new weapon or set hasn't been added to gcsim yet, the simulator uses the reference one and tells you so.

### "Is it worth pulling" for 11 more characters

The constellation and 5★ weapon value breakdown now covers 117 characters. New additions: Yun Jin, Iansan, Varka, Odette and all seven Travelers. For characters whose teams aren't in the gcsim database, we built the team and rotation ourselves from open guides, with a link to the source under "How we calculated".

### Leaked characters (BETA)

⚠️ Spoilers. We added [Mitya](/en/characters/mitya/) and [Valery](/en/characters/valery/) marked BETA: stats, ascension materials, splash art, plus the [level-up calculator](/en/tools/calculator/). The data comes from leaks and may change before release. They aren't in the team checker or the rotation builder.

### Interface

- The [weapon list](/en/weapons/) now shows full art instead of in-game icons that cut off long swords and bows.
- Weapon icons in builds, banners and on the home page are no longer clipped by rounded corners.
- On phones, character page tabs, character list filters and the Spiral Abyss floor navigation no longer spill off the screen.
- A light splash screen on your first visit.
- Sections that are still a long way off (for now, the rating) moved into a separate "In development" group.
- Our [Telegram channel](https://t.me/genshinflex) is now linked in the top right corner.

### Fixes

- The "Today" button in the [calendar](/en/calendar/) works again: the timeline opens on today, and pressing the button highlights the "Now" line. In list view it scrolls to "Ongoing".

Follow development and share ideas in our [Telegram channel](https://t.me/genshinflex) or via [feedback](/en/feedback/).
