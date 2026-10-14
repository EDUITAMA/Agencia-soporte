#!/usr/bin/env node
// aXet Flows mock host — projects proxy.
//
// Part of the mock host, NOT of the application. It reproduces, during local
// development, the server-side calls the real aXet Flows shell makes to aXet
// Core so the mock can render the "select a project" screen. aXet Core sends no
// CORS headers, so the browser (localhost:4200) cannot call it directly; this
// out-of-browser process does it instead.
//
// Never bundled, linted or deployed: the frontend zip is built only from
// frontend/dist/browser. See ./README.md.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MOCK_PROXY_PORT || 4300);
const DEFAULT_AXET_CORE_URL = 'https://axet.nttdata.com/api/core/v1';
const ALLOWED_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

// aXet Core uses a corporate TLS certificate that may not be in the local trust
// store (same rationale as the mysql-connection skill). This affects only this
// mock process running on the developer machine — never production.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function readAxetCoreUrl() {
  // The mock reuses the backend's configured aXet Core base URL so both stay in
  // sync. It only reads the value; it never writes to backend/.env.
  const envPath = path.resolve(HERE, '..', '..', 'backend', '.env');
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    const match = content.match(/^AXET_CORE_URL=(.*)$/m);
    if (match) {
      const value = match[1].trim().replace(/^["']|["']$/g, '');
      if (value) return value.replace(/\/+$/, '');
    }
  } catch {
    // backend/.env not present yet — fall back to the well-known default.
  }
  return DEFAULT_AXET_CORE_URL;
}

const AXET_CORE_URL = readAxetCoreUrl();

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function decodeJwtPayload(token) {
  const payload = String(token || '').split('.')[1];
  if (!payload) return null;
  try {
    return JSON.parse(base64UrlDecode(payload));
  } catch {
    return null;
  }
}

function extractOktaId(claims) {
  const candidate = claims.uid || claims.okta_id || claims.sub || '';
  return String(candidate).trim();
}

function normalizeProject(project) {
  const id = String(project?.id ?? '').trim();
  const displayName = String(project?.displayName ?? project?.name ?? '').trim();
  if (!id || !displayName) return null;
  return { id, displayName };
}

async function fetchUser(accessToken, oktaId) {
  const response = await fetch(`${AXET_CORE_URL}/users/${encodeURIComponent(oktaId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error = new Error(`aXet Core /users/:id returned ${response.status}${body ? `: ${body}` : ''}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function fetchProjectsByIds(accessToken, ids) {
  const response = await fetch(`${AXET_CORE_URL}/projects/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      search: { ids },
      pagination: { size: 50, page: 0 },
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const error = new Error(`aXet Core /projects/search returned ${response.status}${body ? `: ${body}` : ''}`);
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  const data = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  return data.map(normalizeProject).filter(Boolean);
}

async function resolveProjects(accessToken) {
  const claims = decodeJwtPayload(accessToken);
  if (!claims) {
    const error = new Error('The provided token is not a decodable JWT');
    error.status = 400;
    throw error;
  }

  const oktaId = extractOktaId(claims);
  if (!oktaId) {
    const error = new Error('The token has no okta id claim (uid/okta_id/sub)');
    error.status = 400;
    throw error;
  }

  const user = await fetchUser(accessToken, oktaId);
  const projectIds = Array.isArray(user?.projects)
    ? user.projects.filter((value) => typeof value === 'string' && value.length > 0)
    : [];

  if (!projectIds.length) return [];
  return fetchProjectsByIds(accessToken, projectIds);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGIN.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/mock-api/health') {
    sendJson(res, 200, { status: 'ok', axetCoreUrl: AXET_CORE_URL });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/mock-api/projects') {
    const authHeader = req.headers.authorization || '';
    const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!accessToken) {
      sendJson(res, 401, { error: 'Missing Authorization: Bearer <access_token> header' });
      return;
    }

    try {
      const projects = await resolveProjects(accessToken);
      sendJson(res, 200, projects);
    } catch (error) {
      const status = Number(error?.status) || 502;
      console.error('[mock-proxy] projects resolution failed:', error?.message || error);
      sendJson(res, status, { error: error?.message || 'Unknown error resolving projects' });
    }
    return;
  }

  sendJson(res, 404, { error: `Not found: ${req.method} ${url.pathname}` });
});

server.listen(PORT, () => {
  console.log(`[mock-proxy] aXet Flows mock projects proxy listening on http://localhost:${PORT}`);
  console.log(`[mock-proxy] proxying aXet Core at ${AXET_CORE_URL}`);
});
