---
lang: en
anchor: overlay-app
title: GenshinFlex for PC — guides and pity tracker on top of the game
summary: 'Our Windows app is out: a narrow panel on top of Genshin Impact with character guides, current banners and a pity counter. Open a character or the wish screen in the game and the panel switches to the right page by itself. Free, no ads, about 3 MB.'
date: 2026-10-12T21:45:00+05:00
---

### What it is

GenshinFlex for PC is a small app for Windows 10/11. It shows a site panel on top of the game, so you no longer need to minimize Genshin and look for a browser tab. Press **Alt+G** to show or hide the panel.

Download: [app page](/en/app/).

### What it does

- **Character guide**: weapons, artifacts, stats and teams in a narrow panel.
- **Banners**: what is on the banners now and how long the phase lasts in your server's time.
- **Pity tracker**: new wishes are imported automatically when you open the wish history in the game.
- **Sign in** with email, Discord or Google. Your wish history is shared with the site.
- **Updates** install themselves. You can check for them in the tray icon menu.

### The panel knows what is open in the game

Open a character screen in the game and the panel switches to that character's guide. Open the wish screen and it shows the banners and your pity. You don't have to click anything; switching takes about a second and a half.

To do this, the app looks at the title in the top-left corner of the game ("Wish" or "Anemo / Vesna") about once a second and reads the text with built-in Windows tools. Captures are not saved or sent anywhere. Recognition only runs while the game is in the foreground, and you can turn it off in the tray menu ("Распознавание экрана").

So far it has been checked on the Russian and English clients at 1080p, fullscreen and windowed. The Traveler is not recognized, because the screen shows your name instead of a character name. If the panel does not switch at your resolution or language, let us know, ideally with a screenshot.

### Is it safe

The app does not interfere with the game: it does not inject into the process, read memory or hook graphics. It reads the game cache file to find the wish history link (just like the script on the tracker page) and reads the text in the corner of the screen. Inside, it opens regular GenshinFlex pages that have no access to your computer.

We can't guarantee HoYoverse's position on third-party programs, but the app works the same way as popular wish trackers.

### Getting started

1. Download the installer from the [app page](/en/app/) and run it. Windows may warn about an unknown publisher: click "More info" → "Run anyway".
2. Run the game windowed or borderless.
3. Press Alt+G.

This is the first version, so we'd love your feedback and ideas.
