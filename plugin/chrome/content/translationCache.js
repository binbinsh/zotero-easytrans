/* eslint-disable no-undef */
/**
 * TranslationCache - Simple file-based cache for translations
 * Uses JSON file storage instead of SQLite for simplicity and compatibility
 */

class TranslationCache {
    constructor() {
        this.cache = new Map();
        this.cachePath = null;
        this.dirty = false;
        this.maxEntries = 10000;
    }

    /**
     * Initialize the cache
     */
    async init() {
        Zotero.debug("TranslationCache: Initializing...");

        try {
            // Get cache file path
            const cacheDir = PathUtils.join(Zotero.Profile.dir, "easytrans");
            this.cachePath = PathUtils.join(cacheDir, "translation_cache.json");

            // Ensure directory exists
            await IOUtils.makeDirectory(cacheDir, { createAncestors: true });

            // Load existing cache
            await this.load();

            // Clean old entries
            this.cleanOldEntries();

            Zotero.debug("TranslationCache: Initialized with " + this.cache.size + " entries");

        } catch (error) {
            Zotero.debug("TranslationCache: Initialization failed - " + error.message);
            // Don't throw - cache is optional, translation should still work
            this.cache = new Map();
        }
    }

    /**
     * Load cache from disk
     */
    async load() {
        try {
            const exists = await IOUtils.exists(this.cachePath);
            if (!exists) {
                Zotero.debug("TranslationCache: No existing cache file");
                return;
            }

            const data = await IOUtils.readUTF8(this.cachePath);
            const entries = JSON.parse(data);

            if (Array.isArray(entries)) {
                for (const entry of entries) {
                    if (entry.key && entry.value) {
                        this.cache.set(entry.key, entry.value);
                    }
                }
            }

            Zotero.debug("TranslationCache: Loaded " + this.cache.size + " entries from disk");

        } catch (error) {
            Zotero.debug("TranslationCache: Failed to load cache - " + error.message);
            this.cache = new Map();
        }
    }

    /**
     * Save cache to disk
     */
    async save() {
        if (!this.dirty || !this.cachePath) return;

        try {
            const entries = [];
            for (const [key, value] of this.cache) {
                entries.push({ key, value });
            }

            const data = JSON.stringify(entries, null, 2);
            await IOUtils.writeUTF8(this.cachePath, data);
            this.dirty = false;

            Zotero.debug("TranslationCache: Saved " + entries.length + " entries to disk");

        } catch (error) {
            Zotero.debug("TranslationCache: Failed to save cache - " + error.message);
        }
    }

    /**
     * Clean old cache entries
     */
    cleanOldEntries() {
        const cacheDays = Zotero.Prefs.get("extensions.easytrans.cacheDays") || 30;
        const cutoffTime = Date.now() - (cacheDays * 24 * 60 * 60 * 1000);
        let removed = 0;

        for (const [key, value] of this.cache) {
            if (value.accessedAt < cutoffTime) {
                this.cache.delete(key);
                removed++;
            }
        }

        if (removed > 0) {
            this.dirty = true;
            Zotero.debug("TranslationCache: Cleaned " + removed + " old entries");
        }

        // Also enforce max entries limit
        if (this.cache.size > this.maxEntries) {
            const entries = Array.from(this.cache.entries())
                .sort((a, b) => a[1].accessedAt - b[1].accessedAt);

            const toRemove = entries.slice(0, this.cache.size - this.maxEntries);
            for (const [key] of toRemove) {
                this.cache.delete(key);
            }
            this.dirty = true;
        }
    }

    /**
     * Generate cache key
     */
    getCacheKey(text, sourceLang, targetLang) {
        return `${sourceLang}:${targetLang}:${this.hashText(text)}`;
    }

    /**
     * Simple hash function for cache keys
     */
    hashText(text) {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash.toString(16);
    }

    /**
     * Get a cached translation
     */
    async get(text, sourceLang, targetLang) {
        const key = this.getCacheKey(text, sourceLang, targetLang);
        const entry = this.cache.get(key);

        if (entry) {
            // Update access time
            entry.accessedAt = Date.now();
            this.dirty = true;
            return entry.translation;
        }

        return null;
    }

    /**
     * Store a translation in the cache
     */
    async set(text, sourceLang, targetLang, translation) {
        const key = this.getCacheKey(text, sourceLang, targetLang);
        const now = Date.now();

        this.cache.set(key, {
            sourceText: text.substring(0, 100), // Store truncated for debugging
            translation: translation,
            createdAt: now,
            accessedAt: now
        });

        this.dirty = true;

        // Save periodically (every 100 entries)
        if (this.cache.size % 100 === 0) {
            await this.save();
        }
    }

    /**
     * Clear all cached translations
     */
    async clear() {
        this.cache.clear();
        this.dirty = true;
        await this.save();
        Zotero.debug("TranslationCache: Cache cleared");
    }

    /**
     * Get cache statistics
     */
    async getStats() {
        let totalSize = 0;
        for (const [, value] of this.cache) {
            totalSize += (value.sourceText?.length || 0) + (value.translation?.length || 0);
        }

        return {
            count: this.cache.size,
            size: totalSize
        };
    }

    /**
     * Close and save the cache
     */
    async close() {
        await this.save();
        this.cache.clear();
        Zotero.debug("TranslationCache: Cache closed");
    }
}
