const askBtn = document.getElementById("ask-btn");
const questionEl = document.getElementById("question");
const statusEl = document.getElementById("status");

const services = {
  chatgpt: {
    checkbox: document.getElementById("cb-chatgpt"),
    url: "https://chatgpt.com/",
  },
  gemini: {
    checkbox: document.getElementById("cb-gemini"),
    url: "https://gemini.google.com/app",
  },
  claude: {
    checkbox: document.getElementById("cb-claude"),
    url: "https://claude.ai/new",
  },
};

askBtn.addEventListener("click", async () => {
  const question = questionEl.value.trim();
  if (!question) {
    statusEl.textContent = "Please enter a question.";
    return;
  }

  const selected = Object.entries(services).filter(
    ([, s]) => s.checkbox.checked
  );

  if (selected.length === 0) {
    statusEl.textContent = "Select at least one service.";
    return;
  }

  askBtn.disabled = true;
  statusEl.textContent = "Opening tabs...";

  // Store the question so content scripts can pick it up
  await chrome.storage.local.set({ askai_question: question });

  // Open a tab for each selected service
  for (const [, service] of selected) {
    chrome.tabs.create({ url: service.url, active: false });
  }

  statusEl.textContent = `Sent to ${selected.length} service(s)!`;
  askBtn.disabled = false;
});

// Focus textarea on open
questionEl.focus();
