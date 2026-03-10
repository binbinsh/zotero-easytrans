#!/usr/bin/env node
/**
 * Bundle native binaries for Zotero EasyTrans
 * Downloads and packages llama.cpp shared libraries
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { execSync } = require("child_process");

const LIB_DIR = path.join(__dirname, "..", "plugin", "chrome", "content", "lib");
const TEMP_DIR = path.join(__dirname, "..", ".build-temp");

// llama.cpp releases (from ggml-org)
const LLAMA_VERSION = "b8252";
const LLAMA_RELEASES = {
    "darwin-arm64": {
        url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_VERSION}/llama-${LLAMA_VERSION}-bin-macos-arm64.tar.gz`,
        libName: "libllama.dylib",
        archiveType: "tar.gz",
        destDir: "darwin"
    },
    "darwin-x64": {
        url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_VERSION}/llama-${LLAMA_VERSION}-bin-macos-x64.tar.gz`,
        libName: "libllama.dylib",
        archiveType: "tar.gz",
        destDir: "darwin"
    },
    "win32-x64": {
        url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_VERSION}/llama-${LLAMA_VERSION}-bin-win-cpu-x64.zip`,
        libName: "llama.dll",
        archiveType: "zip",
        destDir: "win32"
    },
    "linux-x64": {
        url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_VERSION}/llama-${LLAMA_VERSION}-bin-ubuntu-x64.tar.gz`,
        libName: "libllama.so",
        archiveType: "tar.gz",
        destDir: "linux"
    }
};

/**
 * Download a file with redirect support
 */
async function downloadFile(url, destPath, maxRedirects = 10) {
    return new Promise((resolve, reject) => {
        console.log(`Downloading: ${url}`);

        const doRequest = (currentUrl, redirectCount = 0) => {
            if (redirectCount >= maxRedirects) {
                reject(new Error("Too many redirects"));
                return;
            }

            const protocol = currentUrl.startsWith("https") ? https : http;

            const options = {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
                }
            };

            protocol
                .get(currentUrl, options, (response) => {
                    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                        const redirectUrl = response.headers.location;
                        if (!redirectUrl) {
                            reject(new Error("Redirect without Location header"));
                            return;
                        }
                        const fullRedirectUrl = redirectUrl.startsWith("http")
                            ? redirectUrl
                            : new URL(redirectUrl, currentUrl).href;
                        console.log(`Redirecting to: ${fullRedirectUrl}`);
                        doRequest(fullRedirectUrl, redirectCount + 1);
                        return;
                    }

                    if (response.statusCode !== 200) {
                        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                        return;
                    }

                    const file = fs.createWriteStream(destPath);
                    const totalBytes = parseInt(response.headers["content-length"], 10);
                    let downloadedBytes = 0;
                    let lastPercent = 0;

                    response.on("data", (chunk) => {
                        downloadedBytes += chunk.length;
                        if (totalBytes) {
                            const percent = Math.round((downloadedBytes / totalBytes) * 100);
                            if (percent !== lastPercent) {
                                const downloadedMB = (downloadedBytes / 1024 / 1024).toFixed(1);
                                const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
                                process.stdout.write(`\rProgress: ${percent}% (${downloadedMB}/${totalMB} MB)  `);
                                lastPercent = percent;
                            }
                        }
                    });

                    response.pipe(file);

                    file.on("finish", () => {
                        file.close();
                        console.log("\nDownload complete");
                        resolve();
                    });

                    file.on("error", (err) => {
                        fs.unlink(destPath, () => {});
                        reject(err);
                    });
                })
                .on("error", (err) => {
                    fs.unlink(destPath, () => {});
                    reject(err);
                });
        };

        doRequest(url);
    });
}

/**
 * Extract archive
 */
function extractArchive(archivePath, destDir) {
    console.log(`Extracting to ${destDir}...`);
    fs.mkdirSync(destDir, { recursive: true });

    if (archivePath.endsWith(".zip")) {
        execSync(`unzip -q -o "${archivePath}" -d "${destDir}"`, { stdio: "pipe" });
    } else if (archivePath.endsWith(".tar.gz") || archivePath.endsWith(".tgz")) {
        execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { stdio: "pipe" });
    } else if (archivePath.endsWith(".tar.xz")) {
        execSync(`tar -xJf "${archivePath}" -C "${destDir}"`, { stdio: "pipe" });
    }
}

/**
 * Find file recursively
 */
function findFile(dir, filename) {
    if (!fs.existsSync(dir)) return null;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            const found = findFile(fullPath, filename);
            if (found) return found;
        } else if (entry.name === filename) {
            return fullPath;
        }
    }

    return null;
}

/**
 * Bundle llama.cpp
 */
