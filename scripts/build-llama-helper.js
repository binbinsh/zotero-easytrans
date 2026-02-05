#!/usr/bin/env node
/**
 * Build llama-helper for the current platform.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(__dirname, "llama-helper", "llama_helper.c");

function parseArgs() {
    const args = process.argv.slice(2);
    const out = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--platform" && i + 1 < args.length) out.platform = args[++i];
        else if (arg === "--include" && i + 1 < args.length) out.include = args[++i];
        else if (arg === "--lib" && i + 1 < args.length) out.lib = args[++i];
        else if (arg === "--out" && i + 1 < args.length) out.out = args[++i];
    }
    return out;
}

function platformDir(platform) {
    if (platform === "darwin" || platform === "mac") return "darwin";
    if (platform === "win32" || platform === "windows") return "win32";
    return "linux";
}

function requirePath(label, p) {
    if (!p || !fs.existsSync(p)) {
        throw new Error(`${label} not found: ${p || "(empty)"}`);
    }
    return p;
}

function findWinImportLib(libDir) {
    const candidates = ["llama.lib", "libllama.lib"];
    for (const name of candidates) {
        const p = path.join(libDir, name);
        if (fs.existsSync(p)) return name;
    }
    return null;
}

function build() {
    const args = parseArgs();
    const platform = args.platform || process.platform;
    const dir = platformDir(platform);

    const q = (value) => `"${value}"`;

    const includeDir = args.include || process.env.LLAMA_INCLUDE;
    const libDir = args.lib || path.join(ROOT, "plugin", "chrome", "content", "lib", dir);
    const outDir = args.out || path.join(ROOT, "plugin", "chrome", "content", "bin", dir);

    requirePath("Source file", SRC);
    requirePath("Library directory", libDir);
    fs.mkdirSync(outDir, { recursive: true });

    const outName = dir === "win32" ? "llama-helper.exe" : "llama-helper";
    const outPath = path.join(outDir, outName);

    const includeDirs = (() => {
        const raw = String(includeDir || "").trim();
        if (!raw) return [];
        const sep = dir === "win32" ? /[;,]/ : /[:,]/;
        return raw.split(sep).map((s) => s.trim()).filter(Boolean);
    })();

    if (includeDirs.length === 0) {
        throw new Error("Include directory not found");
    }
    for (const inc of includeDirs) {
        if (!fs.existsSync(inc)) {
            throw new Error(`Include directory not found: ${inc}`);
        }
    }

    if (dir === "win32") {
        const importLib = findWinImportLib(libDir);
        if (!importLib) {
            throw new Error("Windows import library not found (expected llama.lib or libllama.lib)");
        }
        const includeFlags = includeDirs.map((inc) => `/I${q(inc)}`);
        const cmd = [
            "cl",
            "/nologo",
            "/O2",
            `/Fe:${q(outPath)}`,
            ...includeFlags,
            q(SRC),
            "/link",
            `/LIBPATH:${q(libDir)}`,
            importLib
        ].join(" ");
        execSync(cmd, { stdio: "inherit" });
        return;
    }

    const cc = process.env.CC || "cc";
    let libArg = "-lllama";
    if (dir === "linux") {
        const so = path.join(libDir, "libllama.so");
        const soVer = path.join(libDir, "libllama.so.0");
        if (!fs.existsSync(so) && fs.existsSync(soVer)) {
            libArg = "-l:libllama.so.0";
        }
    }
    const cmd = [
        cc,
        "-O2",
        "-o",
        q(outPath),
        q(SRC),
        ...includeDirs.flatMap((inc) => ["-I", q(inc)]),
        "-L",
        q(libDir),
        libArg
    ].join(" ");

    execSync(cmd, { stdio: "inherit" });
}

try {
    build();
} catch (err) {
    console.error(`\nFailed to build llama-helper: ${err.message}`);
    process.exit(1);
}
