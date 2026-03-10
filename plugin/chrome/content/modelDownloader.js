/* eslint-disable no-undef */
/**
 * ModelDownloader - Automatic model download with inline progress state
 * Downloads TranslateGemma 4B GGUF model from HuggingFace with mirror support
 * Uses chunked download to handle files > 2GB
 */

class ModelDownloader {
    constructor() {
        this.downloadInProgress = false;
        this.cancelled = false;
        this.currentXHR = null;

        // Model info
        this.MODEL_FILENAME = "translategemma-4b-it.Q4_K_M.gguf";
        this.MODEL_SIZE = 2684354560; // ~2.5GB approximate size

        // Chunk size: 50MB per chunk to avoid memory issues
        this.CHUNK_SIZE = 50 * 1024 * 1024;

        // Retry settings
        this.MAX_CHUNK_RETRIES = 10;
        this.CHUNK_TIMEOUT = 180000;

        // Download sources (try HuggingFace first, then China mirror as fallback)
        this.DOWNLOAD_SOURCES = [
            {
                name: "HuggingFace",
                url: "https://huggingface.co/mradermacher/translategemma-4b-it-GGUF/resolve/main/translategemma-4b-it.Q4_K_M.gguf"
            },
            {
                name: "HuggingFace Mirror (China)",
                url: "https://hf-mirror.com/mradermacher/translategemma-4b-it-GGUF/resolve/main/translategemma-4b-it.Q4_K_M.gguf"
            }
        ];

        // Speed calculation with rolling average
        this.speedHistory = [];
        this.speedHistoryMaxSize = 10;

        this.listeners = new Set();
        this.state = this.buildIdleState();
    }

    subscribe(listener) {
        if (typeof listener !== "function") {
            return () => {};
        }

        this.listeners.add(listener);

        try {
            listener(this.getState());
        } catch (e) {
            Zotero.debug("ModelDownloader: State listener failed - " + e.message);
        }

        return () => {
            this.listeners.delete(listener);
        };
    }

    emitState() {
        const snapshot = this.getState();
        for (const listener of [...this.listeners]) {
            try {
                listener(snapshot);
            } catch (e) {
                Zotero.debug("ModelDownloader: State listener failed - " + e.message);
            }
        }
    }

    getState() {
        return { ...this.state };
    }

    setState(nextState) {
        this.state = {
            ...this.state,
            ...nextState
        };
        this.emitState();
        return this.getState();
    }

    getExpectedSizeFormatted() {
        return this.formatBytes(this.MODEL_SIZE);
    }

    getProgressLabel(percent) {
        const normalized = Math.max(0, Math.min(100, Math.round(percent || 0)));
        return `Cancel Download (${normalized}%)`;
    }

    buildIdleState(extra = {}) {
        return {
            phase: "idle",
            buttonLabel: "Download Model",
            buttonMode: "download",
            buttonDisabled: false,
            progressPercent: 0,
            statusText: "TranslateGemma 4B model required before translation.",
            detailText: `Expected download size: ${this.getExpectedSizeFormatted()}.`,
            isDownloaded: false,
            hasPartial: false,
            ...extra
        };
    }

    buildPartialState(downloadedBytes, extra = {}) {
        const progressPercent = this.MODEL_SIZE > 0
            ? (downloadedBytes / this.MODEL_SIZE) * 100
            : 0;

        return {
            phase: "partial",
            buttonLabel: `Resume Download (${Math.round(progressPercent)}%)`,
            buttonMode: "download",
            buttonDisabled: false,
            progressPercent,
            statusText: "Partial download found. Click to resume.",
            detailText: `${this.formatBytes(downloadedBytes)} / ${this.getExpectedSizeFormatted()} downloaded.`,
            isDownloaded: false,
            hasPartial: true,
            ...extra
        };
    }

    buildReadyState(sizeFormatted, extra = {}) {
        return {
            phase: "ready",
            buttonLabel: `Model ready (${sizeFormatted})`,
            buttonMode: "ready",
            buttonDisabled: false,
            progressPercent: 100,
            statusText: "",
            detailText: "",
            isDownloaded: true,
            hasPartial: false,
            ...extra
        };
    }

