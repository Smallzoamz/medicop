/**
 * Build Number Auto-Increment Script
 * Run: node increment-build.js
 * This script:
 * 1. Reads current build number from build-number.json
 * 2. Increments it by 1
 * 3. Updates package.json version
 * 4. Updates APP_VERSION in public/index.html (Web)
 * 5. Updates APP_VERSION in electron-app/src/index.html (Desktop)
 */

const fs = require('fs');
const path = require('path');

// Paths
const buildNumberPath = path.join(__dirname, 'build-number.json');
const packagePath = path.join(__dirname, 'package.json');
const webIndexPath = path.join(__dirname, '..', 'public', 'index.html');
const desktopIndexPath = path.join(__dirname, 'src', 'index.html');

// Read current build number
let buildData = { build: 0 };
if (fs.existsSync(buildNumberPath)) {
    buildData = JSON.parse(fs.readFileSync(buildNumberPath, 'utf8'));
}

// Increment build number
buildData.build++;

// Save updated build number
fs.writeFileSync(buildNumberPath, JSON.stringify(buildData, null, 4) + '\n');

// Read package.json
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

// Extract base version (remove any existing build suffix)
let baseVersion = packageJson.version.split('-')[0];

// Create new version with build number
const newVersion = `${baseVersion}-build.${buildData.build}`;

// Update package.json
packageJson.version = newVersion;
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 4) + '\n');

console.log(`✅ Build number incremented: ${buildData.build}`);
console.log(`📦 New version: ${newVersion}`);

// Update APP_VERSION in Web index.html
if (fs.existsSync(webIndexPath)) {
    let webContent = fs.readFileSync(webIndexPath, 'utf8');
    webContent = webContent.replace(
        /const APP_VERSION = '[^']+';/g,
        `const APP_VERSION = '${newVersion}';`
    );
    fs.writeFileSync(webIndexPath, webContent);
    console.log(`🌐 Updated Web: public/index.html`);
}

// Update APP_VERSION in Desktop index.html
if (fs.existsSync(desktopIndexPath)) {
    let desktopContent = fs.readFileSync(desktopIndexPath, 'utf8');
    desktopContent = desktopContent.replace(
        /const APP_VERSION = '[^']+';/g,
        `const APP_VERSION = '${newVersion}';`
    );
    fs.writeFileSync(desktopIndexPath, desktopContent);
    console.log(`💻 Updated Desktop: electron-app/src/index.html`);
}

console.log(`\n🎉 All versions synced to: ${newVersion}`);
