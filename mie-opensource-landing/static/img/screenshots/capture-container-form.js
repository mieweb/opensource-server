#!/usr/bin/env node
/**
 * Playwright script to capture screenshots of the new container form
 * with the updated standard images dropdown
 * 
 * Usage: node static/img/screenshots/capture-container-form.js
 */

const { chromium } = require('playwright');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const USERNAME = process.env.TEST_USERNAME || 'admin';
const PASSWORD = process.env.TEST_PASSWORD || 'admin';
const SCREENSHOTS_DIR = path.join(__dirname, '..', '..', '..', 'docs', 'users', 'creating-containers', 'img');

async function captureScreenshots() {
  console.log('🚀 Starting screenshot capture...');
  console.log(`📍 Base URL: ${BASE_URL}`);
  console.log(`📁 Screenshots directory: ${SCREENSHOTS_DIR}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1024 },
    deviceScaleFactor: 2 // For retina displays
  });
  const page = await context.newPage();

  try {
    // Step 1: Login
    console.log('🔐 Logging in...');
    await page.goto(`${BASE_URL}/login`);
    await page.fill('input[name="username"]', USERNAME);
    await page.fill('input[name="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForNavigation();
    console.log('✅ Login successful');

    // Step 2: Navigate to containers page
    console.log('📋 Navigating to containers...');
    await page.goto(`${BASE_URL}/sites`);
    
    // Wait for sites list and click first site
    await page.waitForSelector('a:has-text("Containers")', { timeout: 5000 });
    await page.click('a:has-text("Containers")');
    await page.waitForLoadState('networkidle');
    console.log('✅ On containers page');

    // Step 3: Navigate to new container form
    console.log('📝 Opening new container form...');
    await page.click('a:has-text("New Container")');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('#templateSelect', { timeout: 5000 });
    console.log('✅ Form loaded');

    // Step 4: Capture form with dropdown options
    console.log('📸 Capturing template dropdown...');
    
    // Open the dropdown to show options
    await page.click('#templateSelect');
    await page.waitForTimeout(500); // Wait for dropdown animation
    
    // Capture dropdown with options visible
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'template-dropdown-new.png'),
      fullPage: false
    });
    console.log('✅ Saved: template-dropdown-new.png');

    // Step 5: Select Debian 13 and capture metadata loading
    console.log('📸 Capturing Debian 13 selection...');
    await page.selectOption('#templateSelect', 'ghcr.io/mieweb/opensource-server/base:latest');
    await page.waitForTimeout(2000); // Wait for metadata fetch
    
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'debian-13-selected.png'),
      fullPage: true
    });
    console.log('✅ Saved: debian-13-selected.png');

    // Step 6: Reset and select NodeJS 24
    console.log('📸 Capturing NodeJS 24 selection...');
    await page.reload();
    await page.waitForSelector('#templateSelect');
    await page.selectOption('#templateSelect', 'ghcr.io/mieweb/opensource-server/nodejs:latest');
    await page.waitForTimeout(2000); // Wait for metadata fetch
    
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'nodejs-24-selected.png'),
      fullPage: true
    });
    console.log('✅ Saved: nodejs-24-selected.png');

    // Step 7: Capture custom Docker image option
    console.log('📸 Capturing custom Docker image...');
    await page.reload();
    await page.waitForSelector('#templateSelect');
    await page.selectOption('#templateSelect', 'custom');
    await page.waitForTimeout(500);
    
    // Fill in a custom image
    await page.fill('#customTemplate', 'nginx:alpine');
    await page.evaluate(() => {
      document.getElementById('customTemplate').blur();
    });
    await page.waitForTimeout(2000); // Wait for metadata fetch
    
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'custom-docker-image.png'),
      fullPage: true
    });
    console.log('✅ Saved: custom-docker-image.png');

    // Step 8: Capture full form with all sections expanded
    console.log('📸 Capturing full new container form...');
    await page.reload();
    await page.waitForSelector('#templateSelect');
    
    // Fill in hostname
    await page.fill('#hostname', 'my-container');
    await page.selectOption('#templateSelect', 'ghcr.io/mieweb/opensource-server/base:latest');
    await page.waitForTimeout(2000); // Wait for metadata
    
    // Expand all sections if they exist
    const expandButtons = await page.$$('summary');
    for (const button of expandButtons) {
      await button.click();
      await page.waitForTimeout(200);
    }
    
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'new-container-form.png'),
      fullPage: true
    });
    console.log('✅ Saved: new-container-form.png');

    console.log('✅ All screenshots captured successfully!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

// Run the script
captureScreenshots().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
