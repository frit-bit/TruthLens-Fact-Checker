const GEMINI_API_KEY_PLACEHOLDER = "PASTE_YOUR_GEMINI_API_KEY_HERE";
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_SOURCE_LINKS = 6;

let form;
let input;
let statusMessage;
let results;
let submitButton;
let extractButton;

document.addEventListener("DOMContentLoaded", () => {
    form = document.getElementById("query-form");
    input = document.getElementById("input-field");
    statusMessage = document.getElementById("status");
    results = document.getElementById("results");
    submitButton = document.getElementById("submit-btn");
    extractButton = document.getElementById("extract-text-button");

    extractButton.addEventListener("click", extractText);
    document.getElementById("close-btn").addEventListener("click", closePopup);

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        const query = input.value.trim();
        if (!query) {
            setStatus("Enter a claim or select text on a page first.", true);
            return;
        }
        checkFacts(query);
    });
});

function closePopup() {
    window.close();
}

function extractText() {
    if (typeof chrome === "undefined" || !chrome.tabs || !chrome.scripting) {
        setStatus("Selected-text lookup only works from the loaded Chrome extension popup.", true);
        return;
    }

    setBusy(true, "Reading selected text...");

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError) {
            setBusy(false);
            setStatus(chrome.runtime.lastError.message, true);
            return;
        }

        const activeTab = tabs[0];
        if (!activeTab || !activeTab.id) {
            setBusy(false);
            setStatus("No active tab found.", true);
            return;
        }

        chrome.scripting.executeScript(
            {
                target: { tabId: activeTab.id },
                func: () => window.getSelection().toString()
            },
            (scriptResults) => {
                if (chrome.runtime.lastError) {
                    setBusy(false);
                    setStatus(chrome.runtime.lastError.message, true);
                    return;
                }

                const selectedText = scriptResults?.[0]?.result?.trim();
                if (!selectedText) {
                    setBusy(false);
                    setStatus("No text selected on the active page.", true);
                    return;
                }

                input.value = selectedText;
                checkFacts(selectedText);
            }
        );
    });
}

