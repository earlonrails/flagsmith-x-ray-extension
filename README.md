# Flagsmith X-Ray

**Flagsmith X-Ray** is a zero-config Chrome Extension (Manifest V3) + self-hosted Flagsmith stack + interactive demo storefront built for the Flagsmith Hackathon ("Run Flagsmith yourself and build around it").

It gives developers and QA engineers an instant **X-Ray view** into any web app using Flagsmith:
- **Zero-config traffic inspection**: Automatically intercepts Flagsmith `/api/v1/flags/` and `/api/v1/identities/` requests (`fetch` and `XMLHttpRequest`) in the `MAIN` world at `document_start`.
- **Source attribution (`Default` vs. `Segment / Identity` vs. `Local Override`)**: When an identity is active, X-Ray fetches the environment's baseline `/api/v1/flags/` using the intercepted `X-Environment-Key` and diffs every flag to show whether its current state came from the environment default or a segment/identity override.
- **Zero-side-effect Local Overrides**: Toggle booleans or edit remote config values (`string`, `number`, `JSON`) locally in-flight before the Flagsmith SDK receives the response—without mutating the Flagsmith server for other users.
- **Instant Live Updates**: When `window.flagsmith` is exposed on the page, toggling an override triggers `window.flagsmith.getFlags()` for immediate UI updates without a full page reload.
- **Shareable QA States**: Export and import local overrides as JSON, available in both the **Extension Popup** and the **`Flagsmith X-Ray` Chrome DevTools Panel**.

---

## Project Structure

```text
flagsmith-hackathon/
├── docker-compose.yml       # Self-hosted Flagsmith + PostgreSQL on http://localhost:8000
├── scripts/seed.mjs         # Idempotent seed script (admin, org, project, flags, beta_users segment, .env.local)
├── demo-app/                # Vite + React + TypeScript storefront using the official `flagsmith` JS SDK
├── extension/               # Manifest V3 Chrome Extension (Vite + React + TypeScript)
└── package.json             # Root convenience scripts
```

---

## Quickstart

### 1. Install dependencies

```bash
npm run setup
```

### 2. Boot self-hosted Flagsmith

```bash
docker compose up -d
```

Flagsmith will be available at `http://localhost:8000`.

### 3. Seed Flagsmith & generate `demo-app/.env.local`

```bash
npm run seed
```

This idempotent script waits for `http://localhost:8000/health`, creates/logs in the local admin user (`admin@xray.local` / `XRayDemo123!`), creates **X-Ray Demo Org** and **X-Ray Demo App**, seeds 5 feature flags (`new_checkout_ui`, `dark_mode`, `promo_banner`, `ai_recommendations`, `max_items_per_page`), creates the `beta_users` segment (`beta == true`) with segment overrides, and writes `VITE_FLAGSMITH_ENV_KEY` + `VITE_FLAGSMITH_API` to `demo-app/.env.local`.

### 4. Start the Demo Web App

```bash
npm run dev:demo
```

Open `http://localhost:5173` in Chrome.

### 5. Build & load the Chrome Extension

```bash
npm run build:extension
```

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select `extension/dist`.
4. Open `http://localhost:5173`, then either click the **Flagsmith X-Ray** extension icon or open Chrome DevTools (`F12`) and switch to the **Flagsmith X-Ray** tab.

---

## How Flagsmith Is Used

- **Self-Hosted Core (`docker-compose.yml`)**: Runs `flagsmith/flagsmith:latest` backed by `postgres:15-alpine` with registration and CORS enabled for local development.
- **Flagsmith Management REST API (`scripts/seed.mjs`)**: Automates provisioning of organization, project, `Development` environment, feature flags (boolean + remote config), and `beta_users` segment rules/overrides.
- **Official `flagsmith` JS SDK (`demo-app/`)**: Initializes `flagsmith.init(...)`, switches identities via `flagsmith.identify(...)` / `flagsmith.logout()`, and exposes `window.flagsmith` for live `getFlags()` refreshes.
- **Runtime SDK Interception (`extension/`)**: Patches `/api/v1/flags/` and `/api/v1/identities/` responses in-flight and queries `/api/v1/flags/` with `X-Environment-Key` to compute `Default` vs. `Segment / Identity` attribution.

---

## 60-Second Demo Video Walkthrough Script

1. **[0:00 – 0:12] Problem & Stack**: Show `docker compose up -d` and `npm run seed` running against self-hosted Flagsmith on `localhost:8000`, automatically writing `demo-app/.env.local`.
2. **[0:12 – 0:25] Default vs. Segment Attribution**: Open the Demo Storefront (`localhost:5173`) as `Anonymous`—open **Flagsmith X-Ray** in Chrome DevTools and show all 5 flags tagged `Default`. Click **Alice (`beta=true`)** in the storefront; show `new_checkout_ui`, `ai_recommendations`, and `promo_banner` instantly turn blue with `Segment / Identity` badges.
3. **[0:25 – 0:42] Zero-Side-Effect Local Overrides**: Switch back to **Bob (`beta=false`)**. In X-Ray, toggle `dark_mode` ON, toggle `new_checkout_ui` ON, and change `max_items_per_page` to `2` and `promo_banner` to `"QA Test Banner"`. Watch the storefront update live with zero server changes.
4. **[0:42 – 0:55] Shareable QA States**: Click **Export JSON** to download the override state, click **Reset All Overrides** to restore the server state, then **Import JSON** to replay the exact bug/feature state.
5. **[0:55 – 1:00] Wrap-up**: Show that reloading the page preserves local overrides via `localStorage` + `chrome.storage.local`, while the Flagsmith dashboard remains untouched.
