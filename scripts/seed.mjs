#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_LOCAL_PATH = path.join(ROOT_DIR, 'demo-app', '.env.local');

const BASE_URL = (process.env.FLAGSMITH_URL || 'http://localhost:8000').replace(/\/+$/, '');
const API_URL = `${BASE_URL}/api/v1`;

const ADMIN_EMAIL = process.env.FLAGSMITH_ADMIN_EMAIL || 'admin@xray.local';
const ADMIN_PASSWORD = process.env.FLAGSMITH_ADMIN_PASSWORD || 'XRayDemo123!';
const ORG_NAME = 'X-Ray Demo Org';
const PROJECT_NAME = 'X-Ray Demo App';
const ENV_NAME = 'Development';

const SAMPLE_FLAGS = [
  {
    name: 'new_checkout_ui',
    description: 'Enables the redesigned express checkout card.',
    default_enabled: false,
    initial_value: null,
  },
  {
    name: 'dark_mode',
    description: 'Switches the demo storefront to dark theme.',
    default_enabled: false,
    initial_value: null,
  },
  {
    name: 'promo_banner',
    description: 'Top announcement banner copy (remote config string).',
    default_enabled: true,
    initial_value: 'Welcome to Flagsmith X-Ray! Open the extension to override any flag locally.',
  },
  {
    name: 'ai_recommendations',
    description: 'Displays AI-powered product recommendations badge & shelf.',
    default_enabled: false,
    initial_value: null,
  },
  {
    name: 'max_items_per_page',
    description: 'Controls how many catalog items render per page (number/JSON config).',
    default_enabled: true,
    initial_value: '6',
  },
];

