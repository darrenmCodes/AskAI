// Background service worker
// Opens each service in its own window. Keeps windows alive for follow-ups.
// Consensus model also runs in a background window.
// Stores consensus text + follow-up questions for the popup.

const SERVICE_URLS = {
  chatgpt: "https://chatgpt.com/",
  gemini: "https://gemini.google.com/app",
  claude: "https://claude.ai/new",
};

const SERVICE_LABELS = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  claude: "Claude",
};

const ALLOWED_ORIGINS = [
  "https://chatgpt.com",
  "https://chat.openai.com",
  "https://gemini.google.com",
  "https://claude.ai",
];

// Runtime state — these are re-initialized on every service worker restart,
// so they must be persisted to chrome.storage and restored on each wake-up.
const serviceTabs = {};
const serviceWindows = {};
let consensusTabId = null;
let consensusWindowId = null;
let activeServices = [];
let pendingFollowUpResponses = {};
let followUpCount = 0;
let currentFollowUpQuestion = "";

async function saveState() {
  await chrome.storage.local.set({
    askai_sw_state: {
      serviceTabs: { ...serviceTabs },
      serviceWindows: { ...serviceWindows },
      consensusTabId,
      consensusWindowId,
      activeServices: [...activeServices],
      pendingFollowUpResponses: { ...pendingFollowUpResponses },
      followUpCount,
      currentFollowUpQuestion,
    },
  });
}

async function loadState() {
  const result = await chrome.storage.local.get("askai_sw_state");
  const s = result.askai_sw_state;
  if (!s) return;
  for (const k of Object.keys(serviceTabs)) delete serviceTabs[k];
  Object.assign(serviceTabs, s.serviceTabs || {});
  for (const k of Object.keys(serviceWindows)) delete serviceWindows[k];
  Object.assign(serviceWindows, s.serviceWindows || {});
  consensusTabId = s.consensusTabId ?? null;
  consensusWindowId = s.consensusWindowId ?? null;
  activeServices = s.activeServices || [];
  for (const k of Object.keys(pendingFollowUpResponses)) delete pendingFollowUpResponses[k];
  Object.assign(pendingFollowUpResponses, s.pendingFollowUpResponses || {});
  followUpCount = s.followUpCount || 0;
  currentFollowUpQuestion = s.currentFollowUpQuestion || "";
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Validate origin for messages arriving from content scripts
  if (sender.tab) {
    const allowed = ALLOWED_ORIGINS.some((o) => sender.url?.startsWith(o));
    if (!allowed) return;
  }

  (async () => {
    await loadState();

    if (message.type === "ASKAI_START") {
      await startScraping(message.question, message.services, message.consensusModel);
    } else if (message.type === "ASKAI_RESPONSE") {
      await handleResponse(message.service, message.text, message.error, sender);
    } else if (message.type === "ASKAI_CONSENSUS_RESPONSE") {
      await handleConsensusResponse(message.text, message.error);
    } else if (message.type === "ASKAI_FOLLOWUP") {
      await handleFollowUp(message.question);
    } else if (message.type === "ASKAI_FOLLOWUP_RESPONSE") {
      await handleFollowUpResponse(message.service, message.text, message.error);
    } else if (message.type === "ASKAI_FOLLOWUP_CONSENSUS_RESPONSE") {
      await handleFollowUpConsensusResponse(message.text, message.error);
    } else if (message.type === "ASKAI_SKIP") {
      await handleSkip(message.service);
    } else if (message.type === "ASKAI_CLEANUP") {
      cleanup();
      await saveState();
    }

    sendResponse({ ok: true });
  })();

  return true;
});

async function startScraping(question, services, consensusModel) {
  // Clean up any previous session
  cleanup();
  activeServices = services;

  await chrome.storage.local.set({
    askai_question: question,
    askai_original_question: question,
    askai_responses: {},
    askai_services: services,
    askai_consensus_model: consensusModel,
    askai_consensus_sent: false,
    askai_consensus_text: null,
    askai_consensus: false,
    askai_followup_questions: [],
    askai_status: "scraping",
  });

  // Open each service in its own window
  for (const key of services) {
    const win = await chrome.windows.create({
      url: SERVICE_URLS[key],
      focused: false,
      width: 800,
      height: 600,
    });
    serviceWindows[key] = win.id;
    serviceTabs[key] = win.tabs[0].id;
  }

  await saveState();
}

