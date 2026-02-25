// Content script for Claude (claude.ai)

// Selector tiers — tried in order. First match wins.
// Keeps working if Claude.ai changes their DOM again.
const RESPONSE_SELECTORS = [
  '[data-is-streaming] .standard-markdown',           // 2025+ primary
  '.font-claude-message',                              // legacy
  'div.grid-cols-1 > div .prose',                      // legacy
  '[class*="Message"] [class*="markdown"]',            // legacy
];

(async function () {
  const data = await chrome.storage.local.get(["askai_question", "askai_consensus"]);
  const question = data.askai_question;
  if (!question) return;

  const isConsensus = !!data.askai_consensus;

  try {
    const input = await waitForElement(
      '[contenteditable="true"].ProseMirror, div[contenteditable="true"]',
      15000
    );
    if (!input) throw new Error("Input field not found");

    input.focus();

    const p = document.createElement("p");
    p.textContent = question;
    input.innerHTML = "";
    input.appendChild(p);
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    await sleep(600);

    const sendBtn = document.querySelector(
      'button[aria-label="Send Message"], button[aria-label="Send message"]'
    );
    if (sendBtn) sendBtn.click();
    else input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    const responseText = await scrapeResponse();

    if (isConsensus) {
      await chrome.storage.local.remove("askai_consensus");
      chrome.runtime.sendMessage({ type: "ASKAI_CONSENSUS_RESPONSE", text: responseText });
    } else {
      chrome.runtime.sendMessage({ type: "ASKAI_RESPONSE", service: "claude", text: responseText });
    }
  } catch (err) {
    if (isConsensus) {
      chrome.runtime.sendMessage({ type: "ASKAI_CONSENSUS_RESPONSE", error: err.message });
    } else {
      chrome.runtime.sendMessage({ type: "ASKAI_RESPONSE", service: "claude", error: err.message });
    }
  }
})();

// Try each selector tier until one matches, return the last element matched.
function findLastResponse() {
  for (const sel of RESPONSE_SELECTORS) {
    const els = document.querySelectorAll(sel);
    if (els.length > 0) return els[els.length - 1];
  }
  return null;
}

async function scrapeResponse() {
  await sleep(3000);
  let lastText = "";
  let stableCount = 0;
  let noMatchRuns = 0;

  for (let i = 0; i < 120; i++) {
    await sleep(2000);

    const lastMsg = findLastResponse();

    // If no selector matched at all, track consecutive misses.
    // After 30 misses (60 s) give up early instead of waiting the full 4 min.
    if (!lastMsg) {
      noMatchRuns++;
      if (noMatchRuns >= 30) {
        return lastText || "Response could not be captured (no matching elements).";
      }
      continue;
    }
    noMatchRuns = 0;

    const text = lastMsg.innerText.trim();
    if (text && text === lastText) {
      stableCount++;
      if (stableCount >= 3) return text;
    } else {
      lastText = text;
      stableCount = 0;
    }

    const streaming = document.querySelector('[data-is-streaming="true"]');
    if (!streaming && text && stableCount >= 1) return text;
  }

  return lastText || "Response could not be captured.";
}

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) { observer.disconnect(); resolve(el); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve(null); }, timeout);
  });
}

// Listen for follow-up questions from background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === "SUBMIT_FOLLOWUP") {
    sendResponse({ ok: true });
    handleFollowUp(message.question, message.isConsensus);
  }
});

async function handleFollowUp(question, isConsensus) {
  try {
    const input = await waitForElement(
      '[contenteditable="true"].ProseMirror, div[contenteditable="true"]',
      15000
    );
    if (!input) throw new Error("Input field not found");

    input.focus();

    const p = document.createElement("p");
    p.textContent = question;
    input.innerHTML = "";
    input.appendChild(p);
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));

    await sleep(600);

    const sendBtn = document.querySelector(
      'button[aria-label="Send Message"], button[aria-label="Send message"]'
    );
    if (sendBtn) sendBtn.click();
    else input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    const responseText = await scrapeResponse();

    if (isConsensus) {
      chrome.runtime.sendMessage({ type: "ASKAI_FOLLOWUP_CONSENSUS_RESPONSE", text: responseText });
    } else {
      chrome.runtime.sendMessage({ type: "ASKAI_FOLLOWUP_RESPONSE", service: "claude", text: responseText });
    }
  } catch (err) {
    if (isConsensus) {
      chrome.runtime.sendMessage({ type: "ASKAI_FOLLOWUP_CONSENSUS_RESPONSE", error: err.message });
    } else {
      chrome.runtime.sendMessage({ type: "ASKAI_FOLLOWUP_RESPONSE", service: "claude", error: err.message });
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}