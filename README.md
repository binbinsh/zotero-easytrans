# Zotero EasyTrans

An offline translation plugin for Zotero 8, built for reading papers. It translates selected text in PDFs and keeps a summary list of translated selections.

**Screenshots**
<p align="center">
  <img src="docs/screenshots/01-selection.png" alt="Selection translate popup" style="max-width: 720px; height: auto;" />
</p>
<p align="center"><em>Selection translate popup</em></p>

<p align="center">
  <img src="docs/screenshots/02-panel.png" alt="EasyTrans panel" style="max-width: 720px; height: auto;" />
</p>
<p align="center"><em>EasyTrans panel</em></p>

<p align="center">
  <img src="docs/screenshots/03-annotation.png" alt="Highlight + translation note" style="max-width: 720px; height: auto;" />
</p>
<p align="center"><em>Highlight + translation note</em></p>

<p align="center">
  <img src="docs/screenshots/04-popup.png" alt="Translation result bubble" style="max-width: 720px; height: auto;" />
</p>
<p align="center"><em>Translation result bubble</em></p>

**What it does**
Translate selected text inside Zotero’s PDF reader and save the translation as an annotation.

**Why this plugin**
- Faster than switching to external translators while reading
- No text is uploaded (privacy-friendly)
- No online API dependency or costs

**Model**
- [TranslateGemma](https://blog.google/innovation-and-ai/technology/developers-tools/translategemma/) 4B (GGUF), an on-device translation model from Google, running locally via llama.cpp

**Benefits**
- Fully offline translation (model download is one-time)
- Keeps your data local
- Translations are saved as annotations for later review

**Supported languages (current)**
English, Simplified Chinese, Traditional Chinese, Japanese, Korean, French, German, Spanish

**How to use**
1. Install `zotero-easytrans.xpi` in Zotero 8 (Tools → Add-ons → Install Add-on From File).
2. On first use, download the TranslateGemma 4B model (~2.5 GB).
3. Open a PDF item and select a target language in the `EasyTrans` panel.
4. Select text in the PDF, click `Translate`, and the translation will show and be saved as an annotation.
5. The panel lists all translated selections.

**License**
MIT
