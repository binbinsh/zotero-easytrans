/* eslint-disable no-undef */
/**
 * TranslationPane - Side-by-side translation view component
 */

var TranslationPane = {
    currentItem: null,

    /**
     * Render the translation pane (synchronous initial render)
     */
    render(body, item) {
        this.currentItem = item;

        const doc = body.ownerDocument || document;
        body.textContent = "";

        const container = doc.createElement("div");
        container.className = "easytrans-container";

        const header = doc.createElement("div");
        header.className = "easytrans-header";

        const left = doc.createElement("div");
        left.className = "easytrans-controls-left";

        const langLabel = doc.createElement("label");
        langLabel.className = "easytrans-label";
        langLabel.textContent = "Translate to";
        left.appendChild(langLabel);

        const langSelect = doc.createElement("select");
        langSelect.id = "easytrans-target-lang";
        langSelect.className = "easytrans-select";
        const currentLang = Zotero.Prefs.get("extensions.easytrans.targetLanguage") || "zh-CN";
        for (const [code, name] of Object.entries(EasyTrans.LANGUAGES)) {
            const option = doc.createElement("option");
            option.value = code;
            option.textContent = name;
            if (code === currentLang) option.selected = true;
            langSelect.appendChild(option);
        }
        left.appendChild(langSelect);

        const right = doc.createElement("div");
        right.className = "easytrans-controls-right";

        const downloadBtn = doc.createElement("button");
        downloadBtn.id = "easytrans-download-model-btn";
        downloadBtn.className = "easytrans-button";
        downloadBtn.textContent = "Download Model";
        const baseBg = "var(--accent-blue, #2d74ff)";
        const hoverBg = "var(--accent-blue-darker, #2258c7)";
        downloadBtn.style.background = baseBg;
        downloadBtn.style.borderColor = baseBg;
        downloadBtn.style.color = "#fff";
        downloadBtn.addEventListener("mouseenter", () => {
            downloadBtn.style.background = hoverBg;
            downloadBtn.style.borderColor = hoverBg;
            downloadBtn.style.color = "#fff";
        });
        downloadBtn.addEventListener("mouseleave", () => {
            downloadBtn.style.background = baseBg;
            downloadBtn.style.borderColor = baseBg;
            downloadBtn.style.color = "#fff";
        });
        right.appendChild(downloadBtn);

        header.appendChild(left);
        header.appendChild(right);

        container.appendChild(header);

        const translations = doc.createElement("div");
        translations.className = "easytrans-translations";

        const translationsHeader = doc.createElement("div");
        translationsHeader.className = "easytrans-translations-header";
        translationsHeader.textContent = "Translated Selections";
        translations.appendChild(translationsHeader);

        const translationsBody = doc.createElement("div");
        translationsBody.className = "easytrans-translations-body";
        translationsBody.id = "easytrans-translation-list";
        const placeholder = doc.createElement("p");
        placeholder.className = "easytrans-placeholder";
        placeholder.textContent = "No translated selections yet";
        translationsBody.appendChild(placeholder);
        translations.appendChild(translationsBody);

        container.appendChild(translations);

        body.appendChild(container);

        // Bind event listeners
        this.bindEvents(body);
    },

    /**
     * Async render for loading content
     */
    async asyncRender(body, item) {
        this.currentItem = item;

        try {
            await EasyTrans.initializeComponents();

            // Render translated selections list (from selected item or active reader)
            let attachment = null;
            try {
                if (item?.isAttachment?.()) {
                    attachment = item;
                } else if (item?.isRegularItem?.()) {
                    const attachmentIDs = item.getAttachments?.() || [];
                    for (const attachmentID of attachmentIDs) {
                        const candidate = await Zotero.Items.getAsync(attachmentID);
                        if (candidate?.attachmentContentType === "application/pdf") {
                            attachment = candidate;
                            break;
                        }
                    }
                }
            } catch (e) {
                Zotero.debug("TranslationPane: Failed to resolve attachment - " + e.message);
            }

            if (!attachment) {
                const reader = EasyTrans.getActiveReader();
                if (reader?.itemID) {
                    attachment = await Zotero.Items.getAsync(reader.itemID);
                }
            }

            const records = attachment?.id
                ? await EasyTrans.getTranslationRecordsFromAnnotations(attachment.id)
                : [];
            this.renderTranslationList(body, records);
            const prevCount = EasyTrans._lastTranslationCount;
            EasyTrans._lastTranslationCount = records.length;
            if (prevCount !== records.length) {
                EasyTrans.requestSummaryRefresh?.();
            }

            // No content panes in list-only view

        } catch (error) {
            Zotero.debug("TranslationPane: Error loading content - " + error.message);
            this.updateStatus(body, "Error: " + error.message);
        }
    },

    /**
     * Render language selection options
     */
    renderLanguageOptions() {
        const currentLang = Zotero.Prefs.get("extensions.easytrans.targetLanguage") || "zh-CN";
        const languages = EasyTrans.LANGUAGES;

        return Object.entries(languages)
            .map(([code, name]) => {
                const selected = code === currentLang ? "selected" : "";
                return `<option value="${code}" ${selected}>${name}</option>`;
            })
            .join("");
    },

    /**
     * Bind event listeners
     */
    bindEvents(body) {
        // Download model button
        const downloadBtn = body.querySelector("#easytrans-download-model-btn");
        if (downloadBtn) {
            downloadBtn.addEventListener("click", () => this.handleDownloadModel(body));
        }

        // Language selection
        const langSelect = body.querySelector("#easytrans-target-lang");
        if (langSelect) {
            langSelect.addEventListener("change", (e) => {
                Zotero.Prefs.set("extensions.easytrans.targetLanguage", e.target.value);
            });
        }

        // No synchronized scrolling needed in list-only view
    },

    /**
     * Render translated selections list
     */
    renderTranslationList(body, records) {
        const list = body.querySelector("#easytrans-translation-list");
        if (!list) return;

        const doc = body.ownerDocument;
        list.innerHTML = "";

        if (!records || !records.length) {
            const empty = doc.createElement("p");
            empty.className = "easytrans-placeholder";
            empty.textContent = "No translated selections yet";
            list.appendChild(empty);
            return;
        }

        for (const record of records) {
            const item = doc.createElement("div");
            item.className = "easytrans-translation-item";

            const header = doc.createElement("div");
            header.className = "easytrans-translation-item-header";
            header.textContent = record.pageLabel ? `Page ${record.pageLabel}` : "Selection";

            item.appendChild(header);
            const previewText = (record.translation || record.text || "").trim();
            const preview = doc.createElement("div");
            preview.className = "easytrans-translation-item-preview";
            preview.textContent = previewText;
            preview.title = previewText;
            item.appendChild(preview);

            item.addEventListener("click", () => {
                if (record.annotationID) {
                    EasyTrans.navigateToAnnotation(record.annotationID);
                }
            });

            list.appendChild(item);
        }
    },


    /**
     * Handle download model button
     */
    async handleDownloadModel(body) {
        try {
            const win = body.ownerDocument?.defaultView;
            const success = await EasyTrans.downloadModel(win);
            if (success && EasyTrans._refreshPane) {
                EasyTrans._refreshPane();
            }
        } catch (error) {
            this.updateStatus(body, "Error: " + error.message);
        }
    },

    /**
     * Update status message
     */
    updateStatus(body, message) {
        const status = body.querySelector("#easytrans-status");
        if (status) {
            status.textContent = message || "";
            return;
        }
    }
};
