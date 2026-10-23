/**
 * ExamAI - Authentication & Session Management Module (auth.js)
 * Handles client-side authentication, JWT session verification,
 * authenticated API requests, user profiles, and theme toggling.
 */

// ==========================================
// API Base URL Detection
// ==========================================
// If opened via VS Code Live Server (e.g. port 5500, 5501) or file://,
// route API calls to the Express backend on http://localhost:3000
const API_BASE = (window.location.port !== '3000' && window.location.protocol.startsWith('http'))
  ? 'http://localhost:3000'
  : '';

/**
 * Safely parses JSON from a response, with helpful diagnostic error messages.
 */
async function parseJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    if (window.location.port !== '3000') {
      throw new Error(
        'Cannot reach the Node.js backend! You opened this page via VS Code Live Server (port ' +
        window.location.port + '). Please run "npm start" in terminal and open http://localhost:3000 instead.'
      );
    }
    throw new Error('Server returned invalid response (Status ' + response.status + '). Check that the server is running.');
  }
}
const STORAGE_KEYS = {
  TOKEN: 'examai_token',
  USER: 'examai_user',
  THEME: 'examai_theme',
  PROFILE_PREFIX: 'examai_profile_',
  CHATS_PREFIX: 'examai_chats_',
  PROGRESS_PREFIX: 'examai_progress_'
};

// ==========================================
// Authentication Utilities
// ==========================================

/**
 * Retrieves the stored JWT token.
 * @returns {string|null}
 */
function getAuthToken() {
  return localStorage.getItem(STORAGE_KEYS.TOKEN);
}

/**
 * Retrieves the currently logged-in user profile object.
 * @returns {object|null}
 */
