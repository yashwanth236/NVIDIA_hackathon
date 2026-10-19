const API_BASE = "http://127.0.0.1:8000";
const MAX_STEPS = 12;
const goalInput = document.getElementById("goal");
const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");
const statusText = document.getElementById("status");
const siteLabel = document.getElementById("site-label");
const activity = document.getElementById("activity");
const approval = document.getElementById("approval");
const approvalTitle = document.getElementById("approval-title");
const approvalMessage = document.getElementById("approval-message");
const approveButton = document.getElementById("approve");
const rejectButton = document.getElementById("reject");

let activeTabId = null;
let selectedTab = null;
let activeGoal = "";
let running = false;
let pendingPlan = null;
let pendingKind = null;
let pendingTarget = null;
let history = [];

function updateButtons() {
  startButton.disabled =
    running || Boolean(pendingPlan) || !originPattern(selectedTab?.url || "");
  stopButton.disabled = !running;
}

function setStatus(message) {
  statusText.textContent = message;
}

function log(message) {
  const item = document.createElement("li");
  item.textContent = message;
  activity.prepend(item);
}

function showApproval(kind, plan, target) {
  pendingPlan = plan;
  pendingKind = kind;
  pendingTarget = target;
  approvalTitle.textContent =
    kind === "site"
      ? "Permission needed for another site"
      : "Review this consequential action";
  approvalMessage.textContent =
    kind === "site"
      ? `AccessMate wants to open ${target.external_origin} and read its visible controls.`
      : `${plan.reason} Proposed action: ${plan.action} ${
          target ? `"${target.label}"` : ""
        }${plan.action === "type" ? ` with "${plan.value}"` : ""}`;
  approval.classList.remove("hidden");
  approveButton.textContent = kind === "site" ? "Allow site and continue" : "Approve once";
  setStatus("Paused for your review.");
  updateButtons();
}

function hideApproval() {
  pendingPlan = null;
  pendingKind = null;
  pendingTarget = null;
  approval.classList.add("hidden");
  updateButtons();
}

function originPattern(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return `${parsed.origin}/*`;
  } catch {
    return null;
  }
}

async function grantSiteAccess(pattern) {
  return chrome.permissions.request({ origins: [pattern] });
}

async function sendToPage(message) {
  if (!activeTabId) {
    throw new Error("No active website tab is selected.");
  }
  try {
    return await chrome.tabs.sendMessage(activeTabId, message);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      files: ["content.js"],
    });
    return chrome.tabs.sendMessage(activeTabId, message);
  }
}

async function getSnapshot() {
  const response = await sendToPage({ type: "accessmate:snapshot" });
  if (!response?.ok || !response.page) {
    throw new Error("Could not read the visible controls on this page.");
  }
  return response.page;
}

