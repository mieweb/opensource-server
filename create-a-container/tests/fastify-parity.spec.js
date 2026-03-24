// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3000';

async function quickLogin(request, role = 'admin') {
  const resp = await request.post(`${BASE}/login/quick`, {
    data: { role },
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
  });
  expect(resp.ok()).toBeTruthy();
  const body = await resp.json();
  expect(body.success).toBe(true);
  return body;
}

async function browserQuickLogin(page, role = 'admin') {
  await page.goto('/login');
  await page.evaluate(async (r) => {
    await fetch('/login/quick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: r }),
    });
  }, role);
}

// 1. UNAUTHENTICATED ACCESS
test.describe('Unauthenticated access', () => {
  test('GET / redirects to /login', async ({ page }) => {
    await page.goto('/');
    expect(page.url()).toContain('/login');
  });

  test('login page renders', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('form#loginForm')).toBeVisible();
    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test('register page renders', async ({ page }) => {
    await page.goto('/register');
    await expect(page.locator('form').first()).toBeVisible();
  });

  test('reset-password page renders', async ({ page }) => {
    await page.goto('/reset-password');
    await expect(page.locator('form').first()).toBeVisible();
  });

  test('protected pages redirect to login', async ({ page }) => {
    for (const path of ['/sites', '/users', '/groups', '/apikeys', '/settings']) {
      await page.goto(path);
      expect(page.url()).toContain('/login');
    }
  });
});

// 2. QUICK LOGIN
test.describe('Quick login', () => {
  test('quick login as admin via API', async ({ request }) => {
    const body = await quickLogin(request, 'admin');
    expect(body.user).toBe('admin');
    expect(body.isAdmin).toBe(true);
  });

  test('quick login as regular user via API', async ({ request }) => {
    const body = await quickLogin(request, 'user');
    expect(body.user).toBe('testuser');
    expect(body.isAdmin).toBe(false);
  });
});

// 3. AUTHENTICATED PAGES (admin)
test.describe('Authenticated pages (admin)', () => {
  test.beforeEach(async ({ page }) => {
    await browserQuickLogin(page, 'admin');
  });

  test('sites page renders', async ({ page }) => {
    await page.goto('/sites');
    expect(page.url()).toContain('/sites');
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
  });

  test('sites page has navigation', async ({ page }) => {
    await page.goto('/sites');
    await expect(page.locator('a[href="/sites"]').first()).toBeVisible();
  });

  test('sites page has version info in footer', async ({ page }) => {
    await page.goto('/sites');
    await expect(page.locator('.version-info')).toBeVisible();
  });

  test('users page renders (admin)', async ({ page }) => {
    await page.goto('/users');
    expect(page.url()).toContain('/users');
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
  });

  test('groups page renders (admin)', async ({ page }) => {
    await page.goto('/groups');
    expect(page.url()).toContain('/groups');
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
  });

  test('settings page renders (admin)', async ({ page }) => {
    await page.goto('/settings');
    expect(page.url()).toContain('/settings');
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
    await expect(page.locator('form[action="/settings"]')).toBeVisible();
  });

  test('apikeys page renders', async ({ page }) => {
    await page.goto('/apikeys');
    expect(page.url()).toContain('/apikeys');
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
  });

  test('external-domains page renders', async ({ page }) => {
    await page.goto('/external-domains');
    expect(page.url()).toContain('/external-domains');
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
  });

  test('swagger API docs render', async ({ page }) => {
    await page.goto('/api');
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
  });
});

// 4. SITES CRUD
test.describe('Sites CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await browserQuickLogin(page, 'admin');
  });

  test('create site form renders', async ({ page }) => {
    await page.goto('/sites/new');
    await expect(page.locator('form').first()).toBeVisible();
    await expect(page.locator('input[name="name"]')).toBeVisible();
  });

  test('create and list a site', async ({ page }) => {
    await page.goto('/sites/new');
    await page.fill('input[name="name"]', 'Test Site PW');
    await page.locator('form[action="/sites"] button[type="submit"]').click();
    await page.waitForURL('**/sites', { timeout: 10000 });
    await page.goto('/sites');
    await expect(page.locator('body')).toContainText('Test Site PW');
  });

  test('sidebar shows selected site and nav links when visiting site resources', async ({ page }) => {
    // Create a site first
    await page.goto('/sites/new');
    const siteName = 'SidebarTest' + Date.now();
    await page.fill('input[name="name"]', siteName);
    await page.locator('form[action="/sites"] button[type="submit"]').click();
    await page.waitForURL('**/sites', { timeout: 10000 });

    // Get the site ID from the list — find the link for our new site
    const row = page.locator(`td:has-text("${siteName}")`).first().locator('..');
    const containerLink = row.locator('a:has-text("Containers")');
    const href = await containerLink.getAttribute('href');
    const siteId = href.match(/\/sites\/(\d+)\//)[1];

    // Navigate to containers page
    await page.goto(`/sites/${siteId}/containers`);

    // Site selector should have our site selected
    const selector = page.locator('#site-selector');
    await expect(selector).toBeVisible();
    await expect(selector).toHaveValue(siteId);

    // Containers and Nodes links should be visible with correct siteId
    await expect(page.locator(`a[href="/sites/${siteId}/containers"]`).first()).toBeVisible();
    await expect(page.locator(`a[href="/sites/${siteId}/nodes"]`)).toBeVisible();
  });
});

