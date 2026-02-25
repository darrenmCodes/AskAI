// Content script for Claude (claude.ai)
(async function () {
  const { askai_question: question } = await chrome.storage.local.get(
    "askai_question"
  );
  if (!question) return;

  // Claude uses a contenteditable div (ProseMirror)
  const input = await waitForElement(
    '[contenteditable="true"].ProseMirror, div[contenteditable="true"]',
    15000
  );
  if (!input) {
    console.warn("[AskAI] Claude input not found");
    return;
  }

  input.focus();

  // Create a paragraph with the text for ProseMirror
  const p = document.createElement("p");
  p.textContent = question;
  input.innerHTML = "";
  input.appendChild(p);
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));

  await sleep(500);

  // Click send button
  const sendBtn = document.querySelector(
    'button[aria-label="Send Message"], button[aria-label="Send message"]'
  );
  if (sendBtn) {
    sendBtn.click();
  } else {
    // Fallback: press Enter
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