async function requestPlan(page) {
  const response = await fetch(`${API_BASE}/api/agent/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      goal: activeGoal,
      page_title: page.title,
      page_origin: page.origin,
      elements: page.elements,
      history: history.slice(-8),
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || "The agent could not plan the next step.");
  }
  return data;
}

function findTarget(page, plan) {
  return page.elements.find((element) => element.id === plan.element_id) || null;
}

function isConsequential(plan, target) {
  if (plan.action !== "click") {
    return false;
  }
  if (target?.submits_form) {
    return true;
  }
  const words = `${target?.label || ""} ${plan.reason}`.toLowerCase();
  return /\b(log ?in|log ?out|sign ?in|sign ?up|authenticate|authentication|authorize|credential|password|2fa|mfa|security|account|payment|bank|submit|send|share|delete|remove|cancel|transfer|approve|confirm|purchase|buy|pay|checkout|save|update|apply|place order|subscribe|unsubscribe|publish|install|download|permission|allow access|grant|revoke|withdraw|refund|wallet|crypto|close account)\b/.test(
    words
  );
}

async function execute(plan) {
  const response = await sendToPage({
    type: "accessmate:execute",
    action: plan.action,
    element_id: plan.element_id,
    value: plan.value,
  });
  if (!response?.ok) {
    throw new Error(response?.error || "The page did not complete the proposed action.");
  }
  log(response.description || plan.reason);
  history.push(`${plan.action}: ${plan.reason}`);
}

function pauseForApproval(kind, plan, target) {
  running = false;
  showApproval(kind, plan, target);
}

async function runLoop() {
  running = true;
  hideApproval();
  updateButtons();
  try {
    for (let step = 0; step < MAX_STEPS && running; step += 1) {
      setStatus(`Planning step ${step + 1} of ${MAX_STEPS}...`);
      const page = await getSnapshot();
      if (!running) {
        break;
      }
      siteLabel.textContent = `${page.title || "Website"} - ${page.origin}`;
      const plan = await requestPlan(page);
      if (!running) {
        break;
      }
      const target = findTarget(page, plan);

      if (plan.action === "done") {
        running = false;
        setStatus(plan.reason || "Task complete.");
        log(plan.reason || "Task complete.");
        break;
      }
      if (plan.action === "ask_user") {
        running = false;
        setStatus(plan.reason);
        log(`Paused: ${plan.reason}`);
        break;
      }
      if (plan.action === "click" && !target) {
        throw new Error("The plan refers to a control that is not on this page.");
      }
      if (plan.action === "type" && target?.sensitive) {
        running = false;
        setStatus(`Fill "${target.label}" yourself, then start the agent again.`);
        log("Sensitive fields are never filled by the agent.");
        break;
      }

      const destinationPattern =
        plan.action === "click" && target?.external_origin
          ? `${target.external_origin}/*`
          : null;
      if (
        destinationPattern &&
        !(await chrome.permissions.contains({ origins: [destinationPattern] }))
      ) {
        pauseForApproval("site", plan, target);
        break;
      }
      if (!running) {
        break;
      }
      if (isConsequential(plan, target)) {
        pauseForApproval("action", plan, target);
        break;
      }

      await execute(plan);
      await new Promise((resolve) => setTimeout(resolve, 650));
    }
    if (running) {
      running = false;
      setStatus(`Paused after ${MAX_STEPS} steps. Review the page, then start again if needed.`);
    }
  } catch (error) {
    running = false;
    setStatus(error.message || "The agent stopped because of an unexpected error.");
    log(`Stopped: ${error.message || "Unexpected error."}`);
  } finally {
    updateButtons();
  }
}

startButton.addEventListener("click", async () => {
  if (running || pendingPlan) {
    return;
  }
  const goal = goalInput.value.trim();
  if (!goal) {
    setStatus("Enter a goal before starting.");
    return;
  }

  try {
    const tab = selectedTab;
    const pattern = originPattern(tab?.url || "");
    if (!tab?.id || !pattern) {
      throw new Error("Select an ordinary website tab before starting the agent.");
    }
    const origin = new URL(tab.url).origin;
    setStatus(`Requesting access to ${origin}...`);
    running = true;
    updateButtons();
    const permissionRequest = grantSiteAccess(pattern);
    if (!(await permissionRequest)) {
      running = false;
      updateButtons();
      setStatus("Site access was not granted.");
      return;
    }
    activeTabId = tab.id;
    activeGoal = goal;
    history = [];
    setStatus("Starting the agent…");
    await runLoop();
  } catch (error) {
    running = false;
    updateButtons();
    setStatus(error.message || "The agent could not start.");
  }
});

stopButton.addEventListener("click", () => {
  running = false;
  hideApproval();
  updateButtons();
  setStatus("Stopped.");
});

approveButton.addEventListener("click", async () => {
  const plan = pendingPlan;
  const kind = pendingKind;
  const target = pendingTarget;
  if (!plan || !kind) {
    return;
  }

  try {
    if (kind === "site") {
      const destinationPattern = `${target?.external_origin || ""}/*`;
      const permissionRequest = grantSiteAccess(destinationPattern);
      if (!(await permissionRequest)) {
        hideApproval();
        updateButtons();
        setStatus("Site access was not granted; the action was not taken.");
        return;
      }
      if (isConsequential(plan, target)) {
        showApproval("action", plan, target);
        return;
      }
    } else if (isConsequential(plan, target)) {
      log("You approved this action once.");
    }
    hideApproval();
    running = true;
    updateButtons();
    await execute(plan);
    await new Promise((resolve) => setTimeout(resolve, 650));
    await runLoop();
  } catch (error) {
    hideApproval();
    running = false;
    updateButtons();
    setStatus(error.message || "The approved action could not be completed.");
  }
});

rejectButton.addEventListener("click", () => {
  hideApproval();
  running = false;
  updateButtons();
  setStatus("Action rejected. Nothing was done.");
  log("You rejected the proposed action.");
});

async function refreshSelectedTab(tabId) {
  try {
    selectedTab = await chrome.tabs.get(tabId);
    const origin = originPattern(selectedTab.url || "")
      ? new URL(selectedTab.url).origin
      : "This tab cannot be controlled.";
    siteLabel.textContent = selectedTab.url
      ? `${selectedTab.title || "Website"} - ${origin}`
      : origin;
    updateButtons();
  } catch (error) {
    selectedTab = null;
    siteLabel.textContent = `Could not read the active tab: ${error.message}`;
    updateButtons();
  }
}

chrome.tabs
  .query({ active: true, lastFocusedWindow: true })
  .then(([tab]) => {
    if (tab?.id) {
      return refreshSelectedTab(tab.id);
    }
    siteLabel.textContent = "Choose a website tab to begin.";
    updateButtons();
  })
  .catch((error) => {
    siteLabel.textContent = `Could not read the active tab: ${error.message}`;
    updateButtons();
  });

chrome.tabs.onActivated.addListener(({ tabId }) => {
  refreshSelectedTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (selectedTab?.id === tabId) {
    selectedTab = { ...selectedTab, ...tab };
    const origin = originPattern(selectedTab.url || "")
      ? new URL(selectedTab.url).origin
      : "This tab cannot be controlled.";
    siteLabel.textContent = selectedTab.url
      ? `${selectedTab.title || "Website"} - ${origin}`
      : origin;
    updateButtons();
  }
  if (tabId === activeTabId && changeInfo.status === "complete" && tab.url) {
    const pattern = originPattern(tab.url);
    if (pattern) {
      chrome.permissions
        .contains({ origins: [pattern] })
        .then((allowed) => {
          if (!allowed && running) {
            running = false;
            setStatus("The page changed to a site that has not been approved yet.");
          }
        })
        .catch((error) => {
          running = false;
          setStatus(`Could not verify site access: ${error.message}`);
        });
    }
  }
});
