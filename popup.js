const askBtn = document.getElementById("ask-btn");
const questionEl = document.getElementById("question");
const statusEl = document.getElementById("status");
const askView = document.getElementById("ask-view");
const resultsView = document.getElementById("results-view");
const resultsStatusEl = document.getElementById("results-status");
const backBtn = document.getElementById("back-btn");
const summaryModelEl = document.getElementById("summary-model");
const consensusResultEl = document.getElementById("consensus-result");
const consensusTextEl = document.getElementById("consensus-text");
const copyBtn = document.getElementById("copy-btn");
const followupSection = document.getElementById("followup-section");
const followupButtonsEl = document.getElementById("followup-buttons");
const followupInput = document.getElementById("followup-input");
const followupSendBtn = document.getElementById("followup-send-btn");

const SERVICE_LABELS = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  claude: "Claude",
};

let activeServices = [];
let pollingInterval = null;

// Skip buttons
for (const key of ["chatgpt", "gemini", "claude"]) {
  const skipBtn = document.getElementById(`skip-${key}`);
  if (!skipBtn) continue;
  skipBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "ASKAI_SKIP", service: key });
    skipBtn.classList.add("hidden");
    const st = document.getElementById(`status-${key}`);
    if (st) {
      st.textContent = "skipped";
      st.className = "progress-status skipped";
    }
  });
}

// Copy consensus text
copyBtn.addEventListener("click", () => {
  const text = consensusTextEl.textContent;
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.textContent = "Copied!";
    setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
  });
});

// Follow-up: Enter to send
followupInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    followupSendBtn.click();
  }
});

// Send follow-up question
followupSendBtn.addEventListener("click", () => {
  const question = followupInput.value.trim();
  if (!question) return;
  sendFollowUp(question);
});

function sendFollowUp(question) {
  // Disable follow-up UI
  followupSendBtn.disabled = true;
  followupInput.disabled = true;
  document.querySelectorAll(".followup-btn").forEach((btn) => { btn.disabled = true; });

  // Reset progress rows to scraping
  for (const key of activeServices) {
    const st = document.getElementById(`status-${key}`);
    const skipBtn = document.getElementById(`skip-${key}`);
    // Only re-scrape non-skipped services
    const currentText = st.textContent;
    if (currentText === "skipped") continue;
    st.textContent = "scraping...";
    st.className = "progress-status working";
    skipBtn.classList.remove("hidden");
  }

  const consensusSt = document.getElementById("status-consensus");
  const cm = summaryModelEl.value;
  if (cm !== "none") {
    consensusSt.textContent = "waiting...";
    consensusSt.className = "progress-status";
  }

  // Hide consensus result and follow-ups
  consensusResultEl.classList.add("hidden");
  followupSection.classList.add("hidden");
  resultsStatusEl.textContent = "Sending follow-up...";

  chrome.runtime.sendMessage({ type: "ASKAI_FOLLOWUP", question });

  followupInput.value = "";
  startPolling();
}

function renderFollowUps(questions) {
  followupButtonsEl.innerHTML = "";
  if (questions && questions.length > 0) {
    for (const q of questions) {
      const btn = document.createElement("button");
      btn.className = "followup-btn";
      btn.textContent = q;
      btn.addEventListener("click", () => sendFollowUp(q));
      followupButtonsEl.appendChild(btn);
    }
  }
  followupSection.classList.remove("hidden");
  followupSendBtn.disabled = false;
  followupInput.disabled = false;
}

// Enter to submit, Shift+Enter for newline
questionEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    askBtn.click();
  }
});

askBtn.addEventListener("click", async () => {
  const question = questionEl.value.trim();
  if (!question) {
    statusEl.textContent = "Please enter a question.";
    return;
  }

  const checkboxes = {
    chatgpt: document.getElementById("cb-chatgpt"),
    gemini: document.getElementById("cb-gemini"),
    claude: document.getElementById("cb-claude"),
  };

  activeServices = Object.entries(checkboxes)
    .filter(([, cb]) => cb.checked)
    .map(([key]) => key);

  if (activeServices.length === 0) {
    statusEl.textContent = "Select at least one service.";
    return;
  }

  const consensusModel = summaryModelEl.value;

  askBtn.disabled = true;
  statusEl.textContent = "";

  chrome.runtime.sendMessage({
    type: "ASKAI_START",
    question,
    services: activeServices,
    consensusModel,
  });

  // Switch to results view
  askView.classList.add("hidden");
  resultsView.classList.remove("hidden");
  consensusResultEl.classList.add("hidden");
  followupSection.classList.add("hidden");
  resultsStatusEl.textContent = "Working in the background...";

  // Reset progress rows
  for (const key of ["chatgpt", "gemini", "claude"]) {
    const row = document.getElementById(`row-${key}`);
    const st = document.getElementById(`status-${key}`);
    const skipBtn = document.getElementById(`skip-${key}`);
    if (activeServices.includes(key)) {
      row.classList.remove("hidden");
      st.textContent = "scraping...";
      st.className = "progress-status working";
      skipBtn.classList.remove("hidden");
    } else {
      row.classList.add("hidden");
      skipBtn.classList.add("hidden");
    }
  }

  const consensusRow = document.getElementById("row-consensus");
  const consensusSt = document.getElementById("status-consensus");
  if (consensusModel !== "none") {
    consensusRow.classList.remove("hidden");
    consensusSt.textContent = "waiting...";
    consensusSt.className = "progress-status";
  } else {
    consensusRow.classList.add("hidden");
  }

  startPolling();
});

