// Content script for ChatGPT (chatgpt.com)
(async function () {
  const { askai_question: question } = await chrome.storage.local.get(
    "askai_question"
  );
  if (!question) return;

  // Wait for the textarea/input to appear
  const input = await waitForElement("#prompt-textarea", 15000);
  if (!input) {
    console.warn("[AskAI] ChatGPT input not found");
    return;
  }

  // ChatGPT uses a contenteditable div or textarea — set its value
  if (input.tagName === "TEXTAREA") {
    setNativeValue(input, question);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    // contenteditable (ProseMirror)
    input.focus();
    input.textContent = question;
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }

  // Small delay then click send
  await sleep(500);
  const sendBtn = document.querySelector(
    'button[data-testid="send-button"], form button[aria-label="Send prompt"]'
  );
  if (sendBtn) {
    sendBtn.click();
  } else {
    // Fallback: press Enter
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    );
  }
})();

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve) => {
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
