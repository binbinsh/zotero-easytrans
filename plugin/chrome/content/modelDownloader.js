/* eslint-disable no-undef */
/**
 * ModelDownloader - Automatic model download with progress tracking
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
        this.MAX_CHUNK_RETRIES = 10;  // More retries per chunk
        this.CHUNK_TIMEOUT = 180000;  // 3 minutes per chunk

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

            // Check file size (should be > 2GB)
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

    /**
     * Show download dialog and start download
     */
    async showDownloadDialog(window) {
        if (await this.isModelDownloaded()) {
            const result = Services.prompt.confirm(
                window,
                "EasyTrans: Model Already Downloaded",
                "The translation model is already downloaded. Do you want to re-download it?"
            );
            if (!result) return true;
        }

        // Check for existing partial download
        const existingSize = await this.getExistingDownloadSize();
        let resumeDownload = false;

        if (existingSize > 0) {
            const existingMB = (existingSize / 1024 / 1024).toFixed(1);
            const result = Services.prompt.confirmEx(
                window,
                "EasyTrans: Resume Download?",
                `Found incomplete download (${existingMB} MB downloaded).\n\n` +
                `Do you want to resume the download?`,
                Services.prompt.BUTTON_POS_0 * Services.prompt.BUTTON_TITLE_IS_STRING +
                Services.prompt.BUTTON_POS_1 * Services.prompt.BUTTON_TITLE_IS_STRING +
                Services.prompt.BUTTON_POS_2 * Services.prompt.BUTTON_TITLE_CANCEL,
                "Resume", "Start Over", null, null, {}
            );

            if (result === 2) return false; // Cancel
            resumeDownload = (result === 0); // Resume
        }

        if (!resumeDownload) {
            // Show confirmation dialog with model info
            const result = Services.prompt.confirmEx(
                window,
                "EasyTrans: Download Translation Model",
                `The TranslateGemma 4B translation model needs to be downloaded.\n\n` +
                `Model: translategemma-4b-it.Q4_K_M.gguf\n` +
                `Size: ~2.5 GB\n` +
                `Sources: HuggingFace Mirror (China) / HuggingFace\n\n` +
                `Features:\n` +
                `• Auto fallback between sources\n` +
                `• Supports resume if interrupted\n` +
                `• Auto-retry on network errors\n\n` +
                `Do you want to download now?`,
                Services.prompt.STD_YES_NO_BUTTONS,
                null, null, null, null, {}
            );

            if (result !== 0) return false;
        }

        return await this.downloadWithProgressWindow(window, resumeDownload);
    }

    /**
     * Download model with a progress window
     */
    async downloadWithProgressWindow(parentWindow, resume = false) {
        if (this.downloadInProgress) {
            Services.prompt.alert(parentWindow, "Download in Progress", "A download is already in progress.");
            return false;
        }

        this.downloadInProgress = true;
        this.cancelled = false;
        this.resetSpeedHistory();

        // Create progress window
        const progressWin = new Zotero.ProgressWindow({ closeOnClick: false });
        progressWin.changeHeadline("EasyTrans: Downloading Model");

        const progressItem = new progressWin.ItemProgress(
            "chrome://easytrans/content/icons/translate.svg",
            "TranslateGemma 4B Model"
        );
        progressItem.setProgress(0);
        progressItem.setText("Preparing download...");
        progressWin.show();

        try {
            // Ensure model directory exists
            const modelDir = this.getModelDir();
            await IOUtils.makeDirectory(modelDir, { createAncestors: true });

            const modelPath = await this.getModelPath();
            const tempPath = await this.getTempPath();

            // Get starting position for resume
            let startByte = 0;
            if (resume) {
                startByte = await this.getExistingDownloadSize();
                Zotero.debug(`ModelDownloader: Resuming from byte ${startByte}`);
            } else {
                // Remove any existing temp file
                try {
                    await IOUtils.remove(tempPath);
                } catch (e) {}
            }

            // Try each source until one succeeds
            let success = false;
            let lastError = null;

            for (let i = 0; i < this.DOWNLOAD_SOURCES.length; i++) {
                const source = this.DOWNLOAD_SOURCES[i];

                if (this.cancelled) break;

                progressItem.setText(`Connecting to ${source.name}...`);
                Zotero.debug(`ModelDownloader: Trying source ${source.name}`);

                try {
                    // First, get the total file size
                    const totalSize = await this.getFileSize(source.url);
                    Zotero.debug(`ModelDownloader: File size is ${totalSize} bytes`);

                    // Download in chunks
                    success = await this.downloadInChunks(
                        source.url,
                        tempPath,
                        startByte,
                        totalSize,
                        (progress, downloaded, total, speed) => {
                            progressItem.setProgress(progress);
                            const downloadedMB = (downloaded / 1024 / 1024).toFixed(1);
                            const totalMB = (total / 1024 / 1024).toFixed(1);
                            const smoothSpeed = this.calculateSmoothSpeed(speed);
                            const speedMBps = (smoothSpeed / 1024 / 1024).toFixed(2);

                            // Calculate ETA
                            const remaining = total - downloaded;
                            let etaText = "";
                            if (smoothSpeed > 0) {
                                const etaSeconds = remaining / smoothSpeed;
                                if (etaSeconds < 60) {
                                    etaText = ` - ${Math.round(etaSeconds)}s left`;
                                } else if (etaSeconds < 3600) {
                                    etaText = ` - ${Math.round(etaSeconds / 60)}m left`;
                                } else {
                                    etaText = ` - ${(etaSeconds / 3600).toFixed(1)}h left`;
                                }
                            }

                            progressItem.setText(
                                `${downloadedMB} / ${totalMB} MB (${speedMBps} MB/s)${etaText}`
                            );
                        }
                    );

                    if (success) {
                        Zotero.debug(`ModelDownloader: Download succeeded from ${source.name}`);
                        break;
                    }
                } catch (e) {
                    lastError = e;
                    Zotero.debug(`ModelDownloader: Source ${source.name} failed - ${e.message}`);

                    // Reset for next source (but keep partial download for resume)
                    this.resetSpeedHistory();
                }
            }

            if (success) {
                // Rename temp file to final name
                await IOUtils.move(tempPath, modelPath);

                progressItem.setProgress(100);
                progressItem.setText("Download complete!");
                progressWin.startCloseTimer(3000);

                Zotero.debug("ModelDownloader: Model downloaded successfully");
                return true;
            } else if (this.cancelled) {
                progressItem.setError();
                progressItem.setText("Download cancelled (can resume later)");
                progressWin.startCloseTimer(3000);
                return false;
            } else {
                throw lastError || new Error("All download sources failed");
            }

        } catch (error) {
            Zotero.debug(`ModelDownloader: Download failed - ${error.message}`);
            progressItem.setError();
            progressItem.setText(`Error: ${error.message}`);
            progressWin.startCloseTimer(5000);

            Services.prompt.alert(
                parentWindow,
                "Download Failed",
                `Failed to download the model:\n\n${error.message}\n\n` +
                `Your partial download has been saved. You can resume later.\n\n` +
                `Or manually download from:\n${this.DOWNLOAD_SOURCES[0].url}`
            );
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
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("HEAD", url, true);

            xhr.onload = () => {
                if (xhr.status === 200) {
                    const contentLength = xhr.getResponseHeader("Content-Length");
                    if (contentLength) {
                        resolve(parseInt(contentLength, 10));
                    } else {
                        // Fallback to known size
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

        while (currentByte < totalSize) {
            if (this.cancelled) return false;

            const endByte = Math.min(currentByte + this.CHUNK_SIZE - 1, totalSize - 1);

            Zotero.debug(`ModelDownloader: Downloading chunk ${currentByte}-${endByte} of ${totalSize}`);

            try {
                const chunkData = await this.downloadChunk(url, currentByte, endByte);

                // Append chunk to file
                await this.appendToFile(destPath, chunkData, currentByte === 0 && startByte === 0);

                currentByte += chunkData.length;

                // Calculate speed
                const now = Date.now();
                const timeDiff = (now - lastTime) / 1000;
                const bytesDiff = currentByte - lastBytes;
                const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;

                lastTime = now;
                lastBytes = currentByte;

                // Report progress
                const progress = (currentByte / totalSize) * 100;
                onProgress?.(progress, currentByte, totalSize, speed);

            } catch (e) {
                // Retry logic for failed chunks
                Zotero.debug(`ModelDownloader: Chunk download failed - ${e.message}, retrying...`);

                let retries = 0;
                const maxRetries = this.MAX_CHUNK_RETRIES;
                let success = false;

                while (retries < maxRetries && !this.cancelled) {
                    retries++;
                    // Exponential backoff: 3s, 6s, 9s, 12s...
                    await new Promise(resolve => setTimeout(resolve, 3000 * retries));

                    try {
                        const chunkData = await this.downloadChunk(url, currentByte, endByte);
                        await this.appendToFile(destPath, chunkData, false);
                        currentByte += chunkData.length;
                        success = true;
                        break;
                    } catch (retryError) {
                        Zotero.debug(`ModelDownloader: Retry ${retries}/${maxRetries} failed - ${retryError.message}`);
                    }
                }

                if (!success) {
                    throw new Error(`Failed to download chunk after ${maxRetries} retries`);
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

            xhr.open("GET", url, true);
            xhr.responseType = "arraybuffer";
            xhr.setRequestHeader("Range", `bytes=${startByte}-${endByte}`);

            xhr.onload = () => {
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
                reject(new Error("Network error - please check your connection"));
            };

            xhr.ontimeout = () => {
                reject(new Error("Connection timed out"));
            };

            // 3 minute timeout per chunk
            xhr.timeout = this.CHUNK_TIMEOUT || 180000;

            xhr.send();
        });
    }

    /**
     * Append data to file (or create new file)
     */
    async appendToFile(filePath, data, isNewFile) {
        if (isNewFile) {
            // Create new file
            await IOUtils.write(filePath, data);
        } else {
            // Append to existing file using mode option
            await IOUtils.write(filePath, data, { mode: "append" });
        }
    }

    /**
     * Cancel ongoing download
     */
    cancelDownload() {
        this.cancelled = true;
        if (this.currentXHR) {
            this.currentXHR.abort();
        }
        this.downloadInProgress = false;
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

        const expectedGB = (this.MODEL_SIZE / 1024 / 1024 / 1024).toFixed(2);
        const expectedMB = (this.MODEL_SIZE / 1024 / 1024).toFixed(2);
        const expectedSizeFormatted = this.MODEL_SIZE >= 1024 * 1024 * 1024
            ? `${expectedGB} GB`
            : `${expectedMB} MB`;

        if (!exists) {
            // Check for partial download
            const tempSize = await this.getExistingDownloadSize();
            if (tempSize > 0) {
                const tempMB = (tempSize / 1024 / 1024).toFixed(2);
                return {
                    downloaded: false,
                    path: modelPath,
                    size: 0,
                    sizeFormatted: `Incomplete (${tempMB} MB downloaded)`,
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
            const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
            const sizeGB = (stat.size / 1024 / 1024 / 1024).toFixed(2);
            const sizeFormatted = stat.size >= 1024 * 1024 * 1024
                ? `${sizeGB} GB`
                : `${sizeMB} MB`;
            const expectedGB = (this.MODEL_SIZE / 1024 / 1024 / 1024).toFixed(2);
            const expectedMB = (this.MODEL_SIZE / 1024 / 1024).toFixed(2);
            const expectedSizeFormatted = this.MODEL_SIZE >= 1024 * 1024 * 1024
                ? `${expectedGB} GB`
                : `${expectedMB} MB`;

            return {
                downloaded: true,
                path: modelPath,
                size: stat.size,
                sizeFormatted,
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