async function checkFacts(text) {
    results.replaceChildren();

    const apiKey = getGeminiApiKey();
    if (!isGeminiApiKeyConfigured(apiKey)) {
        setStatus("Add your Gemini API key in config.js before fact-checking.", true);
        return;
    }

    setBusy(true, "Fact-checking...");

    try {
        const response = await fetch(GEMINI_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey
            },
            body: JSON.stringify({
                contents: [
                    {
                        role: "user",
                        parts: [{ text: buildFactCheckPrompt(text) }]
                    }
                ],
                tools: [{ google_search: {} }],
                generationConfig: {
                    maxOutputTokens: 1200
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status} ${response.statusText}: ${errorText}`);
        }

        const data = await response.json();
        renderResults(data);
    } catch (error) {
        console.error("Error fetching fact-check data:", error);
        setStatus(`Failed to fact-check. ${error.message}`, true);
    } finally {
        setBusy(false);
    }
}

function renderResults(data) {
    results.replaceChildren();

    const report = getGeminiReport(data);
    if (!report) {
        const blockReason = data.promptFeedback?.blockReason;
        setStatus(blockReason ? `Gemini did not return a report. Block reason: ${blockReason}.` : "Gemini did not return a report.", true);
        return;
    }

    const item = document.createElement("article");
    item.className = "claim";

    const title = document.createElement("h2");
    title.textContent = "Fact check";
    item.append(title);

    const reportText = document.createElement("div");
    reportText.className = "gemini-report";
    renderMarkdown(reportText, report);
    item.append(reportText);

    const sources = getGroundingSources(data);
    if (sources.length > 0) {
        const sourceTitle = document.createElement("h3");
        sourceTitle.textContent = "Sources";
        item.append(sourceTitle);

        const sourceList = document.createElement("ul");
        sourceList.className = "source-list";

        sources.forEach((source) => {
            const sourceItem = document.createElement("li");
            const link = document.createElement("a");
            link.href = source.uri;
            link.target = "_blank";
            link.rel = "noreferrer";
            link.textContent = source.title || source.uri;
            sourceItem.append(link);
            sourceList.append(sourceItem);
        });

        item.append(sourceList);
    }

    const searchSuggestions = getSearchSuggestions(data);
    if (searchSuggestions) {
        const suggestions = document.createElement("div");
        suggestions.className = "search-suggestions";
        suggestions.innerHTML = searchSuggestions;
        item.append(suggestions);
    }

    results.append(item);
    setStatus("Fact check complete.");
}

function getGeminiApiKey() {
    const config = typeof window === "undefined" ? undefined : window.TRUTHLENS_CONFIG;
    const apiKey = config?.GEMINI_API_KEY;
    return typeof apiKey === "string" ? apiKey.trim() : "";
}

function isGeminiApiKeyConfigured(apiKey) {
    return apiKey !== "" && apiKey !== GEMINI_API_KEY_PLACEHOLDER;
}

function buildFactCheckPrompt(text) {
    return [
        "You are a careful fact checker. Fact-check the user's claim or claims using available evidence.",
        "Extract up to five distinct factual claims from the text. Ignore opinions, requests, and unverifiable personal beliefs.",
        "For each claim, include these fields in plain text: Claim, Verdict, Evidence, and Notes if needed.",
        "Use one of these verdicts: True, Mostly true, Mixed, Misleading, False, or Unverified.",
        "Prefer primary or authoritative sources. If evidence is not strong enough, use Unverified instead of guessing.",
        "Keep the response concise and readable in a small browser extension popup.",
        "",
        "Text to fact-check:",
        text
    ].join("\n");
}

function getGeminiReport(data) {
    const parts = data.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) {
        return "";
    }

    return parts
        .map((part) => part.text || "")
        .join("\n")
        .trim();
}

function getGroundingSources(data) {
    const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks;
    if (!Array.isArray(chunks)) {
        return [];
    }

    const seen = new Set();
    const sources = [];

    chunks.forEach((chunk) => {
        const uri = chunk.web?.uri;
        if (!uri || seen.has(uri)) {
            return;
        }

        seen.add(uri);
        sources.push({
            uri,
            title: chunk.web?.title || uri
        });
    });

    return sources.slice(0, MAX_SOURCE_LINKS);
}

function getSearchSuggestions(data) {
    return data.candidates?.[0]?.groundingMetadata?.searchEntryPoint?.renderedContent || "";
}

function renderMarkdown(container, markdown) {
    container.replaceChildren();

    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    let list = null;

    const flushList = () => {
        if (list) {
            container.append(list);
            list = null;
        }
    };

    lines.forEach((line) => {
        const trimmed = line.trim();

        if (!trimmed) {
            flushList();
            return;
        }

        const headingMatch = /^(#{1,3})\s+(.*)$/.exec(trimmed);
        const listMatch = /^[-*+]\s+(.*)$/.exec(trimmed);
        const orderedMatch = /^\d+\.\s+(.*)$/.exec(trimmed);

        if (headingMatch) {
            flushList();
            const level = headingMatch[1].length + 2;
            const heading = document.createElement(`h${Math.min(level, 6)}`);
            heading.append(...parseInlineMarkdown(headingMatch[2]));
            container.append(heading);
            return;
        }

        if (listMatch || orderedMatch) {
            if (!list) {
                list = document.createElement(listMatch ? "ul" : "ol");
                list.className = "markdown-list";
            }

            const item = document.createElement("li");
            item.append(...parseInlineMarkdown((listMatch || orderedMatch)[1]));
            list.append(item);
            return;
        }

        flushList();
        const paragraph = document.createElement("p");
        paragraph.append(...parseInlineMarkdown(trimmed));
        container.append(paragraph);
    });

    flushList();
}

function parseInlineMarkdown(text) {
    const nodes = [];
    const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
        if (match.index > lastIndex) {
            nodes.push(document.createTextNode(text.slice(lastIndex, match.index)));
        }

        const token = match[0];
        if (token.startsWith("**")) {
            const strong = document.createElement("strong");
            strong.textContent = token.slice(2, -2);
            nodes.push(strong);
        } else if (token.startsWith("*")) {
            const em = document.createElement("em");
            em.textContent = token.slice(1, -1);
            nodes.push(em);
        } else if (token.startsWith("`")) {
            const code = document.createElement("code");
            code.textContent = token.slice(1, -1);
            nodes.push(code);
        } else {
            const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
            if (linkMatch) {
                const link = document.createElement("a");
                link.href = linkMatch[2];
                link.target = "_blank";
                link.rel = "noreferrer";
                link.textContent = linkMatch[1];
                nodes.push(link);
            }
        }

        lastIndex = pattern.lastIndex;
    }

    if (lastIndex < text.length) {
        nodes.push(document.createTextNode(text.slice(lastIndex)));
    }

    return nodes;
}

function setBusy(isBusy, message = "") {
    submitButton.disabled = isBusy;
    extractButton.disabled = isBusy;
    if (message) {
        setStatus(message);
    }
}

function setStatus(message, isError = false) {
    statusMessage.textContent = message;
    statusMessage.classList.toggle("error", isError);
}
