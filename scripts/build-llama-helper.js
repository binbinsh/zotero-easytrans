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

function findWinMingwImportLib(libDir) {
    const candidates = ["llama.dll.a", "libllama.dll.a"];
    for (const name of candidates) {
        const p = path.join(libDir, name);
        if (fs.existsSync(p)) return name;
    }
    return null;
}

function findWinDll(libDir) {
    const dll = path.join(libDir, "llama.dll");
    return fs.existsSync(dll) ? dll : null;
}

function findWinImportLibByBase(libDir, baseName) {
    const candidates = [`${baseName}.lib`, `lib${baseName}.lib`];
    for (const name of candidates) {
        const p = path.join(libDir, name);
        if (fs.existsSync(p)) return name;
    }
    return null;
}

function findWinMingwImportLibByBase(libDir, baseName) {
    const candidates = [`${baseName}.dll.a`, `lib${baseName}.dll.a`];
    for (const name of candidates) {
        const p = path.join(libDir, name);
        if (fs.existsSync(p)) return name;
    }
    return null;
}

function findWinDllByBase(libDir, baseName) {
    const dll = path.join(libDir, `${baseName}.dll`);
    return fs.existsSync(dll) ? dll : null;
}

function createDefFromDll(dllPath, defPath) {
    const output = execSync(`dumpbin /exports "${dllPath}"`, { stdio: ["ignore", "pipe", "pipe"] })
        .toString();
    const lines = output.split(/\r?\n/);
    const exports = [];
    let inTable = false;
    for (const line of lines) {
        if (!inTable && line.toLowerCase().includes("ordinal") && line.toLowerCase().includes("name")) {
            inTable = true;
            continue;
        }
        if (!inTable) continue;
        const match = line.match(/^\s*\d+\s+\w+\s+[0-9a-fA-F]+\s+(\S+)/);
        if (match) {
            exports.push(match[1]);
        }
    }

    if (exports.length === 0) {
        return false;
    }

    const content = [
        `LIBRARY ${path.basename(dllPath)}`,
        "EXPORTS",
        ...exports.map((name) => `  ${name}`)
    ].join("\n") + "\n";
    fs.writeFileSync(defPath, content);
    return true;
}

function ensureWinImportLib(libDir) {
    const existing = findWinImportLib(libDir);
    if (existing) return existing;

    const dll = findWinDll(libDir);
    if (!dll) return null;

    const defPath = path.join(libDir, "llama.def");
    const libPath = path.join(libDir, "llama.lib");

    if (!fs.existsSync(defPath)) {
        const ok = createDefFromDll(dll, defPath);
        if (!ok) return null;
    }

    execSync(`lib /def:"${defPath}" /out:"${libPath}" /machine:x64`, { stdio: "inherit" });
    return path.basename(libPath);
}

function ensureWinImportLibByBase(libDir, baseName) {
    const existing = findWinImportLibByBase(libDir, baseName);
    if (existing) return existing;

    const dll = findWinDllByBase(libDir, baseName);
    if (!dll) return null;

    const defPath = path.join(libDir, `${baseName}.def`);
    const libPath = path.join(libDir, `${baseName}.lib`);

    if (!fs.existsSync(defPath)) {
        const ok = createDefFromDll(dll, defPath);
        if (!ok) return null;
    }

    execSync(`lib /def:"${defPath}" /out:"${libPath}" /machine:x64`, { stdio: "inherit" });
    return path.basename(libPath);
}

function resolveUnixLinkArg(libDir, baseName) {
    if (process.platform === "darwin" || libDir.endsWith(`${path.sep}darwin`)) {
        return `-l${baseName}`;
    }

    const so = path.join(libDir, `lib${baseName}.so`);
    const soVer = path.join(libDir, `lib${baseName}.so.0`);
    if (!fs.existsSync(so) && fs.existsSync(soVer)) {
        return `-l:lib${baseName}.so.0`;
    }
    return `-l${baseName}`;
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
        const llamaImportLib = ensureWinImportLibByBase(libDir, "llama");
        const ggmlImportLib = ensureWinImportLibByBase(libDir, "ggml");
        if (llamaImportLib && ggmlImportLib) {
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
                llamaImportLib,
                ggmlImportLib
            ].join(" ");
            execSync(cmd, { stdio: "inherit" });
            return;
        }

        const mingwLlamaLib = findWinMingwImportLibByBase(libDir, "llama");
        const mingwGgmlLib = findWinMingwImportLibByBase(libDir, "ggml");
        if (!mingwLlamaLib || !mingwGgmlLib) {
            throw new Error("Windows import libraries not found (expected llama/ggml .lib or *.dll.a files)");
        }
        const cc = process.env.CC || "gcc";
        const llamaLibArg = mingwLlamaLib.startsWith("lib") ? "-llama" : `-l:${mingwLlamaLib}`;
        const ggmlLibArg = mingwGgmlLib.startsWith("lib") ? "-lggml" : `-l:${mingwGgmlLib}`;
        const cmd = [
            cc,
            "-O2",
            "-o",
            q(outPath),
            q(SRC),
            ...includeDirs.flatMap((inc) => ["-I", q(inc)]),
            "-L",
            q(libDir),
            llamaLibArg,
            ggmlLibArg
        ].join(" ");
        execSync(cmd, { stdio: "inherit" });
        return;
    }

    const cc = process.env.CC || "cc";
    const libArgs = [
        resolveUnixLinkArg(libDir, "llama"),
        resolveUnixLinkArg(libDir, "ggml")
    ];
    const cmd = [
        cc,
        "-O2",
        "-o",
        q(outPath),
        q(SRC),
        ...includeDirs.flatMap((inc) => ["-I", q(inc)]),
        "-L",
        q(libDir),
        ...libArgs
    ].join(" ");

    execSync(cmd, { stdio: "inherit" });
}

try {
    build();
} catch (err) {
    console.error(`\nFailed to build llama-helper: ${err.message}`);
    process.exit(1);
}