async function bundleLlama(platform) {
    const config = LLAMA_RELEASES[platform];
    if (!config) {
        console.log(`\nSkipping llama.cpp for ${platform} (no pre-built binary available)`);
        return;
    }

    console.log(`\n=== Bundling llama.cpp ${LLAMA_VERSION} for ${platform} ===`);

    const destDir = path.join(LIB_DIR, config.destDir);
    const archiveExt = config.archiveType === "tar.gz" ? ".tar.gz" : ".zip";
    const archivePath = path.join(TEMP_DIR, `llama-${platform}${archiveExt}`);

    fs.mkdirSync(destDir, { recursive: true });
    fs.mkdirSync(TEMP_DIR, { recursive: true });

    try {
        await downloadFile(config.url, archivePath);
        extractArchive(archivePath, TEMP_DIR);

        // Find the library file
        const libPath = findFile(TEMP_DIR, config.libName);
        if (libPath) {
            const destPath = path.join(destDir, config.libName);
            fs.copyFileSync(libPath, destPath);

            if (process.platform !== "win32") {
                fs.chmodSync(destPath, 0o755);
            }

            console.log(`Installed: ${destPath}`);

            // Also copy ggml library if present (required dependency)
            const ggmlLibName = config.destDir === "win32" ? "ggml.dll" :
                config.destDir === "darwin" ? "libggml.dylib" : "libggml.so";
            const ggmlPath = findFile(TEMP_DIR, ggmlLibName);
            if (ggmlPath) {
                const ggmlDestPath = path.join(destDir, ggmlLibName);
                fs.copyFileSync(ggmlPath, ggmlDestPath);
                if (process.platform !== "win32") {
                    fs.chmodSync(ggmlDestPath, 0o755);
                }
                console.log(`Installed: ${ggmlDestPath}`);
            }

            // Copy any other required .dylib/.so/.dll files
            const libDir = path.dirname(libPath);
            if (fs.existsSync(libDir)) {
                const libFiles = fs.readdirSync(libDir).filter((f) => {
                    if (config.destDir === "darwin") return f.endsWith(".dylib");
                    if (config.destDir === "linux") return f.endsWith(".so") || f.includes(".so.");
                    if (config.destDir === "win32") return f.endsWith(".dll") || f.endsWith(".lib") || f.endsWith(".dll.a");
                    return false;
                });

                for (const libFile of libFiles) {
                    const srcPath = path.join(libDir, libFile);
                    const dstPath = path.join(destDir, libFile);
                    if (!fs.existsSync(dstPath)) {
                        fs.copyFileSync(srcPath, dstPath);
                        if (process.platform !== "win32") {
                            fs.chmodSync(dstPath, 0o755);
                        }
                        console.log(`Installed: ${dstPath}`);
                    }
                }
            }
        } else {
            console.error(`Library not found: ${config.libName}`);
        }
    } finally {
        if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
    }
}

/**
 * Cleanup temp directory
 */
function cleanup() {
    if (fs.existsSync(TEMP_DIR)) {
        console.log("\nCleaning up temporary files...");
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    }
}

/**
 * Write a manifest of bundled runtime libraries
 */
function writeLibManifest() {
    const manifest = {};
    const platforms = ["darwin", "win32", "linux"];
    for (const platform of platforms) {
        const dirPath = path.join(LIB_DIR, platform);
        if (!fs.existsSync(dirPath)) continue;
        const files = fs.readdirSync(dirPath);
        const runtimeLibs = files.filter((f) => {
            if (platform === "darwin") return f.endsWith(".dylib");
            if (platform === "linux") return f.endsWith(".so") || f.includes(".so.");
            if (platform === "win32") return f.endsWith(".dll");
            return false;
        });
        if (runtimeLibs.length > 0) {
            manifest[platform] = runtimeLibs.sort();
        }
    }

    const outPath = path.join(LIB_DIR, "manifest.json");
    fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));
    console.log(`\nWrote library manifest: ${outPath}`);
}

/**
 * Print installed files summary
 */
function printSummary() {
    console.log("\n=================================");
    console.log("Installed libraries:");
    console.log("=================================\n");

    for (const platform of ["darwin", "win32", "linux"]) {
        const dirPath = path.join(LIB_DIR, platform);
        if (fs.existsSync(dirPath)) {
            const files = fs.readdirSync(dirPath);
            if (files.length > 0) {
                console.log(`${platform}/`);
                for (const file of files) {
                    const filePath = path.join(dirPath, file);
                    const stats = fs.statSync(filePath);
                    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
                    console.log(`  └── ${file} (${sizeMB} MB)`);
                }
                console.log();
            }
        }
    }
}

/**
 * Main function
 */
async function main() {
    console.log("╔═══════════════════════════════════════════╗");
    console.log("║   Zotero EasyTrans Native Library Bundler ║");
    console.log("╚═══════════════════════════════════════════╝");
    console.log();
    console.log(`llama.cpp version: ${LLAMA_VERSION}`);
    console.log(`Current platform: ${process.platform}-${process.arch}`);
    console.log();

    fs.mkdirSync(LIB_DIR, { recursive: true });

    const args = process.argv.slice(2);

    // Parse arguments
    let platforms = [];
    let skipLlama = false;
    let keepTemp = false;

    for (const arg of args) {
        if (arg === "--skip-llama") skipLlama = true;
        else if (arg === "--keep-temp") keepTemp = true;
        else if (arg === "--current") {
            const current = process.platform === "darwin" ? "darwin" :
                process.platform === "win32" ? "win32" : "linux";
            const arch = process.arch === "arm64" ? "arm64" : "x64";
            platforms.push(`${current}-${arch}`);
        } else {
            platforms.push(arg);
        }
    }

    if (platforms.length === 0) {
        const current = process.platform === "darwin" ? "darwin" :
            process.platform === "win32" ? "win32" : "linux";
        const arch = process.arch === "arm64" ? "arm64" : "x64";
        platforms = [`${current}-${arch}`];
    }

    try {
        for (const platform of platforms) {
            if (!skipLlama) {
                const llamaPlatform = platform.includes("-")
                    ? platform
                    : `${platform}-${process.arch === "arm64" ? "arm64" : "x64"}`;
                await bundleLlama(llamaPlatform);
            }
        }
    } finally {
        if (!keepTemp) {
            cleanup();
        }
    }

    writeLibManifest();
    printSummary();

    console.log("Done!\n");
    console.log("Next steps:");
    console.log("  1. Run: node scripts/build.js");
    console.log("  2. Install the generated .xpi in Zotero");
}

main().catch((err) => {
    console.error("\nError:", err.message);
    process.exit(1);
});
