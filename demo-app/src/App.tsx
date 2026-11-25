import { useEffect, useState } from 'react';
import flagsmith from 'flagsmith';

declare global {
  interface Window {
    flagsmith?: typeof flagsmith;
  }
}

type PersonaKey = 'anonymous' | 'alice' | 'bob';

interface PersonaConfig {
  key: PersonaKey;
  label: string;
  identifier: string | null;
  traits: Record<string, string | number | boolean>;
}

const PERSONAS: Record<PersonaKey, PersonaConfig> = {
  anonymous: {
    key: 'anonymous',
    label: 'Anonymous',
    identifier: null,
    traits: {},
  },
  alice: {
    key: 'alice',
    label: 'Alice (beta=true)',
    identifier: 'alice_beta',
    traits: { beta: true, plan: 'pro' },
  },
  bob: {
    key: 'bob',
    label: 'Bob (beta=false)',
    identifier: 'bob_standard',
    traits: { beta: false, plan: 'free' },
  },
};

const CATALOG_ITEMS = [
  { id: 1, name: 'Feature Flag Starter Kit', price: '$29' },
  { id: 2, name: 'Remote Config Mug', price: '$18' },
  { id: 3, name: 'Segment Override Hoodie', price: '$54' },
  { id: 4, name: 'Canary Release Cap', price: '$24' },
  { id: 5, name: 'Kill Switch Mechanical Keycap', price: '$15' },
  { id: 6, name: 'X-Ray Inspector Sticker Pack', price: '$9' },
  { id: 7, name: 'Observability Desk Mat', price: '$32' },
  { id: 8, name: 'Edge SDK Backpack', price: '$79' },
  { id: 9, name: 'Audit Log Notebook', price: '$16' },
  { id: 10, name: 'Self-Hosted Docker Tee', price: '$28' },
];

const ENV_KEY = import.meta.env.VITE_FLAGSMITH_ENV_KEY as string | undefined;
const API_URL = (import.meta.env.VITE_FLAGSMITH_API as string | undefined) || 'http://localhost:8000/api/v1/';

interface FlagSnapshot {
  darkMode: boolean;
  promoBannerEnabled: boolean;
  promoBannerText: string;
  newCheckoutUi: boolean;
  aiRecommendations: boolean;
  maxItemsPerPage: number;
}

function readSnapshot(): FlagSnapshot {
  const rawMax = flagsmith.getValue('max_items_per_page');
  const parsedMax = Number(rawMax);
  const maxItemsPerPage = Number.isFinite(parsedMax) && parsedMax > 0 ? Math.min(parsedMax, CATALOG_ITEMS.length) : 6;

  return {
    darkMode: flagsmith.hasFeature('dark_mode'),
    promoBannerEnabled: flagsmith.hasFeature('promo_banner'),
    promoBannerText: String(flagsmith.getValue('promo_banner') ?? ''),
    newCheckoutUi: flagsmith.hasFeature('new_checkout_ui'),
    aiRecommendations: flagsmith.hasFeature('ai_recommendations'),
    maxItemsPerPage,
  };
}

