# Atlasclock

Atlasclock is a calm, offline-first world time experience built for VS Code Live Server and a lightweight Node server.

## Live Server

1. Open the `atlasclock` folder in VS Code.
2. Open `public/index.html`.
3. Right click → **Open with Live Server**.
4. The included `.vscode/settings.json` uses `/public` as the Live Server root and port 5500.

## Node server

```bash
npm start
```

## Included experience

- Long-form Atlasclock landing page inspired by the supplied visual direction.
- World Clock dashboard with live IANA timezone calculations.
- Natural Earth-derived geographic country geometry in `public/world.svg`.
- Country metadata, representative points and IANA timezone lists in `public/countries.json`.
- City latitude/longitude markers rendered in the same equirectangular (Plate Carrée) 1000×500 coordinate system as the map.
- Tap/click any mapped country to open its live local time card.
- Multi-timezone country selector for countries such as the US, Canada, Russia and Australia where data is available.
- City search and add-city flow.
- Interactive map zoom, pan and reset.
- UTC timeline comparison.
- Meeting planner that finds overlapping 09:00–18:00 windows.
- Day/night cards and UTC offset visualisation.
- Places browser, Compare page, Settings and About page.
- Four-step Get Started onboarding: cities → time format → theme → dashboard.
- Scroll-reveal animation, globe motion, marker pulses, hover motion and back-to-top control.
- Light/dark themes and reduced-motion setting.
- Local persistence and offline service-worker cache.

## Geographic note

The map uses Natural Earth-derived country geometry bundled locally and an equirectangular/Plate Carrée projection. City points use their stored latitude/longitude and the exact same projection formula, so marker placement is not manually guessed. Small islands and microstates can remain visually simplified at low-resolution world-map scale.
