# Zotero EasyTrans - Development Guide

## Project Overview

Zotero EasyTrans is a Zotero 8 plugin for offline translation of selected PDF text using the [TranslateGemma](https://blog.google/innovation-and-ai/technology/developers-tools/translategemma/) 4B on-device translation model.

## Project Structure

```
zotero-easytrans/
├── plugin/                          # Zotero plugin
│   ├── manifest.json                # Plugin manifest (WebExtension format)
│   ├── bootstrap.js                 # Lifecycle management
│   ├── chrome/
│   │   ├── content/
│   │   │   ├── easytrans.js         # Main plugin logic
│   │   │   ├── modelDownloader.js   # Model download functionality
│   │   │   ├── icons/               # SVG icons
│   │   │   └── lib/                 # Native libraries (llama.cpp)
│   │   └── locale/
│   │       ├── en-US/easytrans.ftl  # English localization
│   │       └── zh-CN/easytrans.ftl  # Chinese localization
├── vendors/zotero/                  # Zotero source (API reference)
└── scripts/                         # Build scripts
```

## Building the Plugin

```bash
cd plugin && zip -r ../zotero-easytrans.xpi *
```

---

# Zotero 8 Plugin API Reference

## 1. ItemPaneManager API

**Register custom sections in the item pane.**

### `Zotero.ItemPaneManager.registerSection(options)`

```javascript
Zotero.ItemPaneManager.registerSection({
  paneID: string,           // Unique pane ID
  pluginID: string,         // Plugin ID for auto-cleanup
  header: {
    l10nID: string,         // Localization ID
    l10nArgs?: string,      // Optional l10n arguments
    icon: string,           // Icon URI (16x16)
    darkIcon?: string       // Optional dark mode icon
  },
  sidenav: {
    l10nID: string,         // Localization ID
    icon: string,           // Icon URI (20x20)
    darkIcon?: string,
    orderable?: boolean     // Can be reordered (default: true)
  },
  bodyXHTML?: string,       // Section body HTML
  sectionButtons?: Array,   // Section header buttons
  onInit?: function,        // Initialization hook
  onDestroy?: function,     // Cleanup hook
  onItemChange?: function,  // Item change hook
  onRender: function,       // Required: MUST BE SYNCHRONOUS
  onAsyncRender?: function, // Async rendering (optional)
  onToggle?: function       // Section toggle hook
});
```

**Lifecycle Hooks:**

- **`onInit({ paneID, doc, body, item, tabType, editable, setL10nArgs, setEnabled, setSectionSummary, setSectionButtonStatus, refresh })`**: Called when section is initialized.

- **`onDestroy({ paneID, doc, body })`**: Called when section is destroyed.

- **`onItemChange({ ...args })`**: Returns boolean. Called when target item changes.

- **`onRender({ paneID, doc, body, item, tabType, editable, ...helpers })`**: **MUST BE SYNCHRONOUS**. Append elements to `body` using DOM API.

- **`onAsyncRender({ ...args })`**: Optional async rendering for time-consuming operations.

**Helper Functions:**
- `setEnabled(enabled)`: Enable/disable section
- `setSectionSummary(summary)`: Set collapsed header summary
- `refresh()`: Refresh the section (async)

**Example:**
```javascript
Zotero.ItemPaneManager.registerSection({
  paneID: 'my-plugin-pane',
  pluginID: 'my-plugin@namespace.com',
  header: {
    l10nID: 'my-plugin-header',
    icon: 'chrome://my-plugin/content/icon16.svg',
  },
  sidenav: {
    l10nID: 'my-plugin-sidenav',
    icon: 'chrome://my-plugin/content/icon20.svg',
  },
  onItemChange: ({ item, setEnabled }) => {
    setEnabled(item.isRegularItem());
    return true;
  },
  onRender: ({ doc, body, item }) => {
    // SYNCHRONOUS - use DOM API, not innerHTML
    const div = doc.createElement('div');
    div.textContent = item.getField('title');
    body.appendChild(div);
  },
  onAsyncRender: async ({ doc, body, item }) => {
    // Async operations here
    const data = await fetchData();
    const el = body.querySelector('#my-element');
    if (el) el.textContent = data;
  }
});
```

**Unregister:** `Zotero.ItemPaneManager.unregisterSection(paneID)`

---

## 2. MenuManager API

**Register custom menus and menu items.**

### `Zotero.MenuManager.registerMenu(options)`

**Valid Targets:**
- Main menubar: `main/menubar/file`, `main/menubar/edit`, `main/menubar/view`, `main/menubar/go`, `main/menubar/tools`, `main/menubar/help`
- Library context: `main/library/item`, `main/library/collection`, `main/library/addAttachment`, `main/library/addNote`
- Tab context: `main/tab`
- Reader: `reader/menubar/file`, `reader/menubar/edit`, `reader/menubar/view`, `reader/menubar/go`, `reader/menubar/window`

**Menu Types:** `menuitem`, `separator`, `submenu`

```javascript
Zotero.MenuManager.registerMenu({
  menuID: string,
  pluginID: string,
  target: string,           // See valid targets above
  menus: [{
    menuType: 'menuitem' | 'separator' | 'submenu',
    l10nID?: string,
    l10nArgs?: object,
    icon?: string,          // 16x16 SVG recommended
    darkIcon?: string,
    enableForTabTypes?: string[], // ['library', 'reader/pdf', 'reader/epub']
    onShowing?: function,
    onCommand?: function,
    menus?: []              // For submenus
  }]
});
```

**Example:**
```javascript
Zotero.MenuManager.registerMenu({
  menuID: 'my-menu',
  pluginID: 'my-plugin@namespace.com',
  target: 'main/menubar/tools',
  menus: [{
    menuType: 'menuitem',
    l10nID: 'my-menu-item',
    icon: 'chrome://my-plugin/content/icon.svg',
    onCommand: (event, context) => {
      const window = Zotero.getMainWindow();
      Services.prompt.alert(window, 'Title', 'Menu clicked!');
    }
  }]
});
```

**Unregister:** `Zotero.MenuManager.unregisterMenu(menuID)`

---

## 3. PreferencePaneManager API

### `Zotero.PreferencePanes.register(options)`

```javascript
await Zotero.PreferencePanes.register({
  pluginID: string,           // Required
  src: string,                // Required: XHTML fragment URI
  id?: string,                // Auto-generated if not provided
  parent?: string,            // Parent pane ID
  label?: string,             // Defaults to plugin name
  image?: string,             // Icon URI (24x24)
  scripts?: string[],         // Script URIs to load
  stylesheets?: string[],     // Stylesheet URIs
  helpURL?: string            // Shows help button
});
```

---

## 4. Reader API

### `Zotero.Reader.registerEventListener(type, handler, pluginID)`

**Event Types:**
- `renderTextSelectionPopup`
- `renderSidebarAnnotationHeader`
- `renderToolbar`
- `createColorContextMenu`
- `createViewContextMenu`
- `createAnnotationContextMenu`
- `createThumbnailContextMenu`
- `createSelectorContextMenu`

**Example:**
```javascript
Zotero.Reader.registerEventListener('renderTextSelectionPopup', (event) => {
  let { reader, doc, params, append } = event;
  let container = doc.createElement('div');
  container.textContent = 'Custom content';
  append(container);
}, 'my-plugin@namespace.com');
```

**Unregister:** `Zotero.Reader.unregisterEventListener(type, handler)`

---

## 5. ItemTreeManager API

### `Zotero.ItemTreeManager.registerColumn(options)`

```javascript
Zotero.ItemTreeManager.registerColumn({
  dataKey: string,              // Unique identifier
  label: string,                // Column label
  pluginID: string,
  enabledTreeIDs?: string[],    // ['main'], ['*'] for all
  flex?: number,                // Default: 1
  width?: string,
  dataProvider?: function,      // Data callback
  renderCell?: function,        // Cell renderer
  zoteroPersist?: string[]      // ['width', 'hidden', 'sortDirection']
});
```

**Unregister:** `Zotero.ItemTreeManager.unregisterColumn(dataKey)`

---

## 6. HTTP Utilities

### `Zotero.HTTP.request(method, url, options)`

```javascript
let req = await Zotero.HTTP.request('GET', 'https://api.example.com/data', {
  headers: { 'Authorization': 'Bearer token' },
  responseType: 'json',
  timeout: 10000,
  body?: string,
  followRedirects?: boolean,    // Default: true
  noCache?: boolean,
  successCodes?: number[],      // Default: 2xx codes
  cancellerReceiver?: function  // Receives cancel callback
});
let data = req.response;
```

### `Zotero.HTTP.download(uri, path, options)`

```javascript
await Zotero.HTTP.download(
  'https://example.com/file.pdf',
  '/path/to/save/file.pdf',
  { timeout: 60000 }
);
```

---

## 7. File Operations

### IOUtils (Modern API - Preferred)

```javascript
// Check if file exists
const exists = await IOUtils.exists(path);

// Read file
const data = await IOUtils.read(path);  // Returns Uint8Array

// Write file
await IOUtils.write(path, uint8Array);

// Get file info
const stat = await IOUtils.stat(path);  // { size, type, ... }

// Create directory
await IOUtils.makeDirectory(path, { createAncestors: true });

// Move file
await IOUtils.move(oldPath, newPath);

// Remove file
await IOUtils.remove(path);
```

### PathUtils

```javascript
// Join paths
const fullPath = PathUtils.join(dir, 'subdir', 'file.txt');

// Get filename
const name = PathUtils.filename(path);

// Get parent directory
const parent = PathUtils.parent(path);
```

### Zotero.File

```javascript
// Read file contents
let content = await Zotero.File.getContentsAsync('/path/to/file.txt', 'utf-8');

// Write file contents
await Zotero.File.putContentsAsync('/path/to/file.txt', 'Hello World', 'utf-8');

// Create directory
await Zotero.File.createDirectoryIfMissingAsync(path);

// Remove if exists
await Zotero.File.removeIfExists(path);
```

---

## 8. Progress Windows

```javascript
const pw = new Zotero.ProgressWindow({ closeOnClick: false });
pw.changeHeadline('Downloading Model');
pw.show();

const itemProgress = new pw.ItemProgress(
  'chrome://my-plugin/content/icon.svg',
  'File Name'
);
itemProgress.setProgress(50);  // 0-100
itemProgress.setText('50% complete');

// On completion
itemProgress.setProgress(100);
pw.startCloseTimer(3000);

// On error
itemProgress.setError();
itemProgress.setText('Error message');
```

---

## 9. Dialogs and Prompts

```javascript
// Alert dialog
Services.prompt.alert(window, 'Title', 'Message');

// Confirm dialog (returns boolean)
const result = Services.prompt.confirm(window, 'Title', 'Question?');

// Confirm with custom buttons
const result = Services.prompt.confirmEx(
  window,
  'Title',
  'Message',
  Services.prompt.STD_YES_NO_BUTTONS,
  null, null, null, null, {}
);
// result: 0 = Yes, 1 = No
```

---

## 10. Global Objects

```javascript
// Main Zotero object
Zotero.debug('Debug message');
Zotero.logError(error);
Zotero.getMainWindow();
Zotero.Profile.dir;  // Profile directory
Zotero.locale;       // Current locale (e.g., 'en-US', 'zh-CN')

// Preferences
Zotero.Prefs.get('myPref');
Zotero.Prefs.set('myPref', value);

// Platform detection
Zotero.isMac;
Zotero.isWin;
Zotero.isLinux;

// Services (Mozilla)
Services.prompt;     // Dialogs
Services.prefs;      // Preferences
Services.io;         // I/O
Services.scriptloader.loadSubScript(uri);  // Load scripts
```

---

## 11. FTL Localization

### Loading FTL Files (in bootstrap.js)

```javascript
Zotero.Intl.addFluentFile(rootURI + 'chrome/locale/en-US/my-plugin.ftl');
if (Zotero.locale?.startsWith('zh')) {
  Zotero.Intl.addFluentFile(rootURI + 'chrome/locale/zh-CN/my-plugin.ftl');
}
```

### FTL File Format

```ftl
my-plugin-header = My Plugin
my-plugin-with-args = Hello, { $name }!
```

### Using in Elements

```javascript
// Use l10nID in API options
header: { l10nID: 'my-plugin-header' }

// Or set on DOM elements
element.dataset.l10nId = 'my-plugin-header';
element.dataset.l10nArgs = JSON.stringify({ name: 'World' });
```

---

## 12. Bootstrap Lifecycle

```javascript
var MyPlugin;

async function startup({ id, version, rootURI }) {
  // Wait for Zotero to be ready
  await Zotero.initializationPromise;

  // Load FTL files
  Zotero.Intl.addFluentFile(rootURI + 'chrome/locale/en-US/my-plugin.ftl');

  // Load main script
  Services.scriptloader.loadSubScript(rootURI + 'chrome/content/main.js');

  // Initialize
  MyPlugin.rootURI = rootURI;
  MyPlugin.id = id;
  await MyPlugin.init();
}

async function shutdown({ id, version, rootURI }) {
  if (MyPlugin) {
    await MyPlugin.shutdown();
  }
  // Note: Most APIs auto-unregister when pluginID is provided
}

function onMainWindowLoad({ window }) {
  // Called when main window loads
}

function onMainWindowUnload({ window }) {
  // Called when main window unloads
}

function install(data, reason) {}
function uninstall(data, reason) {}
```

---

## 13. XMLHttpRequest (for Downloads)

**Note:** `AbortController` may not be available in plugin context. Use simple boolean flag for cancellation.

```javascript
async downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';

    xhr.onprogress = (event) => {
      if (event.lengthComputable) {
        const progress = (event.loaded / event.total) * 100;
        onProgress?.(progress, event.loaded, event.total);
      }
    };

    xhr.onload = async () => {
      if (xhr.status === 200) {
        const data = new Uint8Array(xhr.response);
        await IOUtils.write(destPath, data);
        resolve(true);
      } else {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send();
  });
}
```

---

## Key Notes

1. **Auto-cleanup**: Most APIs auto-unregister when `pluginID` is provided on plugin shutdown
2. **onRender MUST be synchronous**: Use `onAsyncRender` for async operations
3. **Use DOM API**: Avoid `innerHTML`, use `createElement` and `appendChild`
4. **Icons**: Use SVG with `fill="context-fill"` for automatic theme support
5. **Localization**: All user-facing strings should use FTL files
6. **File paths**: Use absolute paths; IOUtils and PathUtils are preferred
7. **AbortController**: May not be available - use boolean flags for cancellation
