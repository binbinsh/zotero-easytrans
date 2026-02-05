/* eslint-disable no-undef */
/**
 * Zotero EasyTrans Bootstrap
 * Lifecycle management for the translation plugin
 */

var EasyTrans;

// Startup hook - called when plugin is loaded
async function startup({ id, version, rootURI }) {
    Zotero.debug("EasyTrans: startup called with id=" + id);

    // Wait for Zotero to be ready
    await Zotero.initializationPromise;
    Zotero.debug("EasyTrans: Zotero initialized");

    // Load FTL localization
    try {
        Zotero.Intl.addFluentFile(rootURI + "chrome/locale/en-US/easytrans.ftl");
        if (Zotero.locale?.startsWith("zh")) {
            Zotero.Intl.addFluentFile(rootURI + "chrome/locale/zh-CN/easytrans.ftl");
        }
        Zotero.debug("EasyTrans: FTL files loaded");
    } catch (e) {
        Zotero.debug("EasyTrans: Failed to load FTL - " + e.message);
    }

    // Load main script
    try {
        Services.scriptloader.loadSubScript(rootURI + "chrome/content/easytrans.js");
        Zotero.debug("EasyTrans: Main script loaded");
    } catch (e) {
        Zotero.debug("EasyTrans: Failed to load main script - " + e.message);
        Zotero.logError(e);
        return;
    }

    // Initialize plugin
    EasyTrans.rootURI = rootURI;
    EasyTrans.id = id;
    EasyTrans.version = version;

    try {
        await EasyTrans.init();
        Zotero.debug("EasyTrans: Plugin initialized successfully");
    } catch (e) {
        Zotero.debug("EasyTrans: Init failed - " + e.message);
        Zotero.logError(e);
    }
}

// Shutdown hook - called when plugin is unloaded
async function shutdown({ id, version, rootURI }) {
    Zotero.debug("EasyTrans: shutdown called");

    if (EasyTrans) {
        try {
            await EasyTrans.shutdown();
        } catch (e) {
            Zotero.debug("EasyTrans: Shutdown error - " + e.message);
        }
    }

    Zotero.debug("EasyTrans: Plugin unloaded");
}

// Called when main window loads
function onMainWindowLoad({ window }) {
    Zotero.debug("EasyTrans: onMainWindowLoad called");
}

// Called when main window unloads
function onMainWindowUnload({ window }) {
    Zotero.debug("EasyTrans: onMainWindowUnload called");
}

// Install hook
function install(data, reason) {
    Zotero.debug("EasyTrans: install called");
}

// Uninstall hook
function uninstall(data, reason) {
    Zotero.debug("EasyTrans: uninstall called");
}
