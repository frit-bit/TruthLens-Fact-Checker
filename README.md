# TruthLens — Misinformation Detector

A Chrome browser extension that lets you fact-check claims in seconds. Paste text, type claims, or highlight text on any webpage. The extension submits the claims to the **Gemini API**, asks Gemini to fact-check them, and shows Gemini's report directly in the popup.

---

## Table of Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [How It Works](#how-it-works)
- [Installation (Developer Mode)](#installation-developer-mode)
- [Usage](#usage)
- [API Reference](#api-reference)
- [File Breakdown](#file-breakdown)
- [Known Limitations](#known-limitations)
- [Roadmap](#roadmap)

---

## Features

- **Manual claim input** — type or paste one or more claims into the popup textarea
- **Selected text extraction** — highlight text on any open tab and pull it directly into the extension with one click
- **Gemini fact-checking** — sends claims to Gemini with a prompt that asks for verdicts and concise evidence
- **Grounded source links** — enables Gemini's Google Search grounding and displays returned web sources when available
- **Multi-claim support** — asks Gemini to extract and check up to 5 factual claims from longer selected text
- **Error handling** — clear status messages for empty inputs, network failures, or no results found

---

## Project Structure

```
LexHack-26-Project/
├── manifest.json       # Extension config (MV3) — permissions, icons, popup entry point
├── popup.html          # Popup UI — form, buttons, results container
├── popup.css           # Popup styles — layout, cards, button states
├── popup.js            # Popup logic — API calls, DOM manipulation, tab scripting
├── config.example.js   # Tracked template for local Gemini API configuration
├── icon16.png          # Toolbar icon (16×16)
├── icon48.png          # Extension management icon (48×48)
├── icon128.png         # Chrome Web Store icon (128×128)
└── README.md           # This file
```

`config.js` is intentionally ignored by Git and should contain your real local Gemini API key.


---

## How It Works

```
User Input (typed or selected)
        │
        ▼
  popup.js collects the query
        │
        ├─── "Use Selected Text" path:
        │      chrome.scripting.executeScript()
        │      → injects getSelection() into active tab
        │      → returns highlighted text back to popup
        │
        ▼
  checkFacts(query)
        │
        ▼
  POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent
        │         x-goog-api-key: GEMINI_API_KEY
        │         body: prompt + Google Search grounding tool
        ▼
  Parse Gemini response → candidate text + grounding metadata
        │
        ▼
  renderResults() → builds article cards in #results
        │
        ▼
  User sees: Gemini verdicts, evidence summary, and source links when returned
```

### Permissions used

| Permission | Why it's needed |
|---|---|
| `activeTab` | Read the currently focused tab's ID when extracting selected text |
| `scripting` | Inject `getSelection()` into the active tab to retrieve highlighted text |
| `host_permissions: generativelanguage.googleapis.com` | Allow the fetch() call to the Gemini API |

---

## Installation (Developer Mode)

> No build step required — this is a pure HTML/CSS/JS extension.

1. Clone or download this repository:
   ```bash
   git clone https://github.com/your-username/LexHack-26-Project.git
   ```

2. Open Chrome and navigate to:
   ```
   chrome://extensions
   ```

3. Enable **Developer mode** (toggle in the top-right corner).

4. Create your local API config from the tracked template:
   ```bash
   cp config.example.js config.js
   ```

5. Open `config.js` and replace `PASTE_YOUR_GEMINI_API_KEY_HERE` with your Gemini API key:
   ```js
   window.TRUTHLENS_CONFIG = {
       GEMINI_API_KEY: "your-real-gemini-api-key"
   };
   ```

6. Click **"Load unpacked"** and select the project folder. The extension icon will appear in your Chrome toolbar. Pin it for easy access.

> **API Key:** Put the real key only in `config.js`. The repository ignores `config.js`, so it will not be pushed to GitHub by normal Git commands. Do not put a real key in `config.example.js`, `popup.js`, or any other tracked file. For production use, proxy the Gemini request through a backend instead of exposing the key in extension code.

---

## Usage

### Checking a claim manually

1. Click the extension icon in the Chrome toolbar to open the popup.
2. Type or paste one or more claims into the **"Claim or claims"** textarea.
3. Click **"Fact Check"**.
4. Results appear below as cards, each showing:
   - Gemini's extracted claim text
   - Gemini's **verdict** (e.g. *False*, *Mostly true*, *Unverified*)
   - A concise evidence summary
   - Grounded source links when Gemini returns them

### Using selected text from a webpage

1. On any webpage, **highlight** the text you want to fact-check.
2. Click the extension icon to open the popup.
3. Click **"Use Selected Text"** — the highlighted text is pulled into the textarea and the fact check runs automatically.

### Closing the popup

Click the **"Close"** button or press `Escape` / click outside the popup.

---

## API Reference

This extension uses the **Gemini API** `generateContent` endpoint.

- **Endpoint:** `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent`
- **Authentication:** `x-goog-api-key: <your Gemini API key>`
- **Body fields used:**

| Field | Description |
|---|---|
| `contents` | Prompt asking Gemini to extract and fact-check claims |
| `tools` | Enables `google_search` grounding |
| `generationConfig` | Sets the maximum output length for the popup report |

- **Response shape (simplified):**
  ```json
  {
    "candidates": [
      {
        "content": {
          "parts": [
            { "text": "Claim: ...\nVerdict: ...\nEvidence: ..." }
          ]
        },
        "groundingMetadata": {
          "groundingChunks": [
            { "web": { "uri": "https://...", "title": "Source title" } }
          ]
        }
      }
    ]
  }
  ```

Gemini text generation docs: https://ai.google.dev/gemini-api/docs/text-generation

Gemini API key docs: https://ai.google.dev/gemini-api/docs/api-key

Google Search grounding docs: https://ai.google.dev/gemini-api/docs/google-search

---

## File Breakdown

### `manifest.json`
Declares the extension under **Manifest V3** (the current Chrome standard). Sets the popup entry point to `popup.html`, defines icon paths, and requests the minimum permissions needed.

### `popup.html`
The visible UI. Contains:
- A `<form>` with a `<textarea>` for claim input and a submit button
- An `.actions` row with the "Use Selected Text" and "Close" buttons
- A `#status` paragraph for feedback messages
- A `#results` section where fact-check cards are dynamically injected
- Script tags for local `config.js` and the popup logic

### `popup.css`
Styles the 360px-wide popup. Uses a clean card-based layout for results, with clear visual states for disabled buttons and error messages (red text via `.error` class).

### `popup.js`
All the logic lives here:
- **`extractText()`** — uses `chrome.scripting.executeScript` to run `window.getSelection().toString()` in the active tab and pipe the result back into the popup
- **`checkFacts(text)`** — validates the local Gemini API key from `config.js`, calls `generateContent`, handles HTTP errors, and passes data to the renderer
- **`renderResults(data)`** — reads Gemini's candidate text, appends source links from grounding metadata, and renders the result in `#results`
- **`setBusy()`** / **`setStatus()`** — utility functions that manage button disabled states and status message text

### `config.example.js`
A tracked template for API configuration. Use it to create a local `config.js`; keep the real key out of tracked files.

---

## Known Limitations

- **Model fallibility** — Gemini can still make mistakes. Treat the report as an assisted fact check and verify important claims against the displayed sources.
- **Grounding billing** — Google Search grounding can add cost depending on your Gemini API project and model.
- **No content script** — the extension currently reads selected text via `chrome.scripting` injection rather than a persistent `content.js`. This means it cannot passively monitor pages or auto-highlight suspicious claims.
- **Client-side key exposure** — `config.js` is ignored by Git for local development, but production releases should use a backend proxy so the key is not visible in extension source.
- **5-claim cap** — the prompt asks Gemini to extract up to 5 factual claims for readability in the popup.

---
