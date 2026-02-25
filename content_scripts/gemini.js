// Content script for Gemini (gemini.google.com)
(async function () {
  const { askai_question: question } = await chrome.storage.local.get(
    "askai_question"
  );
  if (!question) return;

  // Gemini uses a rich text editor — look for the input area
  const input = await waitForElement(
    '.ql-editor, [contenteditable="true"], .text-input-field textarea, div[aria-label*="prompt"] p',
    15000
  );
  if (!input) {
    console.warn("[AskAI] Gemini input not found");
    return;
  }

  input.focus();

  if (
    input.getAttribute("contenteditable") === "true" ||
    input.classList.contains("ql-editor")
  ) {
    input.textContent = question;
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  } else {
    setNativeValue(input, question);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  await sleep(500);

  // Click the send button
  const sendBtn = document.querySelector(
    'button[aria-label="Send message"], .send-button, button.send-button'
  );
  if (sendBtn) {
    sendBtn.click();
  } else {
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      })
    );
  }
})();

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve) => {
    // Try multiple selectors separated by comma
    const el = document.querySelector(selector);
    if (el) return resolve(el);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(el, value);
  } else {
    el.value = value;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