async function handleResponse(service, text, error, sender) {
  // Update the tab ID in case it changed
  if (sender && sender.tab) {
    serviceTabs[service] = sender.tab.id;
  }

  const data = await chrome.storage.local.get([
    "askai_responses",
    "askai_services",
    "askai_consensus_model",
    "askai_consensus_sent",
    "askai_question",
  ]);

  const responses = data.askai_responses || {};
  responses[service] = { text: text || null, error: error || null };
  await chrome.storage.local.set({ askai_responses: responses });

  const svcs = data.askai_services || [];
  const allDone = svcs.every((key) => responses[key]);
  if (!allDone) {
    await saveState();
    return;
  }

  const consensusModel = data.askai_consensus_model;
  if (!consensusModel || consensusModel === "none" || data.askai_consensus_sent) {
    await chrome.storage.local.set({ askai_status: "done" });
    await saveState();
    return;
  }

  // Build consensus prompt
  const originalQuestion = data.askai_question;
  let prompt = buildConsensusPrompt(originalQuestion, svcs, responses);

  await chrome.storage.local.set({
    askai_question: prompt,
    askai_consensus: true,
    askai_consensus_sent: true,
    askai_status: "consensus",
  });

  const win = await chrome.windows.create({
    url: SERVICE_URLS[consensusModel],
    focused: false,
    width: 800,
    height: 600,
  });
  consensusWindowId = win.id;
  consensusTabId = win.tabs[0].id;
  await saveState();
}

async function handleSkip(service) {
  // Close the service window
  if (serviceWindows[service]) {
    try { chrome.windows.remove(serviceWindows[service]); } catch (e) {}
    delete serviceWindows[service];
    delete serviceTabs[service];
  }

  // Mark as skipped in storage
  const data = await chrome.storage.local.get([
    "askai_responses",
    "askai_services",
    "askai_consensus_model",
    "askai_consensus_sent",
    "askai_question",
  ]);

  const responses = data.askai_responses || {};
  responses[service] = { text: null, error: null, skipped: true };
  await chrome.storage.local.set({ askai_responses: responses });

  // Check if all services are now done
  const svcs = data.askai_services || [];
  const allDone = svcs.every((key) => responses[key]);
  if (!allDone) {
    await saveState();
    return;
  }

  const consensusModel = data.askai_consensus_model;
  if (!consensusModel || consensusModel === "none" || data.askai_consensus_sent) {
    await chrome.storage.local.set({ askai_status: "done" });
    await saveState();
    return;
  }

  // Build consensus prompt (buildConsensusPrompt already skips entries without text)
  const originalQuestion = data.askai_question;
  let prompt = buildConsensusPrompt(originalQuestion, svcs, responses);

  await chrome.storage.local.set({
    askai_question: prompt,
    askai_consensus: true,
    askai_consensus_sent: true,
    askai_status: "consensus",
  });

  const win = await chrome.windows.create({
    url: SERVICE_URLS[consensusModel],
    focused: false,
    width: 800,
    height: 600,
  });
  consensusWindowId = win.id;
  consensusTabId = win.tabs[0].id;
  await saveState();
}

async function handleConsensusResponse(text, error) {
  const consensusText = error
    ? `Error: ${error}`
    : (text || "Could not capture consensus.");

  const followUps = parseFollowUpQuestions(consensusText);

  await chrome.storage.local.set({
    askai_consensus_text: consensusText,
    askai_followup_questions: followUps,
    askai_status: "done",
  });
}

// --- Follow-up handling ---

async function handleFollowUp(question) {
  followUpCount++;
  pendingFollowUpResponses = {};
  currentFollowUpQuestion = question;

  // Get current responses to preserve skipped services
  const storageData = await chrome.storage.local.get("askai_responses");
  const oldResponses = storageData.askai_responses || {};

  // Reset non-skipped responses so UI shows "scraping..." again
  const resetResponses = {};
  for (const key of activeServices) {
    if (oldResponses[key]?.skipped) {
      resetResponses[key] = oldResponses[key]; // keep skipped
      pendingFollowUpResponses[key] = oldResponses[key]; // already "done"
    }
  }

  await chrome.storage.local.set({
    askai_responses: resetResponses,
    askai_consensus_text: null,
    askai_followup_questions: [],
    askai_status: "followup_scraping",
  });

  await saveState();

  // Send follow-up to each active (non-skipped) service tab
  for (const key of activeServices) {
    if (pendingFollowUpResponses[key]) continue; // skip already-resolved (skipped) services
    const tabId = serviceTabs[key];
    if (tabId) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: "SUBMIT_FOLLOWUP",
          question: question,
          service: key,
        });
      } catch (e) {
        // Tab might be dead — record error
        handleFollowUpResponse(key, null, "Tab unavailable: " + e.message);
      }
    } else {
      handleFollowUpResponse(key, null, "No tab available");
    }
  }
}

