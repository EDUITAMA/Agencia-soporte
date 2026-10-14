(function () {
  'use strict';

  const AUTH_URL = 'https://axet.nttdata.com/flows/backend/okta/auth';
  const LOCAL_BACKEND_BASE = 'http://localhost:3000';
  // Mock-only projects proxy. aXet Core sends no CORS headers, so the browser
  // cannot call it directly; this proxy (frontend/mock-server) does it host-side,
  // mirroring what the real aXet Flows shell does. It is part of the mock host and
  // never ships with the app. See frontend/mock-server/README.md.
  const MOCK_PROJECTS_PROXY = 'http://localhost:4300/mock-api/projects';
  const HOME_PAGE = 'index.html';
  const PROJECT_PAGE = 'project.html';
  const SESSION_KEY = 'axetMockHost.userInfo';
  const WRAPPER_AUTH_KEY = 'axetMockHost.wrapperAuth';
  const PROJECTS_KEY = 'axetMockHost.projects';
  const SELECTED_PROJECT_KEY = 'axetMockHost.selectedProject';
  const LOGIN_FLOW_KEY = 'axetMockHost.loginFlow';
  const LOGIN_STARTED_PREFIX = 'axetMockHost.loginStartedAt.';
  const LOGIN_LOOP_GUARD_MS = 10 * 1000;
  const TOKEN_EXPIRY_SKEW_SECONDS = 60;

  function base64UrlDecode(value) {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return atob(padded);
  }

  function decodeJwt(token) {
    const payload = String(token || '').split('.')[1];
    if (!payload) return null;
    try {
      return JSON.parse(base64UrlDecode(payload));
    } catch (error) {
      console.error('[data-mock] Could not decode JWT payload', error);
      return null;
    }
  }

  function isJwtExpired(token) {
    const claims = decodeJwt(token);
    const exp = Number(claims && claims.exp);
    return Number.isFinite(exp) && Date.now() / 1000 >= exp - TOKEN_EXPIRY_SKEW_SECONDS;
  }

  function looksLikeJwt(value) {
    return /^eyJ[^.]+\.[^.]+\.[^.]+/.test(String(value || ''));
  }

  function readJson(key) {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      sessionStorage.removeItem(key);
      return null;
    }
  }

  function writeJson(key, value) {
    sessionStorage.setItem(key, JSON.stringify(value));
  }

  function removeKeys(keys) {
    for (const key of keys) {
      sessionStorage.removeItem(key);
    }
  }

  function getCurrentPageUrl(pageName) {
    return new URL(pageName, window.location.href);
  }

  function getHomeUrl() {
    return getCurrentPageUrl(HOME_PAGE);
  }

  function getProjectUrl() {
    return getCurrentPageUrl(PROJECT_PAGE);
  }

  function isProjectPage() {
    return window.location.pathname.endsWith(`/${PROJECT_PAGE}`) || window.location.pathname === `/${PROJECT_PAGE}`;
  }

  function cleanAuthResponseFromUrl() {
    const cleanUrl = `${window.location.origin}${window.location.pathname}`;
    window.history.replaceState({}, document.title, cleanUrl);
  }

  function getRedirectUri() {
    return `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
  }

  function getLoginStartedKey(mode) {
    return `${LOGIN_STARTED_PREFIX}${mode}`;
  }

  function startLogin(mode) {
    const startedAt = Number(sessionStorage.getItem(getLoginStartedKey(mode)) || '0');
    if (Date.now() - startedAt < LOGIN_LOOP_GUARD_MS) {
      return;
    }

    sessionStorage.setItem(getLoginStartedKey(mode), String(Date.now()));
    sessionStorage.setItem(LOGIN_FLOW_KEY, mode);

    const authUrl = new URL(AUTH_URL);
    authUrl.searchParams.set('redirectUri', getRedirectUri());
    window.location.assign(authUrl.toString());
  }

  function clearLoginFlow(mode) {
    sessionStorage.removeItem(LOGIN_FLOW_KEY);
    sessionStorage.removeItem(getLoginStartedKey(mode));
  }

  function captureAuthResponseFromUrl() {
    const params = new URLSearchParams(window.location.search);

    const wrapperJwt =
      params.get('data') ||
      params.get('jwt') ||
      params.get('token') ||
      params.get('accessToken') ||
      params.get('access_token');

    if (looksLikeJwt(wrapperJwt)) {
      writeJson(WRAPPER_AUTH_KEY, {
        jwt: wrapperJwt,
        idToken: params.get('id_token') || undefined,
      });
      removeKeys([
        SESSION_KEY,
        PROJECTS_KEY,
        SELECTED_PROJECT_KEY,
      ]);
      clearLoginFlow('wrapper');
      cleanAuthResponseFromUrl();
    }
  }

  function readStoredWrapperAuth() {
    const auth = readJson(WRAPPER_AUTH_KEY);
    if (!auth || typeof auth.jwt !== 'string' || isJwtExpired(auth.jwt)) {
      removeKeys([WRAPPER_AUTH_KEY, SESSION_KEY, PROJECTS_KEY, SELECTED_PROJECT_KEY]);
      return null;
    }
    return auth;
  }

  function readStoredProjects() {
    const projects = readJson(PROJECTS_KEY);
    return Array.isArray(projects) ? projects : null;
  }

  function readSelectedProject() {
    const project = readJson(SELECTED_PROJECT_KEY);
    if (!project || typeof project.id !== 'string' || typeof project.displayName !== 'string') {
      sessionStorage.removeItem(SELECTED_PROJECT_KEY);
      return null;
    }
    return project;
  }

  function normalizeProject(project) {
    const id = String(project?.code || project?.id || '').trim();
    const displayName = String(project?.name || project?.displayName || '').trim();
    if (!id || !displayName) return null;
    return { id, displayName };
  }

  async function tryFetchProjects(accessToken) {
    const response = await fetch(MOCK_PROJECTS_PROXY, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      mode: 'cors',
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Project lookup failed with status ${response.status}${body ? `: ${body}` : ''}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error('Project lookup returned a non-array payload');
    }

    return data.map(normalizeProject).filter(Boolean);
  }

  async function fetchUserProjects(wrapperAuth) {
    const wrapperClaims = decodeJwt(wrapperAuth.jwt) || {};
    const accessToken = String(wrapperClaims.access_token || '').trim();
    if (!accessToken) {
      throw new Error('The host jwt does not contain an access_token claim');
    }

    try {
      const projects = await tryFetchProjects(accessToken);
      writeJson(PROJECTS_KEY, projects);
      return projects;
    } catch (error) {
      console.warn('[data-mock] local Axet project proxy did not return projects', error);
      throw error;
    }
  }

  function buildUserInfoFromJwt(jwt, idToken, selectedProject) {
    const claims = decodeJwt(jwt) || {};
    const now = Date.now();
    const oktaId = String(claims.okta_id || claims.uid || claims.sub || '');
    const login = String(claims.login || claims.shortEmail || claims.email || claims.sub || '');
    const userName = String(
      claims.displayName ||
      claims.fullName ||
      `${claims.firstName || ''} ${claims.lastName || ''}`.trim() ||
      login,
    );

    return {
      __cookieId: oktaId || '00000000-0000-0000-0000-000000000000',
      valid: true,
      logged: true,
      errors: {},
      sessionCreated: Number(claims.auth_time || claims.iat || Math.floor(now / 1000)) * 1000,
      oktaId,
      login,
      userName,
      userRoles: 'ROLE_ADMIN',
      jwt,
      axetUserId: oktaId,
      enablerModel: null,
      sessionUpdated: now,
      axetProject: selectedProject || {
        id: '00000000-0000-0000-0000-000000000000',
        displayName: 'Local Mock Project',
      },
      idToken: idToken || claims.id_token,
    };
  }

  function goToHome() {
    window.location.replace(getHomeUrl().toString());
  }

  function goToProjectSelection() {
    window.location.replace(getProjectUrl().toString());
  }

  function renderProjectSelection({ userName, projects, selectedProjectId, errorMessage }) {
    const mount = document.getElementById('projectSelectionRoot');
    if (!mount) return;

    if (errorMessage) {
      mount.innerHTML = `
        <section class="mock-project-shell">
          <div class="mock-project-card">
            <header class="mock-project-header">
              <i class="fas fa-exclamation-triangle" aria-hidden="true"></i>
              <span>Could not load your Axet projects</span>
            </header>
            <div class="mock-project-body">
              <p class="mock-project-error">${errorMessage}</p>
              <div class="mock-project-actions">
                <button type="button" class="btn btn-primary btn-block" id="retryProjectSelection">Retry</button>
                <a class="btn btn-outline-secondary btn-block" href="login.html">Logout</a>
              </div>
            </div>
          </div>
        </section>
      `;

      const retryButton = document.getElementById('retryProjectSelection');
      if (retryButton) {
        retryButton.addEventListener('click', () => {
          removeKeys([SESSION_KEY, PROJECTS_KEY, SELECTED_PROJECT_KEY]);
          window.location.reload();
        });
      }
      return;
    }

    const options = projects
      .map((project) => {
        const isSelected = project.id === selectedProjectId ? ' selected' : '';
        return `<option value="${project.id}"${isSelected}>${project.displayName}</option>`;
      })
      .join('');

    mount.innerHTML = `
      <section class="mock-project-shell">
        <div class="mock-project-card">
          <header class="mock-project-header">
            <i class="fas fa-sign-in-alt" aria-hidden="true"></i>
            <span>Welcome ${userName}, please select a project</span>
          </header>
          <form class="mock-project-body" id="projectSelectionForm">
            <select class="form-control mock-project-select" id="projectSelectionInput" required>
              ${options}
            </select>
            <button type="submit" class="btn btn-primary btn-block mock-project-submit">Send</button>
          </form>
          <footer class="mock-project-footer">Powered by aXet.flows © 2026 NTT Data. All Rights Reserved</footer>
        </div>
      </section>
    `;

    const form = document.getElementById('projectSelectionForm');
    const select = document.getElementById('projectSelectionInput');
    if (!form || !select) return;

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const project = projects.find((candidate) => candidate.id === select.value);
      if (!project) return;
      writeJson(SELECTED_PROJECT_KEY, project);
      sessionStorage.removeItem(SESSION_KEY);
      goToHome();
    });
  }

  async function handleProjectPage() {
    const wrapperAuth = readStoredWrapperAuth();
    if (!wrapperAuth) {
      startLogin('wrapper');
      return;
    }

    const claims = decodeJwt(wrapperAuth.jwt) || {};
    const userName = String(
      claims.displayName ||
      claims.fullName ||
      `${claims.firstName || ''} ${claims.lastName || ''}`.trim() ||
      claims.login ||
      claims.email ||
      'user',
    );

    let projects = readStoredProjects();

    try {
      if (!projects?.length) {
        projects = await fetchUserProjects(wrapperAuth);
      }
    } catch (error) {
      console.error('[data-mock] Could not prepare project selection', error);
      renderProjectSelection({
        userName,
        projects: [],
        selectedProjectId: '',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      return;
    }

    if (!projects) {
      return;
    }

    if (!projects.length) {
      renderProjectSelection({
        userName,
        projects: [],
        selectedProjectId: '',
        errorMessage: 'The authenticated user does not have any Axet project assigned.',
      });
      return;
    }

    if (projects.length === 1) {
      writeJson(SELECTED_PROJECT_KEY, projects[0]);
      sessionStorage.removeItem(SESSION_KEY);
      goToHome();
      return;
    }

    renderProjectSelection({
      userName,
      projects,
      selectedProjectId: readSelectedProject()?.id || projects[0].id,
    });
  }

  async function resolveUserInfo() {
    const wrapperAuth = readStoredWrapperAuth();
    if (!wrapperAuth) {
      startLogin('wrapper');
      return null;
    }

    const selectedProject = readSelectedProject();
    if (!selectedProject) {
      goToProjectSelection();
      return null;
    }

    const info = buildUserInfoFromJwt(wrapperAuth.jwt, wrapperAuth.idToken, selectedProject);
    writeJson(SESSION_KEY, info);
    return info;
  }

  const DeptAppService = {
    async getUserInfo() {
      const info = await resolveUserInfo();
      if (info) return info;

      return new Promise(() => {
        // Navigation is in progress; the browser will come back with fresh auth
        // data or a selected Axet project before this promise can resolve.
      });
    },
  };

  globalThis.DeptAppService = DeptAppService;
  globalThis.backendApiBase = LOCAL_BACKEND_BASE;

  captureAuthResponseFromUrl();

  if (isProjectPage()) {
    handleProjectPage();
  } else {
    resolveUserInfo();
  }
})();