    async armRedownload() {
        const modelInfo = await this.getModelInfo();
        if (!modelInfo.downloaded) {
            return await this.refreshState();
        }

        return this.setState(this.buildReadyState(modelInfo.sizeFormatted, {
            buttonLabel: "Re-download Model",
            buttonMode: "redownload",
            statusText: "Click the button again to re-download the model.",
            detailText: "The existing model file will be replaced."
        }));
    }

    buildCancelledState(downloadedBytes, extra = {}) {
        if (downloadedBytes > 0) {
            return this.buildPartialState(downloadedBytes, {
                phase: "cancelled",
                statusText: "Download cancelled. Click to resume.",
                ...extra
            });
        }

        return this.buildIdleState({
            phase: "cancelled",
            statusText: "Download cancelled.",
            detailText: `Expected download size: ${this.getExpectedSizeFormatted()}.`,
            ...extra
        });
    }

    buildErrorState(message, downloadedBytes, extra = {}) {
        if (downloadedBytes > 0) {
            return this.buildPartialState(downloadedBytes, {
                phase: "error",
                statusText: "Download failed. Click to resume.",
                detailText: `${message} Partial download kept at ${this.formatBytes(downloadedBytes)}.`,
                ...extra
            });
        }

        return this.buildIdleState({
            phase: "error",
            buttonLabel: "Retry Download",
            statusText: "Download failed. Click to retry.",
            detailText: message,
            ...extra
        });
    }

    buildDownloadingState({ source, progress, downloaded, total, speed, statusText, detailText }) {
        return {
            phase: "downloading",
            buttonLabel: this.getProgressLabel(progress),
            buttonMode: "cancel",
            buttonDisabled: false,
            progressPercent: progress,
            statusText: statusText || `Downloading from ${source}...`,
            detailText,
            isDownloaded: false,
            hasPartial: downloaded > 0
        };
    }

    formatBytes(bytes) {
        const value = Number(bytes) || 0;
        if (value >= 1024 * 1024 * 1024) {
            return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
        }
        if (value >= 1024 * 1024) {
            return `${(value / 1024 / 1024).toFixed(1)} MB`;
        }
        if (value >= 1024) {
            return `${(value / 1024).toFixed(1)} KB`;
        }
        return `${value} B`;
    }

    formatEta(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) {
            return "";
        }

