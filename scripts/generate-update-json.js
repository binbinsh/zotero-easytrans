#!/usr/bin/env node
/**
 * Generate per-platform update.json files for Zotero plugin updates.
 * Reads version and metadata from plugin/manifest.json (single source of truth).
 */

const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(__dirname, '..', 'plugin', 'manifest.json');
const OUTPUT_DIR = path.join(__dirname, '..');

const REPO = 'binbinsh/zotero-easytrans';
const PLATFORMS = ['macos', 'windows', 'linux'];

function main() {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const version = manifest.version;
    const addonId = manifest.applications.zotero.id;
    const minVersion = manifest.applications.zotero.strict_min_version;
    const maxVersion = manifest.applications.zotero.strict_max_version;

    console.log(`Generating update JSON files for v${version}...`);

    for (const platform of PLATFORMS) {
        const updateJson = {
            addons: {
                [addonId]: {
                    updates: [{
                        version,
                        update_link: `https://github.com/${REPO}/releases/download/v${version}/zotero-easytrans-${platform}.xpi`,
                        applications: {
                            zotero: {
                                strict_min_version: minVersion,
                                strict_max_version: maxVersion
                            }
                        }
                    }]
                }
            }
        };

        const filename = `update-${platform}.json`;
        const filepath = path.join(OUTPUT_DIR, filename);
        fs.writeFileSync(filepath, JSON.stringify(updateJson, null, 2) + '\n');
        console.log(`  Created ${filename}`);
    }

    // Transitional update.json for existing users (points to macOS XPI)
    const transitionalJson = {
        addons: {
            [addonId]: {
                updates: [{
                    version,
                    update_link: `https://github.com/${REPO}/releases/download/v${version}/zotero-easytrans-macos.xpi`,
                    applications: {
                        zotero: {
                            strict_min_version: minVersion,
                            strict_max_version: maxVersion
                        }
                    }
                }]
            }
        }
    };

    const transitionalPath = path.join(OUTPUT_DIR, 'update.json');
    fs.writeFileSync(transitionalPath, JSON.stringify(transitionalJson, null, 2) + '\n');
    console.log('  Created update.json (transitional, points to macOS)');

    console.log('\nDone.');
}

main();
