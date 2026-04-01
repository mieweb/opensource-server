// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Quick Login and API Key', () => {
  test.beforeEach(async ({ page }) => {
    // Start from the login page
    await page.goto('/login');
  });

  test('should login as admin using quick login', async ({ page }) => {
    // Click the quick login button (Login as Admin)
    await page.getByRole('button', { name: 'Login as Admin' }).click();
    
    // Should redirect to sites page
    await expect(page).toHaveURL(/\/sites/);
    
    // Should show admin menu items
    await expect(page.getByRole('link', { name: 'Users' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
    
    // Should show New Site button (admin only)
    await expect(page.getByRole('button', { name: 'New Site' })).toBeVisible();
  });

  test('should login as standard user using quick login dropdown', async ({ page }) => {
    // Click dropdown toggle
    await page.getByRole('button', { name: '▼' }).click();
    
    // Select "Login as Standard User"
    await page.getByRole('link', { name: 'Login as Standard User' }).click();
    
    // Click the button (now labeled "Login as Standard User")
    await page.getByRole('button', { name: 'Login as Standard User' }).click();
    
    // Should redirect to sites page
    await expect(page).toHaveURL(/\/sites/);
    
    // Should NOT show admin menu items
    await expect(page.getByRole('link', { name: 'Users' })).not.toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings' })).not.toBeVisible();
  });

  test('should create an API key after quick login', async ({ page }) => {
    // Quick login as admin
    await page.getByRole('button', { name: 'Login as Admin' }).click();
    await expect(page).toHaveURL(/\/sites/);
    
    // Navigate to API Keys
    await page.getByRole('link', { name: 'API Keys' }).click();
    await expect(page).toHaveURL(/\/apikeys/);
    
    // Click "New API Key" button
    await page.getByRole('button', { name: 'Create new API key' }).click();
    await expect(page).toHaveURL(/\/apikeys\/new/);
    
    // Fill in description
    await page.getByRole('textbox', { name: 'Description' }).fill('Test API Key from Playwright');
    
    // Generate the key
    await page.getByRole('button', { name: 'Generate API Key' }).click();
    
    // Should show success message with the API key
    // The key is displayed only once, so we check for the success indication
    await expect(page.getByText(/API key created/i).or(page.getByText(/Your new API key/i))).toBeVisible();
    
    // Navigate back to API keys list
    await page.getByRole('link', { name: 'API Keys' }).first().click();
    
    // Should see the new key in the list (use first() since name may appear in multiple columns)
    await expect(page.getByRole('cell', { name: 'Test API Key from Playwright' }).first()).toBeVisible();
  });
});
