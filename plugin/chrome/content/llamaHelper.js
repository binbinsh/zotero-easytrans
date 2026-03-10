/* eslint-disable no-undef */
/**
 * LlamaHelper - External helper runner for llama.cpp (cross-platform)
 */

class LlamaHelper {
    constructor() {
        this._initialized = false;
        this._tmpDir = null;
        this._helperPath = null;
        this._proc = null;
        this._stdoutBuffer = "";
        this._stderrBuffer = "";
        this._queue = Promise.resolve();
        this._reqId = 0;
        this._modelPath = null;
        this._maxTokensDefault = null;
        this._contextSize = null;
        this._textEncoder = new TextEncoder();
        this._stderrTask = null;
        this._nativeReady = false;
    }

    isLoaded() {
        return this._initialized;
    }

    async initialize(modelPath, contextSize, maxTokens) {
        if (this._initialized && this._modelPath === modelPath) return;

        await this._extractAll();
        this._initialized = true;
        this._modelPath = modelPath;
        this._contextSize = contextSize;
        this._maxTokensDefault = maxTokens || 512;
    }

    async dispose() {
        await this._stopProcess();
        this._initialized = false;
        this._modelPath = null;
        this._contextSize = null;
        this._maxTokensDefault = null;
        this._nativeReady = false;
    }

    async translate(text, sourceLang, targetLang) {
        if (!this._initialized || !this._modelPath) {
            throw new Error("Model not loaded");
        }

        const task = async () => {
            await this._extractAll();
            await this._startServer(this._modelPath, this._contextSize, this._maxTokensDefault);
            try {
                const sourceLangName = this.getLanguageName(sourceLang);
                const targetLangName = this.getLanguageName(targetLang);
                const prompt = this.buildTranslationPrompt(text, sourceLangName, targetLangName);
                const maxTokens = this.estimateMaxTokens(text);

                const res = await this._send({ type: "translate", prompt, max_tokens: maxTokens }, true);
                if (!res.ok) {
                    throw new Error(res.error || "Translation failed");
                }
                return this.cleanTranslationResponse(res.text || "");
            } finally {
                await this._stopProcess();
            }
        };

        this._queue = this._queue.then(task, task);
        return this._queue;
    }

    buildTranslationPrompt(text, sourceLang, targetLang) {
        const src = sourceLang === "auto" ? null : sourceLang;
        const srcName = src ? this.getLanguageName(src) : null;
        const tgtName = this.getLanguageName(targetLang);
        const direction = srcName
            ? `Translate the following text from ${srcName} to ${tgtName}.`
            : `Translate the following text to ${tgtName}.`;
        const instruction = `${direction} Return only the translation, with no extra text.`;
        return (
            `<start_of_turn>user\n` +
            `${instruction}\n\n` +
            `${text}\n` +
            `<end_of_turn>\n` +
            `<start_of_turn>model\n`
        );
    }

    cleanTranslationResponse(response) {
        let out = String(response || "");
        out = out.replace(/<start_of_turn>|<end_of_turn>|<eos>/g, "");
        out = out.replace(/<\/?2[^>]+>/g, "");
        out = out.replace(/^\s*model\s*:?\s*/i, "");
        return out.trim();
    }

    getLanguageName(langCode) {
        const langMap = {
            "auto": "auto-detect",
            "en": "English",
            "zh-CN": "Simplified Chinese",
            "zh-TW": "Traditional Chinese",
            "hi": "Hindi",
            "es": "Spanish",
            "ar": "Arabic",
            "fr": "French",
            "pt": "Portuguese",
            "ru": "Russian",
            "de": "German",
            "ja": "Japanese",
            "ko": "Korean",
            "it": "Italian",
            "nl": "Dutch"
        };
        return langMap[langCode] || langCode;
    }

    estimateMaxTokens(text) {
        const max = this._maxTokensDefault || 512;
        const bytes = this._textEncoder.encode(String(text || "")).length;
        const estTokens = Math.ceil(bytes / 3);
        const suggested = Math.max(64, estTokens * 2);
        return Math.min(max, suggested);
    }

    _getNativeDir() {
        const version = EasyTrans?.version || "dev";
        return PathUtils.join(
            Zotero.Profile.dir,
            "easytrans",
            "native",
            version,
            this._getPlatform()
        );
    }

    async _cleanupOldNativeDirs() {
        const baseDir = PathUtils.join(Zotero.Profile.dir, "easytrans", "native");
        const currentVersion = EasyTrans?.version || "dev";
        let entries;
        try {
            entries = await IOUtils.readDir(baseDir);
        } catch {
            return;
        }

        for (const entry of entries) {
            if (!entry?.name) continue;
            if (entry.name === currentVersion) continue;
            const target = PathUtils.join(baseDir, entry.name);
            try {
                await IOUtils.remove(target, { recursive: true });
            } catch (e) {
                Zotero.debug("LlamaHelper: Failed to remove old native dir " + target + " - " + e.message);
            }
        }
    }

