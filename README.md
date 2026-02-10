# Zotero EasyTrans

Zotero EasyTrans is a Zotero 8 plugin for offline translation of selected PDF text using the [TranslateGemma](https://blog.google/innovation-and-ai/technology/developers-tools/translategemma/) 4B on-device translation model.

## Screenshots

<figure align="center">
  <img src="docs/screenshots/01-selection.png" alt="Selection translate popup" width="320" />
  <figcaption>Selection translate popup</figcaption>
</figure>

<figure align="center">
  <img src="docs/screenshots/02-panel.png" alt="EasyTrans panel" width="320" />
  <figcaption>EasyTrans panel</figcaption>
</figure>

<figure align="center">
  <img src="docs/screenshots/03-annotation.png" alt="Highlight + translation note" width="540" />
  <figcaption>Highlight + translation note</figcaption>
</figure>

<figure align="center">
  <img src="docs/screenshots/04-popup.png" alt="Translation result bubble" width="540" />
  <figcaption>Translation result bubble</figcaption>
</figure>

## What It Does
Translate selected text inside Zotero's PDF reader and save the translation as an annotation.

## Why This Plugin
- Faster than switching to external translators while reading
- No text is uploaded (privacy-friendly)
- No online API dependency or costs

## Model
- [TranslateGemma](https://blog.google/innovation-and-ai/technology/developers-tools/translategemma/) 4B (GGUF), an on-device translation model from Google, running locally via llama.cpp

## Benefits
- Fully offline translation (model download is one-time)
- Keeps your data local
- Translations are saved as annotations for later review

## Supported Languages
English, Simplified Chinese, Traditional Chinese, Hindi, Spanish, Arabic, French, Portuguese, Russian, German, Japanese, Korean, Italian, Dutch

## How To Use
1. Download the XPI for your platform from [GitHub Releases](https://github.com/binbinsh/zotero-easytrans/releases/latest):
   - **macOS**: `zotero-easytrans-macos.xpi`
   - **Windows**: `zotero-easytrans-windows.xpi`
   - **Linux**: `zotero-easytrans-linux.xpi`
2. Install the downloaded XPI in Zotero 8 (Tools → Add-ons → Install Add-on From File).
3. On first use, download the TranslateGemma 4B model (~2.5 GB).
4. Open a PDF item and select a target language in the `EasyTrans` panel.
5. Select text in the PDF, click `Translate`, and the translation will show and be saved as an annotation.
6. The panel lists all translated selections.

## License
MIT