function startPolling() {
  if (pollingInterval) clearInterval(pollingInterval);

  pollingInterval = setInterval(async () => {
    const data = await chrome.storage.local.get([
      "askai_responses",
      "askai_status",
      "askai_consensus_model",
      "askai_consensus_text",
      "askai_followup_questions",
    ]);
    const responses = data.askai_responses || {};

    let doneCount = 0;
    for (const key of activeServices) {
      const st = document.getElementById(`status-${key}`);
      const skipBtn = document.getElementById(`skip-${key}`);
      if (responses[key]) {
        skipBtn.classList.add("hidden");
        if (responses[key].skipped) {
          st.textContent = "skipped";
          st.className = "progress-status skipped";
        } else if (responses[key].error) {
          st.textContent = "error";
          st.className = "progress-status error";
        } else {
          st.textContent = "done";
          st.className = "progress-status done";
        }
        doneCount++;
      }
    }

    const cm = data.askai_consensus_model;
    const consensusSt = document.getElementById("status-consensus");

    const status = data.askai_status;

    if (doneCount >= activeServices.length && cm && cm !== "none") {
      // All scraped — consensus phase
      if (data.askai_consensus_text) {
        // Consensus is done
        consensusSt.textContent = "done";
        consensusSt.className = "progress-status done";
        consensusResultEl.classList.remove("hidden");
        consensusTextEl.textContent = data.askai_consensus_text;
        resultsStatusEl.textContent = "Complete!";
        renderFollowUps(data.askai_followup_questions);
        clearInterval(pollingInterval);
        pollingInterval = null;
      } else if (status === "consensus" || status === "followup_consensus") {
        consensusSt.textContent = "scraping...";
        consensusSt.className = "progress-status working";
        resultsStatusEl.textContent = `Generating consensus via ${SERVICE_LABELS[cm]}...`;
      } else if (status === "followup_scraping") {
        resultsStatusEl.textContent = "Sending follow-up to models...";
      } else {
        consensusSt.textContent = "queued...";
        resultsStatusEl.textContent = "All answers in, starting consensus...";
      }
    } else if (doneCount >= activeServices.length) {
      // No consensus model — we're done
      resultsStatusEl.textContent = "All responses collected!";
      clearInterval(pollingInterval);
      pollingInterval = null;
    } else if (status === "followup_scraping") {
      resultsStatusEl.textContent = "Sending follow-up to models...";
    }
  }, 1500);
}

backBtn.addEventListener("click", async () => {
  resultsView.classList.add("hidden");
  askView.classList.remove("hidden");
  askBtn.disabled = false;
  statusEl.textContent = "";
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  followupSection.classList.add("hidden");
  await chrome.storage.local.remove([
    "askai_responses",
    "askai_services",
    "askai_consensus_model",
    "askai_consensus_sent",
    "askai_consensus_text",
    "askai_followup_questions",
    "askai_status",
    "askai_question",
    "askai_consensus",
    "askai_original_question",
  ]);
});

// On popup open, restore in-progress session
(async () => {
  questionEl.focus();

  const data = await chrome.storage.local.get([
    "askai_responses",
    "askai_services",
    "askai_consensus_model",
    "askai_consensus_text",
    "askai_followup_questions",
    "askai_status",
  ]);
  const responses = data.askai_responses;
  const svcs = data.askai_services;

  if (!svcs || svcs.length === 0) return;

  activeServices = svcs;
  askView.classList.add("hidden");
  resultsView.classList.remove("hidden");

  for (const key of ["chatgpt", "gemini", "claude"]) {
    const row = document.getElementById(`row-${key}`);
    const st = document.getElementById(`status-${key}`);
    const skipBtn = document.getElementById(`skip-${key}`);
    if (activeServices.includes(key)) {
      row.classList.remove("hidden");
      if (responses && responses[key]) {
        skipBtn.classList.add("hidden");
        if (responses[key].skipped) {
          st.textContent = "skipped";
          st.className = "progress-status skipped";
        } else {
          st.textContent = responses[key].error ? "error" : "done";
          st.className = `progress-status ${responses[key].error ? "error" : "done"}`;
        }
      } else {
        st.textContent = "scraping...";
        st.className = "progress-status working";
        skipBtn.classList.remove("hidden");
      }
    } else {
      row.classList.add("hidden");
      skipBtn.classList.add("hidden");
    }
  }

  const cm = data.askai_consensus_model;
  const consensusRow = document.getElementById("row-consensus");
  const consensusSt = document.getElementById("status-consensus");
  if (cm && cm !== "none") {
    consensusRow.classList.remove("hidden");
    if (data.askai_consensus_text) {
      consensusSt.textContent = "done";
      consensusSt.className = "progress-status done";
      consensusResultEl.classList.remove("hidden");
      consensusTextEl.textContent = data.askai_consensus_text;
      resultsStatusEl.textContent = "Complete!";
      renderFollowUps(data.askai_followup_questions);
      return; // no need to poll
    } else {
      consensusSt.textContent = "waiting...";
      consensusSt.className = "progress-status";
    }
  } else {
    consensusRow.classList.add("hidden");
  }

  // Check if everything already done (no consensus)
  const doneCount = responses
    ? activeServices.filter((k) => responses[k]).length
    : 0;
  if (doneCount >= activeServices.length && (!cm || cm === "none")) {
    resultsStatusEl.textContent = "All responses collected!";
    return;
  }

  resultsStatusEl.textContent = "Working in the background...";
  startPolling();
})();
