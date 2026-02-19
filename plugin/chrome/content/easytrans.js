/* eslint-disable no-undef */
/**
 * Zotero EasyTrans - Main Logic
 * Uses Zotero 8 Plugin APIs
 */

var EasyTrans = {
    id: null,
    version: null,
    rootURI: null,
    initialized: false,
    componentsInitialized: false,
    modelDownloader: null,
    llamaHelper: null,
    translationCache: null,
    _readerIntegrationRegistered: false,
    translationRecords: new Map(),
    _summaryRefreshPending: false,

    // Supported languages
    LANGUAGES: {
        "en": "English",
        "zh-CN": "简体中文",
        "zh-TW": "繁體中文",
        "hi": "हिन्दी",
        "es": "Español",
        "ar": "العربية",
        "fr": "Français",
        "pt": "Português",
        "ru": "Русский",
        "de": "Deutsch",
        "ja": "日本語",
        "ko": "한국어",
        "it": "Italiano",
        "nl": "Nederlands"
    },

    /**
     * Initialize the plugin
     */
    async init() {
        if (this.initialized) return;

        Zotero.debug("EasyTrans: Initializing...");

        try {
            // Load model downloader module
            Services.scriptloader.loadSubScript(
                this.rootURI + "chrome/content/modelDownloader.js"
            );
            this.modelDownloader = new ModelDownloader();
            Zotero.debug("EasyTrans: ModelDownloader loaded");

            // Load translation pane UI
            Services.scriptloader.loadSubScript(
                this.rootURI + "chrome/content/translationPane.js"
            );

            // Register UI components
            this.registerUI();

            // Register reader integration for selection translation
            this.registerReaderIntegration();

            this.initialized = true;
            Zotero.debug("EasyTrans: Initialization complete");

        } catch (error) {
            Zotero.debug("EasyTrans: Initialization failed - " + error.message);
            Zotero.logError(error);
        }
    },

    /**
     * Request a safe pane refresh (avoid refresh loops)
     */
    requestSummaryRefresh() {
        if (this._summaryRefreshPending || !this._refreshPane) return;
        this._summaryRefreshPending = true;
        setTimeout(() => {
            try {
                this._refreshPane?.();
            } finally {
                this._summaryRefreshPending = false;
            }
        }, 0);
    },

    /**
     * Shutdown the plugin
     */
    async shutdown() {
        Zotero.debug("EasyTrans: Shutting down...");

        // Cleanup inference engine
        if (this.llamaHelper) {
            await this.llamaHelper.dispose();
            this.llamaHelper = null;
        }

        // Cleanup cache
        if (this.translationCache) {
            await this.translationCache.close();
            this.translationCache = null;
        }

        this.initialized = false;
        Zotero.debug("EasyTrans: Shutdown complete");
    },

    /**
     * Initialize translation components (lazy loading)
     */
    async initializeComponents() {
        if (this.componentsInitialized) {
            Zotero.debug("EasyTrans: Components already initialized");
            return;
        }

        Zotero.debug("EasyTrans: Initializing translation components...");

        // Load additional scripts only once
        Services.scriptloader.loadSubScript(
            this.rootURI + "chrome/content/llamaHelper.js"
        );
        Services.scriptloader.loadSubScript(
            this.rootURI + "chrome/content/translationCache.js"
        );

        // Initialize cache
        this.translationCache = new TranslationCache();
        await this.translationCache.init();

        this.componentsInitialized = true;
        Zotero.debug("EasyTrans: Translation components initialized");
    },

    /**
     * Initialize the LLM inference engine
     */
    async initializeInference() {
        if (this.llamaHelper?.isLoaded()) {
            return;
        }

        Zotero.debug("EasyTrans: Initializing inference engine...");

        const modelPath = await this.modelDownloader.getModelPath();

        if (!modelPath) {
            throw new Error("Model not downloaded");
        }

        this.llamaHelper = new LlamaHelper();
        // Use maximum context size in helper (0 = auto/max by model)
        const contextSize = 0;
        const maxTokens = Zotero.Prefs.get("extensions.easytrans.maxTokens") || 2048;
        await this.llamaHelper.initialize(modelPath, contextSize, maxTokens);

        Zotero.debug("EasyTrans: Inference engine ready");
    },

    /**
     * Translate text using the LLM
     */
    async translateText(text, sourceLang, targetLang) {
        // Check cache first
        const cached = await this.translationCache?.get(text, sourceLang, targetLang);
        if (cached) {
            Zotero.debug("EasyTrans: Cache hit for translation");
            return cached;
        }

        // Ensure model is loaded
        if (!this.llamaHelper?.isLoaded()) {
            await this.initializeInference();
        }

        // Translate
        const result = await this.llamaHelper.translate(text, sourceLang, targetLang);

        // Cache result
        await this.translationCache?.set(text, sourceLang, targetLang, result);

        return result;
    },

    /**
     * Download the translation model
     */
    async downloadModel(window) {
        if (!this.modelDownloader) {
            Zotero.debug("EasyTrans: ModelDownloader not initialized");
            Services.prompt.alert(window, "EasyTrans Error", "Model downloader not initialized. Please restart Zotero.");
            return false;
        }

        try {
            const success = await this.modelDownloader.showDownloadDialog(window);
            return success;
        } catch (e) {
            Zotero.debug("EasyTrans: Download failed - " + e.message);
            Services.prompt.alert(window, "EasyTrans Error", "Download failed: " + e.message);
            return false;
        }
    },

    /**
     * Check if model is downloaded
     */
    async isModelReady() {
        if (!this.modelDownloader) return false;
        try {
            return await this.modelDownloader.isModelDownloaded();
        } catch (e) {
            return false;
        }
    },

    /**
     * Get model info
     */
    async getModelInfo() {
        if (!this.modelDownloader) {
            return { downloaded: false, sizeFormatted: "Not available" };
        }
        try {
            return await this.modelDownloader.getModelInfo();
        } catch (e) {
            return { downloaded: false, sizeFormatted: "Error" };
        }
    },

    /**
     * Store a translated selection record for the current reader item
     */
    addTranslationRecord(itemID, record) {
        if (!itemID || !record) return;
        const list = this.translationRecords.get(itemID) || [];
        list.unshift(record);
        if (list.length > 200) {
            list.length = 200;
        }
        this.translationRecords.set(itemID, list);
    },

    /**
     * Get translated selection records for a reader item
     */
    getTranslationRecords(itemID) {
        if (!itemID) return [];
        return this.translationRecords.get(itemID) || [];
    },

    /**
     * Navigate to an annotation by key in the active reader
     */
    async navigateToAnnotation(annotationID) {
        const reader = this.getActiveReader();
        if (!reader || !annotationID) return;
        try {
            await reader.navigate({ annotationID });
            reader.selectAnnotations([annotationID]);
        } catch (e) {
            Zotero.debug("EasyTrans: Failed to navigate to annotation - " + e.message);
        }
    },

    /**
     * Get the active reader instance from the current Zotero window
     */
    getActiveReader() {
        const win = Zotero.getMainWindow();
        const tabs = win?.Zotero_Tabs;
        if (!tabs || tabs.selectedType !== "reader") return null;
        const tabID = tabs.selectedID;
        if (!tabID) return null;
        return Zotero.Reader.getByTabID(tabID) || null;
    },

    /**
     * Normalize translation output for display and annotations
     */
    normalizeTranslation(text) {
        if (!text) return "";
        let normalized = text;
        normalized = normalized.replace(/^\s*(auto[- ]detected:.*|auto[- ]detected language:.*|detected language:.*)\s*$/gim, "");
        normalized = normalized.replace(/(^|\n)\s*(auto[- ]detected:.*|auto[- ]detected language:.*|detected language:.*)\s*(\n|$)/gim, "\n");
        normalized = normalized.replace(/\r\n/g, "\n");
        normalized = normalized.replace(/\\n/g, "\n");
        normalized = normalized.replace(/[ \t]+\n/g, "\n");
        normalized = normalized.replace(/\n{3,}/g, "\n\n");
        return normalized.trim();
    },

    /**
     * Ensure EasyTrans styles are loaded in a document
     */
    ensureStyles(doc) {
        if (!doc) return;
        const linkExisting = doc.querySelector('link[data-easytrans-style="true"]');
        if (!linkExisting) {
            const link = doc.createElement("link");
            link.rel = "stylesheet";
            link.href = this.rootURI + "chrome/skin/easytrans.css";
            link.setAttribute("data-easytrans-style", "true");

            if (doc.head) {
                doc.head.appendChild(link);
            } else if (doc.documentElement) {
                doc.documentElement.appendChild(link);
            }
        }

        const inlineExisting = doc.querySelector('style[data-easytrans-inline="true"]');
        if (inlineExisting) return;

        const style = doc.createElement("style");
        style.setAttribute("data-easytrans-inline", "true");
        style.textContent = `
            .easytrans-translation-popup {
                position: fixed;
                width: min(520px, calc(100vw - 40px));
                min-width: min(320px, calc(100vw - 40px));
                max-height: 65vh;
                background: var(--material-background);
                border: 1px solid var(--fill-quinary);
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                z-index: 9999;
                overflow: hidden;
                cursor: pointer;
            }
            .easytrans-popup-content {
                padding: 14px;
                max-height: 65vh;
                overflow-y: auto;
                font-size: 16px;
                line-height: 1.7;
                white-space: pre-wrap;
            }
            .annotation-popup,
            .preview {
                --note-font-size: 1rem;
            }
            .annotation-popup .editor,
            .preview .editor,
            .annotation-popup .content {
                font-size: 16px;
                line-height: 1.7;
            }
            .annotation-popup {
                width: min(900px, 80vw);
                min-width: min(540px, calc(100vw - 40px));
                max-width: min(900px, 80vw);
            }
            .annotation-popup .content {
                max-height: 40vh;
            }
            .easytrans-toast {
                position: fixed;
                right: 16px;
                bottom: 16px;
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 10px;
                background: var(--material-background);
                border: 1px solid var(--fill-quinary);
                border-radius: 6px;
                box-shadow: 0 6px 18px rgba(0, 0, 0, 0.15);
                z-index: 10000;
                font-size: 12px;
                color: var(--fill-primary);
            }
            .easytrans-toast button {
                border: none;
                background: var(--accent-blue, #2d74ff);
                color: #fff;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 12px;
                cursor: pointer;
            }
            .easytrans-toast button:hover {
                background: var(--accent-blue-darker, #2258c7);
            }
            .easytrans-toast-close {
                border: none;
                background: transparent;
                color: var(--fill-secondary);
                cursor: pointer;
                font-size: 14px;
                line-height: 1;
            }
        `;
        if (doc.head) {
            doc.head.appendChild(style);
        } else if (doc.documentElement) {
            doc.documentElement.appendChild(style);
        }
    },

    /**
     * Show translation popup in reader UI
     */
    showTranslationPopup(doc, translatedText, targetLang, isError = false) {
        if (!doc?.body) return;

        this.ensureStyles(doc);

        const existing = doc.querySelector(".easytrans-translation-popup");
        if (existing) {
            existing.remove();
        }

        const normalizedText = this.normalizeTranslation(translatedText);

        const popup = doc.createElement("div");
        popup.className = "easytrans-translation-popup";

        const content = doc.createElement("div");
        content.className = "easytrans-popup-content";
        content.textContent = normalizedText || translatedText;

        popup.appendChild(content);
        doc.body.appendChild(popup);
        popup.addEventListener("click", () => popup.remove());

        const win = doc.defaultView;
        if (win) {
            popup.style.left = "auto";
            popup.style.top = "auto";
            popup.style.right = "20px";
            popup.style.bottom = "20px";
        }
    },

    /**
     * Cache selection rect for popup positioning
     */
    captureSelectionRect(doc, rectLike, reader, position) {
        try {
            if (rectLike) {
                // rectLike can be [left, top, right, bottom] or DOMRect-like
                if (Array.isArray(rectLike) && rectLike.length >= 4) {
                    this._lastSelectionRect = {
                        left: rectLike[0],
                        top: rectLike[1],
                        right: rectLike[2],
                        bottom: rectLike[3]
                    };
                    return;
                }
                if (typeof rectLike.left === "number") {
                    this._lastSelectionRect = rectLike;
                    return;
                }
            }
            if (reader && position) {
                const view = reader._view || reader._primaryView || reader._lastView || reader._internalReader?._primaryView;
                if (view && typeof view.getClientRectForPopup === "function") {
                    let rectArr = null;
                    try {
                        rectArr = view.getClientRectForPopup(position);
                        if ((!rectArr || rectArr.length < 4) && view._iframeWindow) {
                            const node = view._iframeWindow.document.getElementById("viewerContainer");
                            rectArr = view.getClientRectForPopup(position, node?.scrollLeft || 0, node?.scrollTop || 0);
                        }
                    } catch (e) {}
                    if (Array.isArray(rectArr) && rectArr.length >= 4) {
                        this._lastSelectionRect = {
                            left: rectArr[0],
                            top: rectArr[1],
                            right: rectArr[2],
                            bottom: rectArr[3],
                            width: rectArr[2] - rectArr[0],
                            height: rectArr[3] - rectArr[1]
                        };
                        return;
                    }
                }
            }
            const sel = doc.getSelection?.();
            if (!sel || sel.rangeCount === 0) {
                this._lastSelectionRect = null;
                return;
            }
            const range = sel.getRangeAt(0);
            let rect = range.getBoundingClientRect();
            if ((!rect || (!rect.width && !rect.height)) && range.getClientRects) {
                const rects = range.getClientRects();
                rect = rects?.length ? rects[0] : rect;
            }
            this._lastSelectionRect = rect || null;
        } catch (e) {
            this._lastSelectionRect = null;
        }
    },

    /**
     * Show a non-blocking toast after translation
     */
    showTranslationToast(doc, reader, annotationItem) {
        if (!doc?.body) return;
        this.ensureStyles(doc);

        const existing = doc.querySelector(".easytrans-toast");
        if (existing) {
            existing.remove();
        }

        const locale = (Zotero?.locale || "").toLowerCase();
        const message = locale.startsWith("zh")
            ? "翻译完成"
            : "Translation saved";
        const actionLabel = locale.startsWith("zh")
            ? "定位注释"
            : "Locate highlight";

        const toast = doc.createElement("div");
        toast.className = "easytrans-toast";

        const text = doc.createElement("span");
        text.textContent = message;

        const action = doc.createElement("button");
        action.type = "button";
        action.textContent = actionLabel;
        action.addEventListener("click", () => {
            this.focusAnnotation(reader, annotationItem);
            toast.remove();
        });

        const close = doc.createElement("button");
        close.type = "button";
        close.className = "easytrans-toast-close";
        close.textContent = "×";
        close.addEventListener("click", () => toast.remove());

        toast.appendChild(text);
        toast.appendChild(action);
        toast.appendChild(close);
        doc.body.appendChild(toast);

        const win = doc.defaultView;
        if (win) {
            win.setTimeout(() => {
                if (toast.isConnected) toast.remove();
            }, 10000);
        }
    },

    /**
     * Focus annotation in the reader safely (no popup)
     */
    focusAnnotation(reader, annotationItem) {
        if (!reader || !annotationItem) return;
        const annotationID = annotationItem.key || annotationItem.id;
        if (!annotationID) return;

        try {
            if (typeof reader.toggleSidebar === "function") {
                reader.toggleSidebar(true);
            }
            if (typeof reader.setSidebarView === "function") {
                reader.setSidebarView("annotations");
            }
            if (typeof reader.navigate === "function") {
                reader.navigate({ annotationID });
            }
        } catch (e) {
            Zotero.debug("EasyTrans: Failed to focus annotation - " + e.message);
        }
    },

    /**
     * Create a translated annotation from a selection
     */
    async createTranslationAnnotation(reader, baseAnnotation, translatedText, targetLang) {
        if (!reader?.itemID) return null;
        const attachment = await Zotero.Items.getAsync(reader.itemID);
        if (!attachment) return null;

        const position = baseAnnotation?.position;
        if (!position) {
            throw new Error("Selection position not available");
        }

        const normalizedText = this.normalizeTranslation(translatedText);
        const comment = `EasyTrans (${targetLang}): ${normalizedText || translatedText}`;
        const json = {
            key: Zotero.Utilities.generateObjectKey(),
            type: baseAnnotation?.type || "highlight",
            authorName: "EasyTrans",
            text: baseAnnotation?.text || "",
            comment,
            color: baseAnnotation?.color || "#ffd400",
            pageLabel: baseAnnotation?.pageLabel,
            sortIndex: baseAnnotation?.sortIndex,
            position,
            isExternal: false
        };

        const item = await Zotero.Annotations.saveFromJSON(attachment, json);
        if (item) {
            await reader.setAnnotations([item]);
            this.addTranslationRecord(reader.itemID, {
                annotationID: item.key,
                pageLabel: baseAnnotation?.pageLabel || "",
                text: (baseAnnotation?.text || "").trim(),
                translation: normalizedText || translatedText,
                createdAt: Date.now()
            });
        }
        return item;
    },

    /**
     * Load translated selection records from annotations for an attachment
     */
    async getTranslationRecordsFromAnnotations(itemID) {
        if (!itemID) return [];
        const attachment = await Zotero.Items.getAsync(itemID);
        if (!attachment || !attachment.isFileAttachment?.()) return [];

        let records = [];
        let annotations = [];
        try {
            annotations = attachment.getAnnotations(false) || [];
        } catch (e) {
            Zotero.debug("EasyTrans: Failed to load annotations - " + e.message);
            return [];
        }

        for (const annotation of annotations) {
            if (!annotation?.isAnnotation?.()) continue;
            const comment = annotation.annotationComment || "";
            const author = annotation.annotationAuthorName || "";
            const isEasyTrans = author === "EasyTrans" || comment.startsWith("EasyTrans");
            if (!isEasyTrans) continue;

            let translation = comment;
            const colonIndex = comment.indexOf(":");
            if (colonIndex !== -1) {
                translation = comment.slice(colonIndex + 1).trim();
            }

            const sortIndex = annotation.annotationSortIndex || annotation.sortIndex || "";
            let pageNumber = null;
            const pageLabel = annotation.annotationPageLabel || "";
            if (pageLabel) {
                const parsed = parseInt(pageLabel, 10);
                if (!Number.isNaN(parsed)) pageNumber = parsed;
            }

            records.push({
                annotationID: annotation.key,
                pageLabel,
                text: (annotation.annotationText || "").trim(),
                translation: translation.trim(),
                createdAt: Date.parse(annotation.dateAdded) || 0,
                sortIndex,
                pageNumber
            });
        }

        records.sort((a, b) => {
            if (a.sortIndex && b.sortIndex) {
                const cmp = String(a.sortIndex).localeCompare(String(b.sortIndex));
                if (cmp !== 0) return cmp;
            } else if (a.sortIndex && !b.sortIndex) {
                return -1;
            } else if (!a.sortIndex && b.sortIndex) {
                return 1;
            }

            if (a.pageNumber != null && b.pageNumber != null) {
                if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
            } else if (a.pageNumber != null && b.pageNumber == null) {
                return -1;
            } else if (a.pageNumber == null && b.pageNumber != null) {
                return 1;
            }

            return (a.createdAt || 0) - (b.createdAt || 0);
        });
        return records;
    },

    /**
     * Register reader integration for selection translation
     */
    registerReaderIntegration() {
        if (this._readerIntegrationRegistered) return;
        this._readerIntegrationRegistered = true;

        const self = this;

        try {
            Zotero.Reader.registerEventListener("renderToolbar", (event) => {
                self.ensureStyles(event.doc);
            }, this.id);

            Zotero.Reader.registerEventListener("renderSidebarAnnotationHeader", (event) => {
                self.ensureStyles(event.doc);
            }, this.id);

            Zotero.Reader.registerEventListener("renderTextSelectionPopup", (event) => {
                const { reader, doc, params, append } = event;
                self.ensureStyles(doc);
                const selectionText = params?.annotation?.text || "";
                if (!selectionText.trim()) return;

                const container = doc.createElement("div");
                container.className = "easytrans-selection-popup";
                container.setAttribute("role", "button");
                container.tabIndex = 0;

                const button = doc.createElement("button");
                button.className = "easytrans-translate-selection";
                button.textContent = "Translate";

                container.addEventListener("click", (event) => {
                    if (event.target === button || button.contains(event.target)) return;
                    button.click();
                });
                container.addEventListener("keydown", (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        button.click();
                    }
                });

                button.addEventListener("click", async (event) => {
                    event.stopPropagation();
                    button.disabled = true;
                    const originalLabel = button.textContent;
                    button.textContent = "Translating...";
                    try {
                        await self.initializeComponents();
                        const targetLang = Zotero.Prefs.get("extensions.easytrans.targetLanguage") || "zh-CN";
                        const translated = await self.translateText(selectionText, "auto", targetLang);
                        const normalized = self.normalizeTranslation(translated);

                        await self.createTranslationAnnotation(reader, params.annotation, normalized || translated, targetLang);
                        self.showTranslationPopup(doc, normalized || translated, targetLang);
                        if (self._refreshPane) {
                            self._refreshPane();
                        }
                    } catch (e) {
                        Zotero.debug("EasyTrans: Selection translation failed - " + e.message);
                        try {
                            Services.prompt.alert(doc.defaultView, "EasyTrans Error", "Translation failed: " + e.message);
                        } catch (alertError) {
                            self.showTranslationPopup(doc, "Translation failed: " + e.message, "error", true);
                        }
                    } finally {
                        button.disabled = false;
                        button.textContent = originalLabel;
                    }
                });

                container.appendChild(button);
                append(container);
            }, this.id);

            Zotero.debug("EasyTrans: Reader integration registered");
        } catch (e) {
            Zotero.debug("EasyTrans: Failed to register reader integration - " + e.message);
            Zotero.logError(e);
        }
    },

    /**
     * Register UI components using Zotero's Plugin APIs
     */
    registerUI() {
        Zotero.debug("EasyTrans: Registering UI components...");

        const iconPath = this.rootURI + "chrome/content/icons/easytrans.svg";
        const iconPath20 = this.rootURI + "chrome/content/icons/easytrans-20.svg";

        // Store reference to this for callbacks
        const self = this;
        const ensureSectionLabel = (body) => {
            try {
                const section = body?.closest?.("collapsible-section");
                if (!section) return;
                const desired = "EasyTrans";
                if (!section.label || section.label !== desired) {
                    section.label = desired;
                    section.setAttribute("label", desired);
                }
            } catch (e) {}
        };

        // Register Item Pane Section
        try {
            const paneID = Zotero.ItemPaneManager.registerSection({
                paneID: "easytrans-section",
                pluginID: this.id,
                header: {
                    l10nID: "easytrans-pane-header",
                    label: "EasyTrans",
                    icon: iconPath
                },
                sidenav: {
                    l10nID: "easytrans-sidenav",
                    label: "EasyTrans",
                    icon: iconPath20
                },
                onInit: ({ paneID, doc, body, refresh }) => {
                    Zotero.debug("EasyTrans: Section onInit called");
                    // Store refresh function
                    self._refreshPane = refresh;
                },
                onDestroy: ({ paneID, doc, body }) => {
                    Zotero.debug("EasyTrans: Section onDestroy called");
                    self._refreshPane = null;
                },
                onItemChange: ({ paneID, doc, body, item, tabType, editable, setEnabled, setSectionSummary }) => {
                    // Always enable for testing
                    setEnabled(true);
                    const currentItemID = item?.id || null;
                    if (self._lastSummaryItemID !== currentItemID) {
                        self._lastSummaryItemID = currentItemID;
                        self._lastTranslationCount = 0;
                    }
                    const count = self._lastTranslationCount || 0;
                    const summary = count > 0 ? `· ${count}` : "";
                    setSectionSummary(summary);
                    return true;
                },
                // onRender MUST be synchronous
                onRender: ({ doc, body, item }) => {
                    Zotero.debug("EasyTrans: Section onRender called");

                    // Clear existing content
                    while (body.firstChild) {
                        body.removeChild(body.firstChild);
                    }

                    try {
                        self.ensureStyles(doc);
                        if (typeof TranslationPane?.render !== "function") {
                            throw new Error("TranslationPane not loaded");
                        }
                        TranslationPane.render(body, item);
                        ensureSectionLabel(body);
                    } catch (e) {
                        Zotero.logError(e);
                        const fallback = doc.createElement("div");
                        fallback.textContent = "EasyTrans UI failed to load: " + e.message;
                        fallback.style.cssText = "padding: 8px; color: #c62828; font-size: 12px;";
                        body.appendChild(fallback);
                    }

                    Zotero.debug("EasyTrans: Section rendered");
                },
                // Async render to update model status
                onAsyncRender: async ({ doc, body, item }) => {
                    Zotero.debug("EasyTrans: Section onAsyncRender called");

                    try {
                        await self.initializeComponents();
                        await TranslationPane.asyncRender(body, item);
                        ensureSectionLabel(body);
                    } catch (e) {
                        Zotero.debug("EasyTrans: Async render failed - " + e.message);
                    }

                    const downloadBtn = TranslationPane?.ensureSectionDownloadButton?.(body);

                    if (!downloadBtn) return;

                    const setModelButtonLabel = (label) => {
                        if (typeof TranslationPane?.setDownloadButtonLabel === "function") {
                            TranslationPane.setDownloadButtonLabel(downloadBtn, label);
                        } else {
                            downloadBtn.textContent = label;
                            downloadBtn.setAttribute?.("label", label);
                        }
                    };

                    try {
                        const modelInfo = await self.getModelInfo();
                        Zotero.debug("EasyTrans: Model info - " + JSON.stringify(modelInfo));

                        if (modelInfo.downloaded) {
                            setModelButtonLabel(`Model ready (${modelInfo.sizeFormatted})`);
                        } else {
                            const expectedSize = modelInfo.expectedSizeFormatted || modelInfo.sizeFormatted || "";
                            setModelButtonLabel(expectedSize
                                ? `Download Model (${expectedSize})`
                                : "Download Model");
                        }
                    } catch (e) {
                        Zotero.debug("EasyTrans: Error in onAsyncRender - " + e.message);
                        setModelButtonLabel("Download Model");
                    }
                }
            });

            Zotero.debug("EasyTrans: Section registered with paneID=" + paneID);

        } catch (e) {
            Zotero.debug("EasyTrans: Failed to register section - " + e.message);
            Zotero.logError(e);
        }

        Zotero.debug("EasyTrans: UI registration complete");
    }
};