    async _extractAll() {
        const nativeDir = this._getNativeDir();
        await this._cleanupOldNativeDirs();
        await IOUtils.makeDirectory(nativeDir, { createAncestors: true, ignoreExisting: true, permissions: 0o755 });
        const helperPath = PathUtils.join(nativeDir, this._getHelperName());

        this._tmpDir = nativeDir;
        this._helperPath = helperPath;
        if (this._nativeReady) return;

        const platform = this._getPlatform();
        const helperExists = await IOUtils.exists(helperPath);
        const libs = await this._getLibList(platform);
        const missingLibs = [];
        for (const name of libs) {
            const libPath = PathUtils.join(nativeDir, name);
            const exists = await IOUtils.exists(libPath);
            if (!exists) missingLibs.push(name);
        }

        if (helperExists && missingLibs.length === 0) {
            await this._ensureLinuxSoAliases(nativeDir, platform);
            this._nativeReady = true;
            return;
        }

        if (!helperExists) {
            await this._extractHelper(nativeDir);
        }
        if (missingLibs.length > 0) {
            await this._extractLibs(nativeDir, missingLibs, platform);
        }
        await this._ensureLinuxSoAliases(nativeDir, platform);
        this._nativeReady = true;
    }

    async _extractHelper(tmpDir) {
        const url = EasyTrans.rootURI +
            "chrome/content/bin/" +
            this._getPlatform() +
            "/" +
            this._getHelperName();
        const req = await Zotero.HTTP.request("GET", url, { responseType: "arraybuffer" });
        const data = new Uint8Array(req.response || []);
        const outPath = PathUtils.join(tmpDir, this._getHelperName());
        await IOUtils.write(outPath, data);
        if (!Zotero.isWin) {
            await IOUtils.setPermissions(outPath, 0o755);
        }
    }

    async _extractLibs(tmpDir, libs, platform) {
        const plt = platform || this._getPlatform();
        const list = Array.isArray(libs) ? libs : await this._getLibList(plt);

        for (const name of list) {
            const url = EasyTrans.rootURI + "chrome/content/lib/" + plt + "/" + name;
            try {
                const req = await Zotero.HTTP.request("GET", url, { responseType: "arraybuffer" });
                const data = new Uint8Array(req.response || []);
                const outPath = PathUtils.join(tmpDir, name);
                await IOUtils.write(outPath, data);
                if (!Zotero.isWin) {
                    await IOUtils.setPermissions(outPath, 0o755);
                }
            } catch (e) {
                Zotero.debug("LlamaHelper: Failed to extract lib " + name + " - " + e.message);
            }
        }
    }

    async _ensureLinuxSoAliases(nativeDir, platform) {
        if ((platform || this._getPlatform()) !== "linux") {
            return;
        }

        let entries = [];
        try {
            entries = await IOUtils.readDir(nativeDir);
        } catch (e) {
            Zotero.debug("LlamaHelper: Failed to read native dir for linux aliases - " + e.message);
            return;
        }

        const aliasable = entries
            .map((entry) => entry?.name || "")
            .filter((name) => /^lib.+\.so\..+$/.test(name))
            .sort((a, b) => a.length - b.length || a.localeCompare(b));

        for (const sourceName of aliasable) {
            const aliasName = sourceName.replace(/\.so\..+$/, ".so");
            const sourcePath = PathUtils.join(nativeDir, sourceName);
            const aliasPath = PathUtils.join(nativeDir, aliasName);
            if (await IOUtils.exists(aliasPath)) {
                continue;
            }

            try {
                const data = await IOUtils.read(sourcePath);
                await IOUtils.write(aliasPath, data);
                await IOUtils.setPermissions(aliasPath, 0o755);
            } catch (e) {
                Zotero.debug("LlamaHelper: Failed to create linux alias " + aliasName + " - " + e.message);
            }
        }
    }

    async _startServer(modelPath, contextSize, maxTokens) {
        if (this._proc) {
            try { this._proc.kill(); } catch {}
            this._proc = null;
        }

        const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");

        const args = [
            "--server",
            "--model",
            modelPath,
            "--context",
            String(contextSize || 4096),
            "--max-tokens",
            String(maxTokens || 2048)
        ];

        this._proc = await Subprocess.call({
            command: this._helperPath,
            arguments: args,
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
            environment: this._getProcessEnvironment(),
            environmentAppend: true
        });

        this._stdoutBuffer = "";
        this._stderrBuffer = "";

        // Drain stderr to avoid blocking if llama logs during model load
        this._stderrTask = this._drainStderr();
    }

    async _send(payload, skipQueue) {
        if (!this._proc) {
            throw new Error("Helper process not started");
        }

        const task = async () => {
            const id = ++this._reqId;
            const msg = Object.assign({ id }, payload);
            const line = JSON.stringify(msg) + "\n";
            await this._proc.stdin.write(line);

            const respLine = await this._readLine();
            if (!respLine) {
                throw new Error(this._buildEmptyResponseError());
            }
            let resp;
            try {
                resp = JSON.parse(respLine);
            } catch {
                throw new Error("Helper returned invalid JSON");
            }
            return resp;
        };

        if (skipQueue) {
            return task();
        }

        this._queue = this._queue.then(task, task);
        return this._queue;
    }