// 5. USERS CRUD
test.describe('Users CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await browserQuickLogin(page, 'admin');
  });

  test('users list shows admin user', async ({ page }) => {
    await page.goto('/users');
    await expect(page.locator('body')).toContainText('admin');
  });

  test('new user form renders', async ({ page }) => {
    await page.goto('/users/new');
    await expect(page.locator('form').first()).toBeVisible();
    await expect(page.locator('input[name="uid"]')).toBeVisible();
  });
});

// 6. GROUPS CRUD
test.describe('Groups CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await browserQuickLogin(page, 'admin');
  });

  test('groups list shows sysadmins', async ({ page }) => {
    await page.goto('/groups');
    await expect(page.locator('body')).toContainText('sysadmins');
  });

  test('new group form renders', async ({ page }) => {
    await page.goto('/groups/new');
    await expect(page.locator('form').first()).toBeVisible();
    await expect(page.locator('input[name="cn"]')).toBeVisible();
  });
});

// 7. API KEYS
test.describe('API Keys', () => {
  test.beforeEach(async ({ page }) => {
    await browserQuickLogin(page, 'admin');
  });

  test('apikeys list renders', async ({ page }) => {
    await page.goto('/apikeys');
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
  });

  test('new apikey form renders', async ({ page }) => {
    await page.goto('/apikeys/new');
    await expect(page.locator('form').first()).toBeVisible();
    await expect(page.locator('input[name="description"]')).toBeVisible();
  });

  test('create an API key', async ({ page }) => {
    await page.goto('/apikeys/new');
    await page.fill('input[name="description"]', 'Test Key PW');
    await page.locator('form[action="/apikeys"] button[type="submit"]').click();
    await expect(page.locator('body')).toContainText('Test Key PW');
  });
});

// 8. EXTERNAL DOMAINS
test.describe('External Domains', () => {
  test.beforeEach(async ({ page }) => {
    await browserQuickLogin(page, 'admin');
  });

  test('external domains list renders', async ({ page }) => {
    await page.goto('/external-domains');
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
  });

  test('new external domain form renders', async ({ page }) => {
    await page.goto('/external-domains/new');
    await expect(page.locator('form').first()).toBeVisible();
    await expect(page.locator('input[name="name"]')).toBeVisible();
  });
});

// 9. SETTINGS
test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await browserQuickLogin(page, 'admin');
  });

  test('settings form renders with fields', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('input[name="smtp_url"]')).toBeVisible();
    await expect(page.locator('input[name="smtp_noreply_address"]')).toBeVisible();
  });

  test('save settings without error', async ({ page }) => {
    await page.goto('/settings');
    await page.fill('input[name="smtp_url"]', 'smtp://localhost:25');
    await page.locator('form[action="/settings"] button[type="submit"], form[action="/settings"] input[type="submit"]').first().click();
    await page.waitForURL(/\/settings/);
    await expect(page.locator('body')).not.toContainText('Internal Server Error');
  });
});

// 10. LOGOUT
test.describe('Logout', () => {
  test('logout clears session and redirects', async ({ page }) => {
    await browserQuickLogin(page, 'admin');
    await page.goto('/sites');

    const logoutForm = page.locator('form[action="/logout"]');
    if (await logoutForm.count() > 0) {
      await logoutForm.locator('button, input[type="submit"]').first().click();
    } else {
      await page.evaluate(async () => {
        await fetch('/logout', { method: 'POST' });
      });
    }

    await page.goto('/sites');
    expect(page.url()).toContain('/login');
  });
});

// 11. NON-ADMIN RESTRICTIONS
test.describe('Non-admin restrictions', () => {
  test.beforeEach(async ({ page }) => {
    await browserQuickLogin(page, 'user');
  });

  test('non-admin cannot access users page', async ({ page }) => {
    const resp = await page.goto('/users');
    expect(resp?.status()).toBe(403);
  });

  test('non-admin cannot access groups page', async ({ page }) => {
    const resp = await page.goto('/groups');
    expect(resp?.status()).toBe(403);
  });

  test('non-admin cannot access settings page', async ({ page }) => {
    const resp = await page.goto('/settings');
    expect(resp?.status()).toBe(403);
  });
});

// 12. FLASH MESSAGES
test.describe('Flash messages', () => {
  test('invalid login shows error flash', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="username"]', 'nonexistent');
    await page.fill('input[name="password"]', 'wrongpassword');
    await page.locator('form#loginForm button[type="submit"], form#loginForm input[type="submit"]').first().click();
    await page.waitForURL(/\/login/);
    const body = await page.textContent('body');
    expect(body).toMatch(/invalid|error|incorrect|not found/i);
  });
});

// 13. JSON API
test.describe('JSON API', () => {
  test('GET /sites returns JSON with Accept header', async ({ request }) => {
    await quickLogin(request, 'admin');
    const resp = await request.get(`${BASE}/sites`, {
      headers: { 'Accept': 'application/json' },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body).toHaveProperty('sites');
    expect(Array.isArray(body.sites)).toBe(true);
  });

  test('GET /users returns JSON with Accept header', async ({ request }) => {
    await quickLogin(request, 'admin');
    const resp = await request.get(`${BASE}/users`, {
      headers: { 'Accept': 'application/json' },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body).toHaveProperty('users');
  });

  test('GET /groups returns JSON with Accept header', async ({ request }) => {
    await quickLogin(request, 'admin');
    const resp = await request.get(`${BASE}/groups`, {
      headers: { 'Accept': 'application/json' },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body).toHaveProperty('groups');
  });

  test('unauthorized API returns 401 JSON', async ({ request }) => {
    const resp = await request.get(`${BASE}/sites`, {
      headers: { 'Accept': 'application/json' },
    });
    expect(resp.status()).toBe(401);
    const body = await resp.json();
    expect(body).toHaveProperty('error');
  });
});