        if (seconds < 60) {
            return `${Math.round(seconds)}s left`;
        }
        if (seconds < 3600) {
            return `${Math.round(seconds / 60)}m left`;
        }
        return `${(seconds / 3600).toFixed(1)}h left`;
    }

    /**
     * Get the model directory path
     */
    getModelDir() {
        return PathUtils.join(Zotero.Profile.dir, "easytrans", "models");
    }

    /**
     * Get the full model file path
     */
    async getModelPath() {
        return PathUtils.join(this.getModelDir(), this.MODEL_FILENAME);
    }

    /**
     * Get temp download path
     */
    async getTempPath() {
        const modelPath = await this.getModelPath();
        return modelPath + ".download";
    }

    /**
     * Check if model is already downloaded
     */
    async isModelDownloaded() {
        const modelPath = await this.getModelPath();
        try {
            const exists = await IOUtils.exists(modelPath);
            if (!exists) return false;

            const stat = await IOUtils.stat(modelPath);
            return stat.size > 2000000000;
        } catch (e) {
            return false;
        }
    }

    /**
     * Get existing download size for resume
     */
    async getExistingDownloadSize() {
        const tempPath = await this.getTempPath();
        try {
            const exists = await IOUtils.exists(tempPath);
            if (!exists) return 0;

            const stat = await IOUtils.stat(tempPath);
            return stat.size;
        } catch (e) {
            return 0;
        }
    }

    /**
     * Calculate smooth speed using rolling average
     */
    calculateSmoothSpeed(currentSpeed) {
        this.speedHistory.push(currentSpeed);
        if (this.speedHistory.length > this.speedHistoryMaxSize) {
            this.speedHistory.shift();
        }

        const sum = this.speedHistory.reduce((a, b) => a + b, 0);
        return sum / this.speedHistory.length;
    }

    /**
     * Reset speed history
     */
    resetSpeedHistory() {
        this.speedHistory = [];
    }

    async refreshState() {
        if (this.downloadInProgress) {
            return this.getState();
        }

        const modelInfo = await this.getModelInfo();
        if (modelInfo.downloaded) {
            return this.setState(this.buildReadyState(modelInfo.sizeFormatted));
        }

        const existingSize = await this.getExistingDownloadSize();
        if (existingSize > 0) {
            return this.setState(this.buildPartialState(existingSize));
        }

        return this.setState(this.buildIdleState());
    }

    /**
     * Start download without popup UI
     */
    async showDownloadDialog(options = {}) {
        const forceRedownload = !!options.forceRedownload;

        if (this.downloadInProgress) {
            return false;
        }

        if (!forceRedownload && await this.isModelDownloaded()) {
            await this.refreshState();
            return true;
        }

        const existingSize = await this.getExistingDownloadSize();
        return await this.downloadWithProgressUpdates({
            resume: !forceRedownload && existingSize > 0,
            forceRedownload
        });
    }

    /**
     * Download model with inline progress state
     */
    async downloadWithProgressUpdates({ resume = false, forceRedownload = false } = {}) {
        if (this.downloadInProgress) {
            return false;
        }

        this.downloadInProgress = true;
        this.cancelled = false;
        this.resetSpeedHistory();

        try {
            const modelDir = this.getModelDir();
            await IOUtils.makeDirectory(modelDir, { createAncestors: true });

            const modelPath = await this.getModelPath();
            const tempPath = await this.getTempPath();

            let startByte = 0;
            if (forceRedownload) {
                try {
                    await IOUtils.remove(modelPath);
                } catch (e) {}
            }
            if (resume) {
                startByte = await this.getExistingDownloadSize();
                Zotero.debug(`ModelDownloader: Resuming from byte ${startByte}`);
            } else {
                try {
                    await IOUtils.remove(tempPath);
                } catch (e) {}
            }

            if (startByte > 0) {
                this.setState(this.buildPartialState(startByte, {
                    phase: "downloading",
                    buttonLabel: this.getProgressLabel((startByte / this.MODEL_SIZE) * 100),
                    buttonMode: "cancel",
                    statusText: "Resuming model download...",
                    detailText: `${this.formatBytes(startByte)} / ${this.getExpectedSizeFormatted()} downloaded.`
                }));
            } else {
                this.setState(this.buildDownloadingState({
                    source: "server",
                    progress: 0,
                    downloaded: 0,
                    total: this.MODEL_SIZE,
                    speed: 0,
                    statusText: "Starting model download...",
                    detailText: `0 B / ${this.getExpectedSizeFormatted()} downloaded.`
                }));
            }

            let success = false;
            let lastError = null;

            for (let i = 0; i < this.DOWNLOAD_SOURCES.length; i++) {
                const source = this.DOWNLOAD_SOURCES[i];

                if (this.cancelled) break;

                this.setState({
                    statusText: i === 0
                        ? `Connecting to ${source.name}...`
                        : `Retrying with ${source.name}...`,
                    detailText: resume && startByte > 0
                        ? `${this.formatBytes(startByte)} / ${this.getExpectedSizeFormatted()} downloaded.`
                        : `0 B / ${this.getExpectedSizeFormatted()} downloaded.`
                });
                Zotero.debug(`ModelDownloader: Trying source ${source.name}`);

                try {
                    const totalSize = await this.getFileSize(source.url);
                    Zotero.debug(`ModelDownloader: File size is ${totalSize} bytes`);

                    success = await this.downloadInChunks(
                        source.url,
                        tempPath,
                        startByte,
                        totalSize,
                        (progress, downloaded, total, speed) => {
                            const smoothSpeed = this.calculateSmoothSpeed(speed);
                            const detailParts = [
                                `${this.formatBytes(downloaded)} / ${this.formatBytes(total)}`
                            ];

                            if (smoothSpeed > 0) {
                                detailParts.push(`${(smoothSpeed / 1024 / 1024).toFixed(2)} MB/s`);
                                const eta = this.formatEta((total - downloaded) / smoothSpeed);
                                if (eta) {
                                    detailParts.push(eta);
                                }
                            }

                            this.setState(this.buildDownloadingState({
                                source: source.name,
                                progress,
                                downloaded,
                                total,
                                speed: smoothSpeed,
                                statusText: `Downloading from ${source.name}...`,
                                detailText: detailParts.join(" • ")
                            }));
                        }
                    );

                    if (success) {
                        Zotero.debug(`ModelDownloader: Download succeeded from ${source.name}`);
                        break;
                    }
                } catch (e) {
                    lastError = e;
                    Zotero.debug(`ModelDownloader: Source ${source.name} failed - ${e.message}`);
                    this.resetSpeedHistory();

                    if (!this.cancelled && i < this.DOWNLOAD_SOURCES.length - 1) {
                        startByte = await this.getExistingDownloadSize();
                        const nextSource = this.DOWNLOAD_SOURCES[i + 1];
                        this.setState({
                            statusText: `${source.name} failed. Switching to ${nextSource.name}...`,
                            detailText: `${e.message} Resuming from ${this.formatBytes(startByte)}.`
                        });
                    }
                }
            }

            if (success) {
                await IOUtils.move(tempPath, modelPath);
                const modelInfo = await this.getModelInfo();
                this.setState(this.buildReadyState(modelInfo.sizeFormatted, {
                    statusText: `TranslateGemma 4B download complete (${modelInfo.sizeFormatted}).`,
                    detailText: "Offline translation is available."
                }));
                Zotero.debug("ModelDownloader: Model downloaded successfully");
                return true;
            }

            if (this.cancelled) {
                const existingSize = await this.getExistingDownloadSize();
                this.setState(this.buildCancelledState(existingSize));
                return false;
            }

            throw lastError || new Error("All download sources failed");
        } catch (error) {
            Zotero.debug(`ModelDownloader: Download failed - ${error.message}`);
            const existingSize = await this.getExistingDownloadSize();
            this.setState(this.buildErrorState(error.message, existingSize));
            return false;
        } finally {
            this.downloadInProgress = false;
            this.currentXHR = null;
        }
    }

    /**
     * Get file size using HEAD request
     */
    async getFileSize(url) {
        return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.open("HEAD", url, true);

            xhr.onload = () => {
                if (xhr.status === 200) {
                    const contentLength = xhr.getResponseHeader("Content-Length");
                    if (contentLength) {
                        resolve(parseInt(contentLength, 10));
                    } else {
                        resolve(this.MODEL_SIZE);
                    }
                } else if (xhr.status === 302 || xhr.status === 301) {
                    const redirectUrl = xhr.getResponseHeader("Location");
                    if (redirectUrl) {
                        resolve(this.getFileSize(redirectUrl));
                    } else {
                        resolve(this.MODEL_SIZE);
                    }
                } else {
                    resolve(this.MODEL_SIZE);
                }
            };

            xhr.onerror = () => {
                resolve(this.MODEL_SIZE);
            };

            xhr.timeout = 30000;
            xhr.ontimeout = () => {
                resolve(this.MODEL_SIZE);
            };

            xhr.send();
        });
    }

    /**
     * Download file in chunks to handle files > 2GB
     */
    async downloadInChunks(url, destPath, startByte, totalSize, onProgress) {
        let currentByte = startByte;
        let lastTime = Date.now();
        let lastBytes = startByte;

        const reportProgress = () => {
            const now = Date.now();
            const timeDiff = (now - lastTime) / 1000;
            const bytesDiff = currentByte - lastBytes;
            const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;

            lastTime = now;
            lastBytes = currentByte;

            const progress = (currentByte / totalSize) * 100;
            onProgress?.(progress, currentByte, totalSize, speed);
        };

        while (currentByte < totalSize) {
            if (this.cancelled) return false;

            const endByte = Math.min(currentByte + this.CHUNK_SIZE - 1, totalSize - 1);

            Zotero.debug(`ModelDownloader: Downloading chunk ${currentByte}-${endByte} of ${totalSize}`);

            try {
                const chunkData = await this.downloadChunk(url, currentByte, endByte);

                await this.appendToFile(destPath, chunkData, currentByte === 0 && startByte === 0);

                currentByte += chunkData.length;
                reportProgress();
            } catch (e) {
                Zotero.debug(`ModelDownloader: Chunk download failed - ${e.message}, retrying...`);

                let retries = 0;
                let success = false;

                while (retries < this.MAX_CHUNK_RETRIES && !this.cancelled) {
                    retries++;
                    await new Promise(resolve => setTimeout(resolve, 3000 * retries));

                    try {
                        const chunkData = await this.downloadChunk(url, currentByte, endByte);
                        await this.appendToFile(destPath, chunkData, false);
                        currentByte += chunkData.length;
                        reportProgress();
                        success = true;
                        break;
                    } catch (retryError) {
                        Zotero.debug(`ModelDownloader: Retry ${retries}/${this.MAX_CHUNK_RETRIES} failed - ${retryError.message}`);
                    }
                }

                if (!success) {
                    throw new Error(`Failed to download chunk after ${this.MAX_CHUNK_RETRIES} retries`);
                }
            }
        }

        return true;
    }

    /**
     * Download a single chunk using Range request
     */
    async downloadChunk(url, startByte, endByte) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            this.currentXHR = xhr;

            const clearCurrentXHR = () => {
                if (this.currentXHR === xhr) {
                    this.currentXHR = null;
                }
            };

            xhr.open("GET", url, true);
            xhr.responseType = "arraybuffer";
            xhr.setRequestHeader("Range", `bytes=${startByte}-${endByte}`);

            xhr.onload = () => {
                clearCurrentXHR();

                if (this.cancelled) {
                    reject(new Error("Download cancelled"));
                    return;
                }

                if (xhr.status === 206 || xhr.status === 200) {
                    resolve(new Uint8Array(xhr.response));
                } else if (xhr.status === 302 || xhr.status === 301) {
                    const redirectUrl = xhr.getResponseHeader("Location");
                    if (redirectUrl) {
                        resolve(this.downloadChunk(redirectUrl, startByte, endByte));
                    } else {
                        reject(new Error("Redirect without Location header"));
                    }
                } else {
                    reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
                }
            };

            xhr.onerror = () => {
                clearCurrentXHR();
                reject(new Error("Network error - please check your connection"));
            };

            xhr.onabort = () => {
                clearCurrentXHR();
                reject(new Error("Download cancelled"));
            };

            xhr.ontimeout = () => {
                clearCurrentXHR();
                reject(new Error("Connection timed out"));
            };

            xhr.timeout = this.CHUNK_TIMEOUT || 180000;
            xhr.send();
        });
    }

    /**
     * Append data to file (or create new file)
     */
    async appendToFile(filePath, data, isNewFile) {
        if (isNewFile) {
            await IOUtils.write(filePath, data);
        } else {
            await IOUtils.write(filePath, data, { mode: "append" });
        }
    }

    /**
     * Cancel ongoing download
     */
    cancelDownload() {
        if (!this.downloadInProgress) {
            return;
        }

        this.cancelled = true;
        this.setState({
            buttonLabel: "Cancelling...",
            buttonDisabled: true,
            statusText: "Cancelling download...",
            detailText: "Stopping the current transfer."
        });

        if (this.currentXHR) {
            this.currentXHR.abort();
        }
    }

    /**
     * Delete downloaded model
     */
    async deleteModel() {
        const modelPath = await this.getModelPath();
        const tempPath = await this.getTempPath();

        try {
            if (await IOUtils.exists(modelPath)) {
                await IOUtils.remove(modelPath);
                Zotero.debug("ModelDownloader: Model deleted");
            }
            if (await IOUtils.exists(tempPath)) {
                await IOUtils.remove(tempPath);
                Zotero.debug("ModelDownloader: Temp file deleted");
            }
            await this.refreshState();
            return true;
        } catch (e) {
            Zotero.debug(`ModelDownloader: Failed to delete model - ${e.message}`);
        }
        return false;
    }

    /**
     * Get model info
     */
    async getModelInfo() {
        const modelPath = await this.getModelPath();
        const exists = await IOUtils.exists(modelPath);
        const expectedSizeFormatted = this.getExpectedSizeFormatted();

        if (!exists) {
            const tempSize = await this.getExistingDownloadSize();
            if (tempSize > 0) {
                return {
                    downloaded: false,
                    path: modelPath,
                    size: 0,
                    sizeFormatted: `Incomplete (${this.formatBytes(tempSize)} downloaded)`,
                    expectedSizeFormatted
                };
            }

            return {
                downloaded: false,
                path: modelPath,
                size: 0,
                sizeFormatted: "Not downloaded",
                expectedSizeFormatted
            };
        }

        try {
            const stat = await IOUtils.stat(modelPath);
            return {
                downloaded: true,
                path: modelPath,
                size: stat.size,
                sizeFormatted: this.formatBytes(stat.size),
                expectedSizeFormatted
            };
        } catch (e) {
            return {
                downloaded: false,
                path: modelPath,
                size: 0,
                sizeFormatted: "Error reading file",
                expectedSizeFormatted
            };
        }
    }
}
