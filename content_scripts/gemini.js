// Content script for Gemini (gemini.google.com)
(async function () {
  const data = await chrome.storage.local.get(["askai_question", "askai_consensus"]);
  const question = data.askai_question;
  if (!question) return;

  const isConsensus = !!data.askai_consensus;

  try {
    const input = await waitForElement(
      '.ql-editor, [contenteditable="true"], .text-input-field textarea',
      15000
    );
    if (!input) throw new Error("Input field not found");

    input.focus();

    if (
      input.getAttribute("contenteditable") === "true" ||
      input.classList.contains("ql-editor")
    ) {
      const p = input.querySelector("p");
      if (p) p.textContent = question;
      else input.textContent = question;
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } else {
      setNativeValue(input, question);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    await sleep(600);

    const sendBtn = document.querySelector(
      'button[aria-label="Send message"], .send-button, button.send-button'
    );
    if (sendBtn) sendBtn.click();
    else input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    const responseText = await scrapeResponse();

    if (isConsensus) {
      await chrome.storage.local.remove("askai_consensus");
      chrome.runtime.sendMessage({ type: "ASKAI_CONSENSUS_RESPONSE", text: responseText });
    } else {
      chrome.runtime.sendMessage({ type: "ASKAI_RESPONSE", service: "gemini", text: responseText });
    }
  } catch (err) {
    if (isConsensus) {
      chrome.runtime.sendMessage({ type: "ASKAI_CONSENSUS_RESPONSE", error: err.message });
    } else {
      chrome.runtime.sendMessage({ type: "ASKAI_RESPONSE", service: "gemini", error: err.message });
    }
  }
})();

async function scrapeResponse() {
  await sleep(3000);
  let lastText = "";
  let stableCount = 0;

  for (let i = 0; i < 120; i++) {
    await sleep(2000);
    const messages = document.querySelectorAll(
      'model-response .message-content, .model-response-text, [data-content-type="model"]'
    );
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg) continue;

    const text = lastMsg.innerText.trim();
    if (text && text === lastText) {
      stableCount++;
      if (stableCount >= 3) return text;
    } else {
      lastText = text;
      stableCount = 0;
    }
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

function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
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
      '.ql-editor, [contenteditable="true"], .text-input-field textarea',
      15000
    );
    if (!input) throw new Error("Input field not found");

    input.focus();

    if (
      input.getAttribute("contenteditable") === "true" ||
      input.classList.contains("ql-editor")
    ) {
      const p = input.querySelector("p");
      if (p) p.textContent = question;
      else input.textContent = question;
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } else {
      setNativeValue(input, question);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    await sleep(600);

    const sendBtn = document.querySelector(
      'button[aria-label="Send message"], .send-button, button.send-button'
    );
    if (sendBtn) sendBtn.click();
    else input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    const responseText = await scrapeResponse();

    if (isConsensus) {
      chrome.runtime.sendMessage({ type: "ASKAI_FOLLOWUP_CONSENSUS_RESPONSE", text: responseText });
    } else {
      chrome.runtime.sendMessage({ type: "ASKAI_FOLLOWUP_RESPONSE", service: "gemini", text: responseText });
    }
  } catch (err) {
    if (isConsensus) {
      chrome.runtime.sendMessage({ type: "ASKAI_FOLLOWUP_CONSENSUS_RESPONSE", error: err.message });
    } else {
      chrome.runtime.sendMessage({ type: "ASKAI_FOLLOWUP_RESPONSE", service: "gemini", error: err.message });
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
