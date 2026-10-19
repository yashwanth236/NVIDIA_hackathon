(() => {
  if (globalThis.__accessMateContentLoaded) {
    return;
  }
  globalThis.__accessMateContentLoaded = true;

  const ids = new WeakMap();
  const elementsById = new Map();
  let nextId = 1;

  function visible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  function redact(text) {
    return text
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
      .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, "[redacted number]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
  }

  function labelFor(element) {
    const labels = element.labels
      ? Array.from(element.labels, (label) => label.innerText || label.textContent || "").join(" ")
      : "";
    const buttonValue =
      element instanceof HTMLInputElement && /^(button|submit|reset)$/i.test(element.type)
        ? element.value
        : "";
    return redact(
      element.getAttribute("aria-label") ||
        labels ||
        element.getAttribute("placeholder") ||
        element.getAttribute("title") ||
        element.innerText ||
        buttonValue ||
        element.getAttribute("name") ||
        ""
    );
  }

  function isSensitive(element, label) {
    const traits = [
      element.getAttribute("type"),
      element.getAttribute("name"),
      element.getAttribute("autocomplete"),
      element.getAttribute("placeholder"),
      label,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return /password|passwd|secret|token|one.?time|2fa|auth.?code|username|user.?name|login|credit|card|cvv|bank|routing|account.?number|ssn|social.?security|tax.?id|national.?id|passport|birth|email|phone|tel\b|address|postal|zip|postcode|first.?name|last.?name|\bname\b|amount/.test(
      traits
    );
  }

  function idFor(element) {
    let id = ids.get(element);
    if (!id) {
      id = `control-${nextId++}`;
      ids.set(element, id);
      elementsById.set(id, element);
    }
    return id;
  }

  function getPageSnapshot() {
    const selector =
      'a[href],button,input:not([type="hidden"]),textarea,[role="button"]';
    const controls = [];
    for (const element of document.querySelectorAll(selector)) {
      if (!visible(element) || element.disabled) {
        continue;
      }

      const label = labelFor(element);
      if (!label) {
        continue;
      }

      let externalOrigin = null;
      if (element instanceof HTMLAnchorElement) {
        try {
          const destination = new URL(element.href);
          if (
            (destination.protocol !== "http:" && destination.protocol !== "https:") ||
            destination.username ||
            destination.password
          ) {
            continue;
          }
          externalOrigin = destination.origin;
        } catch {
          continue;
        }
      }

      controls.push({
        id: idFor(element),
        role: element.getAttribute("role") || element.tagName.toLowerCase(),
        label,
        kind:
          element instanceof HTMLInputElement
            ? element.type.toLowerCase()
            : element.tagName.toLowerCase(),
        sensitive: isSensitive(element, label),
        external_origin: externalOrigin,
        opens_new_tab: element instanceof HTMLAnchorElement && element.target === "_blank",
        submits_form:
          Boolean(element.form) &&
          (element instanceof HTMLButtonElement && element.type === "submit" ||
            element instanceof HTMLInputElement && /^(submit|image)$/i.test(element.type)),
      });
      if (controls.length >= 100) {
        break;
      }
    }

    return {
      title: redact(document.title),
      origin: location.origin,
      elements: controls,
    };
  }

  function execute(message) {
    if (message.action === "scroll") {
      window.scrollBy({
        top: message.value === "down" ? Math.max(window.innerHeight * 0.7, 300) : -Math.max(window.innerHeight * 0.7, 300),
        behavior: "smooth",
      });
      return { ok: true, description: `Scrolled ${message.value}.` };
    }

    const element = elementsById.get(message.element_id);
    if (!element || !element.isConnected || !visible(element) || element.disabled) {
      return { ok: false, error: "That page control is no longer available. Request a fresh step." };
    }

    if (message.action === "click") {
      if (element instanceof HTMLAnchorElement && element.target === "_blank") {
        return { ok: false, error: "This link opens a new tab. Open it yourself, then start the agent on that tab." };
      }
      element.click();
      return { ok: true, description: `Clicked "${labelFor(element)}".` };
    }

    if (message.action === "type") {
      if (isSensitive(element, labelFor(element))) {
        return { ok: false, error: "This field may contain sensitive information. Fill it in yourself." };
      }
      if (
        !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) ||
        element instanceof HTMLInputElement && !/^(text|search|url|number)$/i.test(element.type)
      ) {
        return { ok: false, error: "AccessMate can only enter text into ordinary text fields." };
      }
      if (typeof message.value !== "string" || message.value.length > 500) {
        return { ok: false, error: "The proposed text is invalid or too long." };
      }

      const prototype = Object.getPrototypeOf(element);
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (valueSetter) {
        valueSetter.call(element, message.value);
      } else {
        element.value = message.value;
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, description: `Entered text in "${labelFor(element)}".` };
    }

    return { ok: false, error: "That action is not supported." };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "accessmate:snapshot") {
      sendResponse({ ok: true, page: getPageSnapshot() });
      return;
    }
    if (message?.type === "accessmate:execute") {
      sendResponse(execute(message));
    }
  });
})();