async function handleFollowUpResponse(service, text, error) {
  pendingFollowUpResponses[service] = { text: text || null, error: error || null };

  // Update storage so popup can show progress
  const data = await chrome.storage.local.get("askai_responses");
  const responses = data.askai_responses || {};
  responses[service] = { text: text || null, error: error || null };
  await chrome.storage.local.set({ askai_responses: responses });

  const allDone = activeServices.every((key) => pendingFollowUpResponses[key]);
  if (!allDone) {
    await saveState();
    return;
  }

  // All follow-up responses in — send to consensus
  const storageData = await chrome.storage.local.get([
    "askai_consensus_model",
    "askai_original_question",
  ]);
  const consensusModel = storageData.askai_consensus_model;

  if (!consensusModel || consensusModel === "none") {
    await chrome.storage.local.set({ askai_status: "done" });
    await saveState();
    return;
  }

  // Build follow-up consensus prompt
  let prompt = `Follow-up question: "${currentFollowUpQuestion}"\n\nResponses:\n\n`;

  for (const key of activeServices) {
    if (pendingFollowUpResponses[key]?.text) {
      prompt += `--- ${SERVICE_LABELS[key]} ---\n${pendingFollowUpResponses[key].text}\n\n`;
    }
  }

  prompt += CONSENSUS_INSTRUCTION;

  await chrome.storage.local.set({ askai_status: "followup_consensus" });

  // Send follow-up to existing consensus tab
  if (consensusTabId) {
    try {
      await chrome.tabs.sendMessage(consensusTabId, {
        type: "SUBMIT_FOLLOWUP",
        question: prompt,
        isConsensus: true,
      });
    } catch (e) {
      handleFollowUpConsensusResponse(null, "Consensus tab unavailable: " + e.message);
    }
  }

  await saveState();
}

async function handleFollowUpConsensusResponse(text, error) {
  const consensusText = error
    ? `Error: ${error}`
    : (text || "Could not capture consensus.");

  const followUps = parseFollowUpQuestions(consensusText);

  await chrome.storage.local.set({
    askai_consensus_text: consensusText,
    askai_followup_questions: followUps,
    askai_status: "done",
  });
}

// --- Helpers ---

function buildConsensusPrompt(originalQuestion, services, responses) {
  let prompt = `Question: "${originalQuestion}"\n\nResponses:\n\n`;

  for (const key of services) {
    if (responses[key]?.text) {
      prompt += `--- ${SERVICE_LABELS[key]} ---\n${responses[key].text}\n\n`;
    }
  }

  prompt += CONSENSUS_INSTRUCTION;

  return prompt;
}

const CONSENSUS_INSTRUCTION = `Give a direct, concise consensus. No preamble, no filler, no meta-commentary. Use this exact structure:

AGREES: What all responses agree on.
DISAGREES: Where they differ (skip if none).
ANSWER: The synthesized final answer.

You MUST end your response with exactly 3 follow-up questions the user could ask next. Format them exactly like this:

FOLLOW-UP QUESTIONS:
1. Your first suggested question here
2. Your second suggested question here
3. Your third suggested question here`;

function parseFollowUpQuestions(text) {
  if (!text) return [];
  const lines = text.split("\n");
  const questions = [];
  let inFollowUpBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Detect heading that signals follow-up questions
    if (/follow.?up/i.test(trimmed) && trimmed.length < 100) {
      inFollowUpBlock = true;
      continue;
    }

    // Once in the follow-up block, grab anything that looks like a question line:
    // numbered (1. ... / 1) ...), bulleted (- ... / * ...), or plain text
    if (inFollowUpBlock) {
      // Strip leading numbers, bullets, brackets: "1. ", "1) ", "- ", "* ", "[question]"
      let q = trimmed
        .replace(/^[\d]+[.)]\s*/, "")
        .replace(/^[-*]\s+/, "")
        .replace(/^\[/, "").replace(/\]$/, "")
        .replace(/\*{1,2}/g, "")
        .trim();
      if (q && q.length > 10) questions.push(q);
      continue;
    }

    // Also match explicit Q: prefix anywhere (with optional bold/numbering)
    const qMatch = trimmed.match(/^[\d.*\-)\s]*\*{0,2}Q\d{0,2}[:.]\*{0,2}\s*(.+)/i);
    if (qMatch) {
      const q = qMatch[1].replace(/\*{1,2}/g, "").trim();
      if (q && q.length > 10) questions.push(q);
    }
  }

  return questions.slice(0, 3);
}

function cleanup() {
  for (const [key, wid] of Object.entries(serviceWindows)) {
    try { chrome.windows.remove(wid); } catch (e) {}
    delete serviceWindows[key];
    delete serviceTabs[key];
  }
  if (consensusWindowId) {
    try { chrome.windows.remove(consensusWindowId); } catch (e) {}
    consensusWindowId = null;
    consensusTabId = null;
  }
  pendingFollowUpResponses = {};
}