export default function App() {
  const [persona, setPersona] = useState<PersonaKey>('anonymous');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flags, setFlags] = useState<FlagSnapshot>(() => readSnapshot());

  useEffect(() => {
    window.flagsmith = flagsmith;

    if (!ENV_KEY) {
      setError('Missing VITE_FLAGSMITH_ENV_KEY in demo-app/.env.local. Run `npm run seed` after starting Flagsmith.');
      return;
    }

    flagsmith
      .init({
        environmentID: ENV_KEY,
        api: API_URL,
        onChange: () => {
          setFlags(readSnapshot());
          setReady(true);
        },
      })
      .then(() => {
        setFlags(readSnapshot());
        setReady(true);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to initialize Flagsmith SDK');
      });
  }, []);

  async function switchPersona(nextKey: PersonaKey) {
    setPersona(nextKey);
    if (!ENV_KEY) return;
    const target = PERSONAS[nextKey];
    try {
      if (!target.identifier) {
        await flagsmith.logout();
      } else {
        await flagsmith.identify(target.identifier, target.traits);
      }
      setFlags(readSnapshot());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to switch identity');
    }
  }

  const activePersona = PERSONAS[persona];
  const visibleItems = CATALOG_ITEMS.slice(0, flags.maxItemsPerPage);

  return (
    <div className={`app-shell ${flags.darkMode ? 'theme-dark' : ''}`}>
      {flags.promoBannerEnabled && flags.promoBannerText && (
        <div className="promo-banner">{flags.promoBannerText}</div>
      )}

      <div className="container">
        <header className="header">
          <div className="brand">
            <h1>Flagsmith X-Ray Storefront</h1>
            <p>
              Connected to <code>{API_URL}</code> {ready ? '• SDK Ready' : '• Waiting for SDK'}
            </p>
          </div>

          <div className="persona-bar">
            <span className="persona-label">Persona:</span>
            {Object.values(PERSONAS).map((p) => (
              <button
                key={p.key}
                type="button"
                className={`btn ${persona === p.key ? 'active' : ''}`}
                onClick={() => void switchPersona(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </header>

        {error && <div className="notice">{error}</div>}

        <div className="grid-main">
          <div>
            <div className="card">
              <div className="section-title">
                <span>Catalog</span>
                <span className="badge">
                  max_items_per_page: {flags.maxItemsPerPage}
                </span>
              </div>
              <div className="catalog-grid">
                {visibleItems.map((item) => (
                  <div key={item.id} className="product-card">
                    <div className="product-name">{item.name}</div>
                    <div className="product-price">{item.price}</div>
                  </div>
                ))}
              </div>
            </div>

            {flags.aiRecommendations && (
              <div className="card ai-shelf">
                <div className="section-title">
                  <span>Recommended For You</span>
                  <span className="badge success">AI Recommendations Active</span>
                </div>
                <div className="catalog-grid">
                  <div className="product-card">
                    <div className="product-name">Smart Flag Rollout Bundle</div>
                    <div className="product-price">$49 • 98% match</div>
                  </div>
                  <div className="product-card">
                    <div className="product-name">Beta Tester VIP Pass</div>
                    <div className="product-price">$0 • 95% match</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <aside>
            <div className={`card ${flags.newCheckoutUi ? 'checkout-express' : ''}`}>
              <div className="section-title">
                <span>{flags.newCheckoutUi ? 'Express Checkout' : 'Classic Checkout'}</span>
                <span className={`badge ${flags.newCheckoutUi ? 'success' : ''}`}>
                  {flags.newCheckoutUi ? 'new_checkout_ui: ON' : 'new_checkout_ui: OFF'}
                </span>
              </div>

              <div className="checkout-row">
                <span>Items in cart</span>
                <strong>2</strong>
              </div>
              <div className="checkout-row">
                <span>Subtotal</span>
                <strong>$47.00</strong>
              </div>
              {flags.newCheckoutUi ? (
                <>
                  <div className="checkout-row">
                    <span>1-Click Instant Pay</span>
                    <strong>Enabled</strong>
                  </div>
                  <button type="button" className="checkout-cta">
                    Pay Instantly ($47.00)
                  </button>
                </>
              ) : (
                <button type="button" className="btn" style={{ width: '100%', marginTop: 12 }}>
                  Proceed to Standard Checkout
                </button>
              )}
            </div>
          </aside>
        </div>

        <section className="status-bar">
          <div className="status-meta">
            <div>
              <strong>Identity:</strong>{' '}
              <code>{activePersona.identifier ?? 'anonymous'}</code>
            </div>
            <div>
              <strong>Traits:</strong>{' '}
              <code>
                {Object.keys(activePersona.traits).length > 0
                  ? JSON.stringify(activePersona.traits)
                  : '{}'}
              </code>
            </div>
          </div>

          <div className="status-flags">
            <div className="flag-chip">
              <code>dark_mode</code>: {String(flags.darkMode)}
            </div>
            <div className="flag-chip">
              <code>new_checkout_ui</code>: {String(flags.newCheckoutUi)}
            </div>
            <div className="flag-chip">
              <code>ai_recommendations</code>: {String(flags.aiRecommendations)}
            </div>
            <div className="flag-chip">
              <code>promo_banner</code>: {flags.promoBannerEnabled ? `"${flags.promoBannerText}"` : 'OFF'}
            </div>
            <div className="flag-chip">
              <code>max_items_per_page</code>: {flags.maxItemsPerPage}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