const SEGMENT_OVERRIDES = [
  {
    featureName: 'new_checkout_ui',
    enabled: true,
    feature_state_value: null,
  },
  {
    featureName: 'ai_recommendations',
    enabled: true,
    feature_state_value: null,
  },
  {
    featureName: 'promo_banner',
    enabled: true,
    feature_state_value: 'BETA ACCESS: Express Checkout & AI Recommendations unlocked!',
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiRequest(endpoint, { method = 'GET', token, body } = {}) {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Token ${token}`;
  }

  const res = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${method} ${endpoint}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

function unwrapList(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.results)) return data.results;
  return [];
}

async function waitForHealth(timeoutMs = 120_000) {
  const start = Date.now();
  process.stdout.write(`Waiting for Flagsmith at ${BASE_URL}/health `);
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) {
        console.log('ready!');
        return;
      }
    } catch {
      // ignore connection refused while booting
    }
    process.stdout.write('.');
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for Flagsmith health check at ${BASE_URL}/health`);
}

async function authenticate() {
  // Try logging in first (idempotent)
  try {
    const loginData = await apiRequest('/auth/login/', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    if (loginData?.key) {
      console.log(`Logged in as existing admin (${ADMIN_EMAIL})`);
      return loginData.key;
    }
  } catch {
    // Fall through to registration
  }

  // Register local admin user
  try {
    const regData = await apiRequest('/auth/users/', {
      method: 'POST',
      body: {
        email: ADMIN_EMAIL,
        first_name: 'X-Ray',
        last_name: 'Admin',
        password: ADMIN_PASSWORD,
        re_password: ADMIN_PASSWORD,
      },
    });
    if (regData?.key) {
      console.log(`Registered admin user (${ADMIN_EMAIL})`);
      return regData.key;
    }
  } catch (err) {
    // Some Flagsmith versions return user without key on register, so login right after
    if (err.status && err.status >= 500) throw err;
  }

  const loginData = await apiRequest('/auth/login/', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (!loginData?.key) {
    throw new Error('Failed to authenticate with Flagsmith API');
  }
  console.log(`Authenticated as ${ADMIN_EMAIL}`);
  return loginData.key;
}

async function ensureOrganisation(token) {
  const orgs = unwrapList(await apiRequest('/organisations/', { token }));
  const existing = orgs.find((o) => o.name === ORG_NAME);
  if (existing) {
    console.log(`Using existing organisation: ${ORG_NAME} (id=${existing.id})`);
    return existing;
  }
  const created = await apiRequest('/organisations/', {
    method: 'POST',
    token,
    body: { name: ORG_NAME },
  });
  console.log(`Created organisation: ${ORG_NAME} (id=${created.id})`);
  return created;
}

async function ensureProject(token, organisationId) {
  const projects = unwrapList(await apiRequest(`/projects/?organisation=${organisationId}`, { token }));
  const existing = projects.find((p) => p.name === PROJECT_NAME);
  if (existing) {
    console.log(`Using existing project: ${PROJECT_NAME} (id=${existing.id})`);
    return existing;
  }
  const created = await apiRequest('/projects/', {
    method: 'POST',
    token,
    body: { name: PROJECT_NAME, organisation: organisationId },
  });
  console.log(`Created project: ${PROJECT_NAME} (id=${created.id})`);
  return created;
}

async function ensureEnvironment(token, projectId) {
  const envs = unwrapList(await apiRequest(`/environments/?project=${projectId}`, { token }));
  const existing = envs.find((e) => e.name === ENV_NAME) || envs[0];
  if (existing) {
    console.log(`Using environment: ${existing.name} (api_key=${existing.api_key})`);
    return existing;
  }
  const created = await apiRequest('/environments/', {
    method: 'POST',
    token,
    body: { name: ENV_NAME, project: projectId },
  });
  console.log(`Created environment: ${created.name} (api_key=${created.api_key})`);
  return created;
}

async function ensureFeatures(token, projectId, envApiKey) {
  const existingList = unwrapList(await apiRequest(`/projects/${projectId}/features/`, { token }));
  const featureByName = new Map(existingList.map((f) => [f.name, f]));

  for (const spec of SAMPLE_FLAGS) {
    let feature = featureByName.get(spec.name);
    if (!feature) {
      feature = await apiRequest(`/projects/${projectId}/features/`, {
        method: 'POST',
        token,
        body: {
          name: spec.name,
          description: spec.description,
          type: 'STANDARD',
          default_enabled: spec.default_enabled,
          initial_value: spec.initial_value,
        },
      });
      featureByName.set(spec.name, feature);
      console.log(`Created feature: ${spec.name} (id=${feature.id})`);
    } else {
      console.log(`Feature already exists: ${spec.name} (id=${feature.id})`);
    }
  }

  // Ensure environment-level defaults match spec
  const envStates = unwrapList(
    await apiRequest(`/environments/${envApiKey}/featurestates/`, { token })
  );
  const stateByFeatureId = new Map(
    envStates.filter((s) => !s.feature_segment && !s.identity).map((s) => [s.feature, s])
  );

  for (const spec of SAMPLE_FLAGS) {
    const feature = featureByName.get(spec.name);
    const state = stateByFeatureId.get(feature.id);
    if (state) {
      const needsUpdate =
        state.enabled !== spec.default_enabled ||
        (state.feature_state_value ?? null) !== (spec.initial_value ?? null);
      if (needsUpdate) {
        await apiRequest(`/environments/${envApiKey}/featurestates/${state.id}/`, {
          method: 'PUT',
          token,
          body: {
            ...state,
            enabled: spec.default_enabled,
            feature_state_value: spec.initial_value,
          },
        });
        console.log(`Updated default state for ${spec.name}`);
      }
    }
  }

  return featureByName;
}

async function ensureBetaSegment(token, projectId) {
  const segments = unwrapList(await apiRequest(`/projects/${projectId}/segments/`, { token }));
  const existing = segments.find((s) => s.name === 'beta_users');
  if (existing) {
    console.log(`Using existing segment: beta_users (id=${existing.id})`);
    return existing;
  }

  const created = await apiRequest(`/projects/${projectId}/segments/`, {
    method: 'POST',
    token,
    body: {
      name: 'beta_users',
      description: 'Users with trait beta=true',
      project: projectId,
      rules: [
        {
          type: 'ALL',
          conditions: [],
          rules: [
            {
              type: 'ANY',
              conditions: [
                {
                  operator: 'EQUAL',
                  property: 'beta',
                  value: 'true',
                },
              ],
              rules: [],
            },
          ],
        },
      ],
    },
  });
  console.log(`Created segment: beta_users (id=${created.id})`);
  return created;
}

async function ensureSegmentOverrides(token, env, segment, featureByName) {
  const existingSegments = unwrapList(
    await apiRequest(`/features/feature-segments/?environment=${env.id}`, { token })
  );

  for (const override of SEGMENT_OVERRIDES) {
    const feature = featureByName.get(override.featureName);
    if (!feature) continue;

    let featureSegment = existingSegments.find(
      (fs) => fs.feature === feature.id && fs.segment === segment.id
    );

    if (!featureSegment) {
      featureSegment = await apiRequest('/features/feature-segments/', {
        method: 'POST',
        token,
        body: {
          feature: feature.id,
          segment: segment.id,
          environment: env.id,
        },
      });
      console.log(`Linked segment beta_users -> ${override.featureName} (fs_id=${featureSegment.id})`);
    }

    // Find or create the featurestate tied to this feature_segment
    const envStates = unwrapList(
      await apiRequest(`/environments/${env.api_key}/featurestates/?feature=${feature.id}`, { token })
    );
    const segState = envStates.find((s) => s.feature_segment === featureSegment.id);

    if (segState) {
      await apiRequest(`/environments/${env.api_key}/featurestates/${segState.id}/`, {
        method: 'PUT',
        token,
        body: {
          ...segState,
          enabled: override.enabled,
          feature_state_value: override.feature_state_value,
        },
      });
      console.log(`Updated segment override for ${override.featureName}`);
    } else {
      await apiRequest('/features/featurestates/', {
        method: 'POST',
        token,
        body: {
          feature: feature.id,
          environment: env.id,
          feature_segment: featureSegment.id,
          enabled: override.enabled,
          feature_state_value: override.feature_state_value,
        },
      });
      console.log(`Created segment override for ${override.featureName}`);
    }
  }
}

async function writeDemoEnv(envApiKey) {
  await fs.mkdir(path.dirname(ENV_LOCAL_PATH), { recursive: true });
  const content = [
    '# Auto-generated by scripts/seed.mjs',
    `VITE_FLAGSMITH_ENV_KEY=${envApiKey}`,
    `VITE_FLAGSMITH_API=${API_URL}/`,
    '',
  ].join('\n');
  await fs.writeFile(ENV_LOCAL_PATH, content, 'utf8');
  console.log(`Wrote ${path.relative(ROOT_DIR, ENV_LOCAL_PATH)}`);
}

async function main() {
  await waitForHealth();
  const token = await authenticate();
  const org = await ensureOrganisation(token);
  const project = await ensureProject(token, org.id);
  const env = await ensureEnvironment(token, project.id);
  const featureByName = await ensureFeatures(token, project.id, env.api_key);
  const segment = await ensureBetaSegment(token, project.id);
  await ensureSegmentOverrides(token, env, segment, featureByName);
  await writeDemoEnv(env.api_key);

  console.log('\nFlagsmith seed complete!');
  console.log(`  Dashboard : ${BASE_URL}`);
  console.log(`  Admin     : ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`  Env Key   : ${env.api_key}`);
}

main().catch((err) => {
  console.error('\nSeed failed:', err.message);
  process.exit(1);
});