    async _readLine() {
        while (true) {
            const idx = this._stdoutBuffer.indexOf("\n");
            if (idx !== -1) {
                const line = this._stdoutBuffer.slice(0, idx);
                this._stdoutBuffer = this._stdoutBuffer.slice(idx + 1);
                return line;
            }

            const chunk = await this._proc.stdout.readString();
            if (!chunk) {
                if (!this._stdoutBuffer) {
                    return null;
                }
                const line = this._stdoutBuffer;
                this._stdoutBuffer = "";
                return line;
            }
            this._stdoutBuffer += chunk;
        }
    }

    async _drainStderr() {
        if (!this._proc?.stderr) return;
        try {
            while (true) {
                const chunk = await this._proc.stderr.readString();
                if (!chunk) break;
                this._appendStderr(chunk);
            }
        } catch {}
    }

    _appendStderr(chunk) {
        if (!chunk) return;
        this._stderrBuffer += chunk;
        const maxLength = 4000;
        if (this._stderrBuffer.length > maxLength) {
            this._stderrBuffer = this._stderrBuffer.slice(-maxLength);
        }
    }

    _buildEmptyResponseError() {
        const stderr = this._stderrBuffer.trim();
        if (!stderr) {
            return "Helper exited before responding";
        }

        const lines = stderr
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        const detail = lines.slice(-3).join(" | ");
        return detail
            ? `Helper exited before responding: ${detail}`
            : "Helper exited before responding";
    }

    async _stopProcess() {
        if (this._proc) {
            try {
                await this._send({ type: "shutdown" }, true);
            } catch {}
            try {
                this._proc.kill();
            } catch {}
        }
        this._stderrTask = null;
        this._proc = null;
        this._stdoutBuffer = "";
        this._stderrBuffer = "";
    }

    _getPlatform() {
        if (Zotero.isMac) return "darwin";
        if (Zotero.isWin) return "win32";
        return "linux";
    }

    _getHelperName() {
        return this._getPlatform() === "win32" ? "llama-helper.exe" : "llama-helper";
    }

    _getProcessEnvironment() {
        if (Zotero.isMac) return { DYLD_LIBRARY_PATH: this._tmpDir };
        if (Zotero.isWin) return {};
        return { LD_LIBRARY_PATH: this._tmpDir };
    }

    async _getLibList(platform) {
        try {
            const url = EasyTrans.rootURI + "chrome/content/lib/manifest.json";
            const req = await Zotero.HTTP.request("GET", url, { responseType: "text" });
            const manifest = JSON.parse(req.response || req.responseText || "{}");
            const libs = manifest?.[platform];
            if (Array.isArray(libs) && libs.length > 0) {
                return libs;
            }
        } catch {}

        return this._getFallbackLibs(platform);
    }

    _getFallbackLibs(platform) {
        if (platform === "win32") {
            return [
                "llama.dll",
                "ggml.dll",
                "ggml-base.dll",
                "ggml-cpu.dll",
                "ggml-blas.dll",
                "ggml-metal.dll",
                "ggml-rpc.dll",
                "mtmd.dll"
            ];
        }

        if (platform === "linux") {
            return [
                "libllama.so",
                "libllama.so.0",
                "libllama.so.0.0.8252",
                "libggml.so",
                "libggml.so.0",
                "libggml.so.0.9.7",
                "libggml-base.so",
                "libggml-base.so.0",
                "libggml-base.so.0.9.7",
                "libggml-rpc.so",
                "libggml-vulkan.so",
                "libggml-cpu-x64.so",
                "libggml-cpu-sse42.so",
                "libggml-cpu-ivybridge.so",
                "libggml-cpu-haswell.so",
                "libggml-cpu-skylakex.so",
                "libggml-cpu-cannonlake.so",
                "libggml-cpu-icelake.so",
                "libggml-cpu-alderlake.so",
                "libggml-cpu-sandybridge.so",
                "libggml-cpu-cascadelake.so",
                "libggml-cpu-cooperlake.so",
                "libggml-cpu-sapphirerapids.so",
                "libggml-cpu-zen4.so",
                "libggml-cpu-piledriver.so"
            ];
        }

        const base = [
            "libllama",
            "libggml",
            "libggml-base",
            "libggml-cpu",
            "libggml-blas",
            "libggml-metal",
            "libggml-rpc",
            "libmtmd"
        ];

        const exts = platform === "darwin"
            ? [".dylib", ".0.dylib", ".0.0.7933.dylib", ".0.9.5.dylib"]
            : [".so", ".so.0", ".so.0.0.7933", ".so.0.9.5"];

        const libs = [];
        for (const name of base) {
            for (const ext of exts) {
                libs.push(name + ext);
            }
        }
        return libs;
    }
}
