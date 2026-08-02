# WanderFreely — marketing site

Static marketing + support site for the WanderFreely app. No build step, no
dependencies — plain HTML/CSS/JS. Brand tokens mirror the mobile app
(`mobile/global.css`): sky-blue `#0EA5E9` / `#0369A1`, orange action `#EA580C`,
Outfit headings + Inter body.

```
website/
  index.html           landing page (hero, features, how-it-works, support, footer)
  privacy-policy.html  privacy policy (copy of the canonical one)
  styles.css           design system + layout
  main.js              scroll-reveal + mobile nav (progressive, reduced-motion aware)
  assets/              logo-mark.png, icon.png, favicon.png
```

## Preview locally

```bash
cd website
python3 -m http.server 8000   # then open http://localhost:8000
```

Or just open `index.html` in a browser.

## Deploy (GitHub Pages)

The site is designed to serve from the repo's GitHub Pages. See the deploy
notes in the PR / chat — the `#support` section doubles as the App Store
Connect **support URL**, and the footer links to the privacy policy.

## Things to swap in later

- **Beta CTA**: buttons currently `mailto:` beta access. Replace with the public
  TestFlight link once available (search `Join the beta` in `index.html`).
- **App Store / Play badges**: add official download badges when the app is live.
- **Real screenshots**: the hero phone is a faithful HTML/CSS mockup; drop in
  real device screenshots if preferred.
