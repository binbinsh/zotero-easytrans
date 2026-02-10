#!/usr/bin/env node
/**
 * Build script for Zotero EasyTrans
 * Creates the XPI package for distribution
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PLUGIN_DIR = path.join(__dirname, '..', 'plugin');
const BUILD_DIR = path.join(PLUGIN_DIR, 'build');
const OUTPUT_FILE = path.join(__dirname, '..', 'zotero-easytrans.xpi');

const UPDATE_URL_MAP = {
    macos: 'https://raw.githubusercontent.com/binbinsh/zotero-easytrans/main/update-macos.json',
    windows: 'https://raw.githubusercontent.com/binbinsh/zotero-easytrans/main/update-windows.json',
    linux: 'https://raw.githubusercontent.com/binbinsh/zotero-easytrans/main/update-linux.json'
};

// Files and directories to include in the XPI
const INCLUDE = [
    'manifest.json',
    'bootstrap.js',
    'prefs.js',
    'chrome'
];

// Files to exclude
const EXCLUDE = [
    '.DS_Store',
    'Thumbs.db',
    '*.log',
    'build'
];

function clean() {
    console.log('Cleaning build directory...');
    if (fs.existsSync(BUILD_DIR)) {
        fs.rmSync(BUILD_DIR, { recursive: true });
    }
    if (fs.existsSync(OUTPUT_FILE)) {
        fs.unlinkSync(OUTPUT_FILE);
    }
}

function copyFiles() {
    console.log('Copying files...');
    fs.mkdirSync(BUILD_DIR, { recursive: true });

    for (const item of INCLUDE) {
        const src = path.join(PLUGIN_DIR, item);
        const dest = path.join(BUILD_DIR, item);

        if (fs.existsSync(src)) {
            if (fs.statSync(src).isDirectory()) {
                copyDir(src, dest);
            } else {
                fs.copyFileSync(src, dest);
            }
        }
    }
}

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        // Skip excluded files
        if (shouldExclude(entry.name)) {
            continue;
        }

        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function shouldExclude(filename) {
    for (const pattern of EXCLUDE) {
        if (pattern.startsWith('*')) {
            const ext = pattern.slice(1);
            if (filename.endsWith(ext)) return true;
        } else if (filename === pattern) {
            return true;
        }
    }
    return false;
}

function createXPI() {
    console.log('Creating XPI package...');

    // Change to build directory and create zip
    const cwd = process.cwd();
    process.chdir(BUILD_DIR);

    try {
        execSync(`zip -r "${OUTPUT_FILE}" .`, { stdio: 'inherit' });
        console.log(`\nXPI created: ${OUTPUT_FILE}`);
    } finally {
        process.chdir(cwd);
    }
}

function getVersion() {
    const manifestPath = path.join(PLUGIN_DIR, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return manifest.version;
}

function parsePlatformArg() {
    const idx = process.argv.indexOf('--platform');
    if (idx === -1 || idx + 1 >= process.argv.length) return null;
    const platform = process.argv[idx + 1];
    if (!UPDATE_URL_MAP[platform]) {
        console.error(`Unknown platform: ${platform}. Must be one of: ${Object.keys(UPDATE_URL_MAP).join(', ')}`);
        process.exit(1);
    }
    return platform;
}

function patchManifest(platform) {
    const manifestPath = path.join(BUILD_DIR, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.applications.zotero.update_url = UPDATE_URL_MAP[platform];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Patched manifest update_url for platform: ${platform}`);
}

function main() {
    console.log('=================================');
    console.log('Zotero EasyTrans Build Script');
    console.log('=================================\n');

    const version = getVersion();
    const platform = parsePlatformArg();
    console.log(`Version: ${version}`);
    if (platform) console.log(`Platform: ${platform}`);
    console.log();

    clean();
    copyFiles();

    if (platform) {
        patchManifest(platform);
    }

    createXPI();

    console.log('\nBuild complete!');
    console.log('\nTo install:');
    console.log('1. Open Zotero');
    console.log('2. Go to Tools > Add-ons');
    console.log('3. Click the gear icon > Install Add-on From File');
    console.log(`4. Select: ${OUTPUT_FILE}`);
}

main();
