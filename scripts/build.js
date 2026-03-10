#!/usr/bin/env node
/**
 * Build script for Zotero EasyTrans
 * Creates the XPI package for distribution
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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
    const files = collectFiles(BUILD_DIR).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const chunks = [];
    const centralDirectoryEntries = [];
    let offset = 0;

    for (const file of files) {
        const localFileRecord = createLocalFileRecord(file, offset);
        chunks.push(localFileRecord.header, localFileRecord.name, localFileRecord.data);
        offset += localFileRecord.header.length + localFileRecord.name.length + localFileRecord.data.length;
        centralDirectoryEntries.push(createCentralDirectoryRecord(file, localFileRecord));
    }

    const centralDirectoryOffset = offset;
    for (const entry of centralDirectoryEntries) {
        chunks.push(entry);
        offset += entry.length;
    }

    chunks.push(createEndOfCentralDirectoryRecord(
        centralDirectoryEntries.length,
        offset - centralDirectoryOffset,
        centralDirectoryOffset
    ));

    fs.writeFileSync(OUTPUT_FILE, Buffer.concat(chunks));
    console.log(`\nXPI created: ${OUTPUT_FILE}`);
}

function collectFiles(rootDir, currentDir = rootDir) {
    const files = [];
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectFiles(rootDir, fullPath));
            continue;
        }
        if (!entry.isFile()) continue;

        const rawData = fs.readFileSync(fullPath);
        const compressedData = zlib.deflateRawSync(rawData);
        const useCompression = compressedData.length < rawData.length;
        const stats = fs.statSync(fullPath);

        files.push({
            relativePath: path.relative(rootDir, fullPath).split(path.sep).join('/'),
            data: useCompression ? compressedData : rawData,
            compressedSize: useCompression ? compressedData.length : rawData.length,
            compressionMethod: useCompression ? 8 : 0,
            crc32: crc32(rawData),
            mtime: stats.mtime,
            uncompressedSize: rawData.length
        });
    }

    return files;
}

function createLocalFileRecord(file, offset) {
    const name = Buffer.from(file.relativePath, 'utf8');
    const { dosDate, dosTime } = toDosDateTime(file.mtime);
    const header = Buffer.alloc(30);

    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(file.compressionMethod, 8);
    header.writeUInt16LE(dosTime, 10);
    header.writeUInt16LE(dosDate, 12);
    header.writeUInt32LE(file.crc32 >>> 0, 14);
    header.writeUInt32LE(file.compressedSize, 18);
    header.writeUInt32LE(file.uncompressedSize, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);

    return {
        data: file.data,
        dosDate,
        dosTime,
        header,
        name,
        offset
    };
}

function createCentralDirectoryRecord(file, localFileRecord) {
    const name = Buffer.from(file.relativePath, 'utf8');
    const header = Buffer.alloc(46);

    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(file.compressionMethod, 10);
    header.writeUInt16LE(localFileRecord.dosTime, 12);
    header.writeUInt16LE(localFileRecord.dosDate, 14);
    header.writeUInt32LE(file.crc32 >>> 0, 16);
    header.writeUInt32LE(file.compressedSize, 20);
    header.writeUInt32LE(file.uncompressedSize, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(localFileRecord.offset, 42);

    return Buffer.concat([header, name]);
}

function createEndOfCentralDirectoryRecord(entryCount, centralDirectorySize, centralDirectoryOffset) {
    const record = Buffer.alloc(22);

    record.writeUInt32LE(0x06054b50, 0);
    record.writeUInt16LE(0, 4);
    record.writeUInt16LE(0, 6);
    record.writeUInt16LE(entryCount, 8);
    record.writeUInt16LE(entryCount, 10);
    record.writeUInt32LE(centralDirectorySize, 12);
    record.writeUInt32LE(centralDirectoryOffset, 16);
    record.writeUInt16LE(0, 20);

    return record;
}

function toDosDateTime(date) {
    const safeDate = date instanceof Date ? date : new Date();
    const year = Math.max(1980, safeDate.getFullYear());
    const dosDate = ((year - 1980) << 9) | ((safeDate.getMonth() + 1) << 5) | safeDate.getDate();
    const dosTime = (safeDate.getHours() << 11) | (safeDate.getMinutes() << 5) | Math.floor(safeDate.getSeconds() / 2);

    return { dosDate, dosTime };
}

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let value = i;
        for (let j = 0; j < 8; j++) {
            value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
        }
        table[i] = value >>> 0;
    }
    return table;
})();

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