function getCurrentUser() {
  const data = localStorage.getItem(STORAGE_KEYS.USER);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

/**
 * Logs out the current user, clears tokens, and redirects to login.html.
 */
function logout() {
  localStorage.removeItem(STORAGE_KEYS.TOKEN);
  localStorage.removeItem(STORAGE_KEYS.USER);
  window.location.href = 'login.html';
}

/**
 * Authenticated Fetch Wrapper
 * Automatically adds the Authorization header with Bearer token.
 * If the server responds with a 401 Unauthorized (expired token),
 * it wipes the session and redirects to login.html.
 *
 * @param {string} url - API Endpoint
 * @param {object} options - Fetch options
 * @returns {Promise<Response>}
 */
async function authFetch(url, options = {}) {
  const token = getAuthToken();

  if (!token) {
    logout();
    throw new Error('No authentication token found. Please sign in.');
  }

  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`
  };

  const targetUrl = url.startsWith('/') ? `${API_BASE}${url}` : url;
  let response;
  try {
    response = await fetch(targetUrl, { ...options, headers });
  } catch (netErr) {
    if (window.location.port !== '3000') {
      throw new Error('Cannot connect to Node.js backend. Start it with "npm start" and open http://localhost:3000.');
    }
    throw netErr;
  }

  // Handle session expiration
  if (response.status === 401) {
    console.warn('Authentication token expired or invalid. Redirecting to login.');
    logout();
    throw new Error('Session expired. Please log in again.');
  }

  return response;
}

// ==========================================
// Theme Management (Light / Dark)
// ==========================================

/**
 * Initializes the theme based on localStorage or OS preferences.
 */
function initTheme() {
  const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
  let theme = savedTheme;

  if (!theme) {
    // Respect OS preference on first visit
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    theme = prefersDark ? 'dark' : 'light';
  }

  document.documentElement.setAttribute('data-theme', theme);
  return theme;
}

/**
 * Toggles between dark and light themes and persists the selection.
 */
function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem(STORAGE_KEYS.THEME, newTheme);
}

// ==========================================
// User Personalization Profile Storage
// ==========================================

/**
 * Gets student personalization preferences scoped to the user ID.
 * @returns {object}
 */
function getUserProfile() {
  const user = getCurrentUser();
  if (!user || !user.id) return {};
  const key = `${STORAGE_KEYS.PROFILE_PREFIX}${user.id}`;
  const data = localStorage.getItem(key);
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

/**
 * Saves student personalization preferences scoped to the user ID.
 * @param {object} profile
 */
function saveUserProfile(profile) {
  const user = getCurrentUser();
  if (!user || !user.id) return;
  const key = `${STORAGE_KEYS.PROFILE_PREFIX}${user.id}`;
  localStorage.setItem(key, JSON.stringify(profile));
}

// ==========================================
// Login Page Logic (runs only on login.html)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // Initialize theme on all pages
  initTheme();

  // Attach theme toggle buttons if present
  const themeToggleBtns = document.querySelectorAll('#themeToggleBtn');
  themeToggleBtns.forEach((btn) => {
    btn.addEventListener('click', toggleTheme);
  });

  const isLoginPage = window.location.pathname.endsWith('login.html') || document.body.classList.contains('auth-page');

  // If already logged in and on the login page, redirect to index.html
  if (isLoginPage) {
    if (getAuthToken()) {
      window.location.href = 'index.html';
      return;
    }

    const tabLogin = document.getElementById('tabLogin');
    const tabSignup = document.getElementById('tabSignup');
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const authAlert = document.getElementById('authAlert');
    const authAlertMessage = document.getElementById('authAlertMessage');

    // Helper to display alert errors
    function showAlert(msg) {
      if (!authAlert || !authAlertMessage) return;
      authAlertMessage.textContent = msg;
      authAlert.classList.remove('alert--hidden');
    }

    function hideAlert() {
      if (!authAlert) return;
      authAlert.classList.add('alert--hidden');
    }

    // Tab Switching
    if (tabLogin && tabSignup) {
      tabLogin.addEventListener('click', () => {
        tabLogin.classList.add('auth-tabs__btn--active');
        tabLogin.setAttribute('aria-selected', 'true');
        tabSignup.classList.remove('auth-tabs__btn--active');
        tabSignup.setAttribute('aria-selected', 'false');

        loginForm.style.display = 'flex';
        signupForm.style.display = 'none';
        hideAlert();
      });

      tabSignup.addEventListener('click', () => {
        tabSignup.classList.add('auth-tabs__btn--active');
        tabSignup.setAttribute('aria-selected', 'true');
        tabLogin.classList.remove('auth-tabs__btn--active');
        tabLogin.setAttribute('aria-selected', 'false');

        signupForm.style.display = 'flex';
        loginForm.style.display = 'none';
        hideAlert();
      });
    }

    // Show/Hide Password Toggles
    const togglePasswordBtns = document.querySelectorAll('.btn-toggle-password');
    togglePasswordBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const input = document.getElementById(targetId);
        if (!input) return;

        const eyeIcon = btn.querySelector('.icon--eye');
        const eyeOffIcon = btn.querySelector('.icon--eye-off');

        if (input.type === 'password') {
          input.type = 'text';
          if (eyeIcon) eyeIcon.style.display = 'none';
          if (eyeOffIcon) eyeOffIcon.style.display = 'block';
        } else {
          input.type = 'password';
          if (eyeIcon) eyeIcon.style.display = 'block';
          if (eyeOffIcon) eyeOffIcon.style.display = 'none';
        }
      });
    });

    // Handle Login Submit
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideAlert();

        const email = document.getElementById('loginEmail')?.value.trim();
        const password = document.getElementById('loginPassword')?.value;
        const submitBtn = document.getElementById('loginSubmitBtn');

        if (!email || !password) {
          showAlert('Please fill in both email and password.');
          return;
        }

        try {
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.querySelector('.btn__text').textContent = 'Signing in...';
          }

          let response;
          try {
            response = await fetch(`${API_BASE}/api/login`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, password })
            });
          } catch (netErr) {
            throw new Error(
              'Cannot reach the Node.js backend server! Please start the server using "npm start" (or start.bat) and open http://localhost:3000 (do not use VS Code Live Server on port 5501).'
            );
          }

          const data = await parseJsonResponse(response);

          if (!response.ok) {
            throw new Error(data.error || 'Login failed. Please check your credentials or create an account first.');
          }

          // Save token & user profile
          localStorage.setItem(STORAGE_KEYS.TOKEN, data.token);
          localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(data.user));

          // Redirect to main portal
          window.location.href = 'index.html';
        } catch (err) {
          showAlert(err.message);
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.querySelector('.btn__text').textContent = 'Sign In';
          }
        }
      });
    }

    // Handle Signup Submit
    if (signupForm) {
      signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideAlert();

        const name = document.getElementById('signupName')?.value.trim();
        const email = document.getElementById('signupEmail')?.value.trim();
        const password = document.getElementById('signupPassword')?.value;
        const submitBtn = document.getElementById('signupSubmitBtn');

        if (!name || name.length < 2) {
          showAlert('Please enter your full name (minimum 2 characters).');
          return;
        }
        if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
          showAlert('Please enter a valid email address.');
          return;
        }
        if (!password || password.length < 6) {
          showAlert('Password must be at least 6 characters long.');
          return;
        }

        try {
          if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.querySelector('.btn__text').textContent = 'Creating Account...';
          }

          let response;
          try {
            response = await fetch(`${API_BASE}/api/signup`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, email, password })
            });
          } catch (netErr) {
            throw new Error(
              'Cannot reach the Node.js backend server! Please start the server using "npm start" (or start.bat) and open http://localhost:3000.'
            );
          }

          const data = await parseJsonResponse(response);

          if (!response.ok) {
            throw new Error(data.error || 'Registration failed. Please try again.');
          }

          // Save token & user
          localStorage.setItem(STORAGE_KEYS.TOKEN, data.token);
          localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(data.user));

          // Redirect to index
          window.location.href = 'index.html';
        } catch (err) {
          showAlert(err.message);
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.querySelector('.btn__text').textContent = 'Create Account';
          }
        }
      });
    }
  } else {
    // We are on index.html: Verify that a valid token exists
    if (!getAuthToken()) {
      window.location.href = 'login.html';
    }
  }
});
