/**
 * Generic tool handlers for the Ozwell chatbot widget.
 * Handles get_page_contents and set_page_contents tool calls
 * via the ozwell-tool-call DOM event.
 */
(function () {
  'use strict';

  /**
   * Find the label text for a form element.
   */
  function getFieldLabel(el) {
    // Explicit <label for="...">
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent.trim();
    }
    // Wrapping <label>
    const parent = el.closest('label');
    if (parent) {
      const clone = parent.cloneNode(true);
      // Remove the input itself to get only label text
      const inputs = clone.querySelectorAll('input, select, textarea');
      inputs.forEach(function (i) { i.remove(); });
      const text = clone.textContent.trim();
      if (text) return text;
    }
    // ARIA
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    // Placeholder as last resort
    if (el.placeholder) return el.placeholder;
    return el.name || el.id || '';
  }

  /**
   * Get select element options as an array.
   */
  function getSelectOptions(el) {
    return Array.from(el.options).map(function (opt) {
      return { value: opt.value, text: opt.textContent.trim(), selected: opt.selected };
    });
  }

  var MAX_TEXT_LENGTH = 8000;

  /**
   * Get the main content element.
   */
  function getMainEl() {
    return document.querySelector('main')
      || document.querySelector('[role="main"]')
      || document.querySelector('.container');
  }

  /**
   * Extract the visible text from <main>, with light filtering.
   * Strips SQL queries and collapses excessive whitespace.
   */
  function getVisibleText() {
    var mainEl = getMainEl();
    if (!mainEl) return '';
    var text = mainEl.innerText || '';
    // Filter out verbose Sequelize SQL queries
    text = text.replace(/Executing \(default\):.*$/gm, '');
    // Collapse runs of 3+ blank lines into 2
    text = text.replace(/\n{3,}/g, '\n\n');
    // Trim and cap length
    text = text.trim();
    if (text.length > MAX_TEXT_LENGTH) {
      text = text.substring(0, MAX_TEXT_LENGTH) + '\n...(truncated)';
    }
    return text;
  }

  /**
   * Scrape page content: structured form fields + raw visible text.
   * Form fields are structured (name, type, value, options) because the
   * LLM needs machine-readable identifiers to call set_page_contents.
   * Everything else (tables, headings, logs, metadata) is sent as raw
   * text — the LLM parses it directly.
   */
  function getPageContents() {
    var pageTitle = document.title || '';
    var mainEl = getMainEl();

    // Structured form fields — LLM needs name/id/type to call set_page_contents
    var fields = [];
    var seen = new Set();
    var elements = mainEl
      ? mainEl.querySelectorAll('input, select, textarea')
      : document.querySelectorAll('input, select, textarea');

    elements.forEach(function (el) {
      if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return;
      var key = el.name || el.id;
      if (!key || seen.has(key)) return;
      seen.add(key);

      var field = {
        name: el.name || '',
        id: el.id || '',
        type: el.tagName === 'SELECT' ? 'select' : (el.type || 'text'),
        label: getFieldLabel(el),
        value: el.type === 'checkbox' ? el.checked : el.value,
        required: el.required || false,
        disabled: el.disabled || false
      };

      if (el.tagName === 'SELECT') {
        field.options = getSelectOptions(el);
      }

      fields.push(field);
    });

    var result = {
      title: pageTitle,
      url: window.location.pathname,
      fields: fields,
      pageText: getVisibleText()
    };

    return result;
  }

  /**
   * Find a form element by name, id, label text, or fuzzy word matching.
   * Tolerates LLM-guessed names like "container_name" for a field named "hostname"
   * with label "Container Hostname" by scoring word overlap.
   */
  function findField(identifier) {
    // 1. Exact name match
    var el = document.querySelector('[name="' + CSS.escape(identifier) + '"]');
    if (el) return el;
    // 2. Exact id match
    el = document.getElementById(identifier);
    if (el) return el;

    var lower = identifier.toLowerCase();

    // 3. Label text contains the full identifier
    var labels = document.querySelectorAll('label');
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].textContent.trim().toLowerCase().includes(lower)) {
        var forId = labels[i].getAttribute('for');
        if (forId) return document.getElementById(forId);
        var input = labels[i].querySelector('input, select, textarea');
        if (input) return input;
      }
    }

    // 4. Word-level fuzzy match — split identifier into words and score each field
    var words = lower.replace(/[_\-\s]+/g, ' ').split(' ').filter(Boolean);
    if (words.length > 0) {
      var allFields = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]), select, textarea');
      var bestMatch = null;
      var bestScore = 0;

      allFields.forEach(function (field) {
        var fieldText = [
          field.name || '',
          field.id || '',
          getFieldLabel(field),
          field.placeholder || ''
        ].join(' ').toLowerCase();

        var score = 0;
        words.forEach(function (w) { if (fieldText.includes(w)) score++; });

        if (score > bestScore) {
          bestScore = score;
          bestMatch = field;
        }
      });

      if (bestMatch && bestScore >= 1) return bestMatch;
    }

    return null;
  }

  /**
   * Set a form field's value and fire change events.
   * For selects, also tries case-insensitive partial matching.
   * Returns { ok: true } or { ok: false, options: [...] } for selects.
   */
  function setFieldValue(el, value) {
    if (el.type === 'checkbox') {
      el.checked = value === true || value === 'true';
    } else if (el.tagName === 'SELECT') {
      var strVal = String(value);
      var lower = strVal.toLowerCase();
      // Try exact value match, exact text match, then partial text match
      for (var i = 0; i < el.options.length; i++) {
        if (el.options[i].value === strVal) {
          el.value = el.options[i].value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true };
        }
      }
      for (var j = 0; j < el.options.length; j++) {
        var optText = el.options[j].textContent.trim().toLowerCase();
        if (optText === lower || optText.includes(lower)) {
          el.value = el.options[j].value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true };
        }
      }
      // Return available options so the LLM can self-correct
      var opts = Array.from(el.options)
        .filter(function (o) { return o.value; })
        .map(function (o) { return o.textContent.trim(); });
      return { ok: false, options: opts };
    } else {
      el.value = String(value);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  }

  /**
   * Build a concise text summary of available fields for LLM context.
   */
  function fieldSummary() {
    var pageData = getPageContents();
    return pageData.fields.map(function (f) {
      var desc = f.name + ' (' + f.type;
      if (f.required) desc += ', required';
      if (f.options) {
        var optNames = f.options
          .filter(function (o) { return o.value; })
          .map(function (o) { return '"' + o.text + '"'; });
        desc += ', options: ' + optNames.join(' | ');
      }
      if (f.value) desc += ', current: "' + f.value + '"';
      desc += ')';
      return desc;
    }).join('; ');
  }

  /**
   * Update multiple form fields.
   * If args.submit is true, submits the form after setting fields (atomic fill+submit).
   * Returns a concise summary of available fields so the LLM
   * can self-correct without needing a separate get_page_contents call.
   */
  function setPageContents(args) {
    var shouldSubmit = args.submit === true || args.submit === 'true';

    // Resilient: accept either {fields: {...}} or flat {name: value, ...}
    var fieldsMap = args.fields || {};
    if (Object.keys(fieldsMap).length === 0) {
      fieldsMap = {};
      Object.keys(args).forEach(function (k) {
        if (k !== 'fields' && k !== 'submit') fieldsMap[k] = args[k];
      });
    }
    var updated = [];
    var notFound = [];

    Object.keys(fieldsMap).forEach(function (key) {
      var el = findField(key);
      if (!el) {
        notFound.push(key + ' (no such field)');
        return;
      }
      if (el.disabled) {
        notFound.push(key + ' (disabled)');
        return;
      }

      // Auto-select "Custom Docker Image..." when customTemplate is being set
      if (el.name === 'customTemplate' && fieldsMap[key]) {
        var templateSel = document.querySelector('[name="template"]');
        if (templateSel && templateSel.value !== 'custom') {
          setFieldValue(templateSel, 'custom');
        }
      }

      var result = setFieldValue(el, fieldsMap[key]);
      if (result.ok) {
        updated.push(key);
      } else if (result.options) {
        notFound.push(key + ' (value "' + fieldsMap[key] + '" not valid, options: ' + result.options.join(', ') + ')');
      } else {
        notFound.push(key + ' (could not set)');
      }
    });

    var response = {
      success: updated.length > 0 && notFound.length === 0,
      updated: updated,
      notFound: notFound,
      availableFields: fieldSummary()
    };

    if (updated.length === 0 && Object.keys(fieldsMap).length > 0) {
      response.error = 'No fields were updated. Use get_page_contents first to see available fields and actions.';
    }

    if (shouldSubmit) {
      // Validate: check for unfilled required fields or unselected dropdowns
      var emptyRequired = [];
      var form = document.querySelector('main form')
        || document.querySelector('[role="main"] form')
        || document.querySelector('.container form');
      if (form) {
        form.querySelectorAll('input, select, textarea').forEach(function (el) {
          if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.disabled) return;
          var key = el.name || el.id;
          if (!key) return;
          if (el.required && !el.value) {
            emptyRequired.push(key + ' (' + getFieldLabel(el) + ')');
          }
          if (el.tagName === 'SELECT' && el.selectedIndex === 0 && el.options[0] && !el.options[0].value) {
            emptyRequired.push(key + ' (' + getFieldLabel(el) + ', no option selected)');
          }
        });
      }

      if (notFound.length > 0) {
        response.submitted = false;
        response.submitError = 'Cannot submit: some fields failed to set';
      } else if (emptyRequired.length > 0) {
        response.submitted = false;
        response.submitError = 'Cannot submit, these required fields are still empty: ' + emptyRequired.join(', ');
      } else {
        var submitResult = submitForm();
        response.submitted = submitResult.success;
        if (!submitResult.success) response.submitError = submitResult.error;
      }
    }

    return response;
  }

  /**
   * Submit the form on the current page.
   * Validates that required fields are filled before submitting.
   */
  function submitForm() {
    var form = document.querySelector('main form')
      || document.querySelector('[role="main"] form')
      || document.querySelector('.container form');
    if (!form) {
      return { success: false, error: 'No form found in the main content area' };
    }

    // Validate required fields before submitting
    var emptyRequired = [];
    form.querySelectorAll('input, select, textarea').forEach(function (el) {
      if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.disabled) return;
      var key = el.name || el.id;
      if (!key) return;
      if (el.required && !el.value) {
        emptyRequired.push(key + ' (' + getFieldLabel(el) + ')');
      } else if (el.tagName === 'SELECT' && el.selectedIndex === 0 && el.options[0] && !el.options[0].value) {
        emptyRequired.push(key + ' (' + getFieldLabel(el) + ', no option selected)');
      }
    });
    if (emptyRequired.length > 0) {
      return {
        success: false,
        error: 'Cannot submit, these required fields are still empty: ' + emptyRequired.join(', '),
        availableFields: fieldSummary()
      };
    }

    var submitBtn = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
    if (submitBtn) {
      submitBtn.click();
    } else {
      form.requestSubmit();
    }

    return { success: true, message: 'Form submitted' };
  }

  /**
   * Click a button or link on the page by its visible text.
   * Tries: exact text, partial text, aria-label, href, then word-level fuzzy.
   */
  function clickElement(args) {
    // Resilient: accept text, name, label, button, or first string value
    var text = (args.text || args.name || args.label || args.button || '').trim();
    if (!text) {
      var keys = Object.keys(args);
      for (var k = 0; k < keys.length; k++) {
        if (typeof args[keys[k]] === 'string' && args[keys[k]].trim()) {
          text = args[keys[k]].trim();
          break;
        }
      }
    }
    if (!text) return { success: false, error: 'No text provided' };

    var lower = text.toLowerCase();
    var mainEl = getMainEl();
    var candidates = (mainEl || document).querySelectorAll('a, button, [role="button"]');

    // Pass 1: Exact or partial text match (bidirectional)
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      var elText = el.textContent.trim().toLowerCase();
      if (elText === lower || elText.includes(lower) || lower.includes(elText)) {
        el.click();
        return { success: true, message: 'Clicked: ' + el.textContent.trim() };
      }
    }

    // Pass 2: aria-label match
    for (var j = 0; j < candidates.length; j++) {
      var ariaLabel = (candidates[j].getAttribute('aria-label') || '').toLowerCase();
      if (ariaLabel && (ariaLabel.includes(lower) || lower.includes(ariaLabel))) {
        candidates[j].click();
        return { success: true, message: 'Clicked: ' + candidates[j].textContent.trim() };
      }
    }

    // Pass 3: If input looks like a URL path, find a link with that href
    if (text.startsWith('/')) {
      for (var u = 0; u < candidates.length; u++) {
        var href = candidates[u].getAttribute('href') || '';
        if (href === text || href.endsWith(text)) {
          candidates[u].click();
          return { success: true, message: 'Clicked: ' + candidates[u].textContent.trim() };
        }
      }
    }

    // Pass 4: Word-level fuzzy match (e.g. "New..." matches "New Site")
    var words = lower.replace(/[_\-\.…]+/g, ' ').split(/\s+/).filter(Boolean);
    if (words.length > 0) {
      var bestMatch = null;
      var bestScore = 0;
      for (var f = 0; f < candidates.length; f++) {
        if (candidates[f].disabled) continue;
        var fieldText = (candidates[f].textContent.trim() + ' ' +
          (candidates[f].getAttribute('aria-label') || '')).toLowerCase();
        var score = 0;
        words.forEach(function (w) { if (fieldText.includes(w)) score++; });
        if (score > bestScore) {
          bestScore = score;
          bestMatch = candidates[f];
        }
      }
      if (bestMatch && bestScore >= 1) {
        bestMatch.click();
        return { success: true, message: 'Clicked: ' + bestMatch.textContent.trim() };
      }
    }

    // Collect available actions for error feedback
    var available = [];
    for (var a = 0; a < candidates.length; a++) {
      var t = candidates[a].textContent.trim();
      if (t && t.length < 80 && !candidates[a].disabled) available.push(t);
    }
    return {
      success: false,
      error: 'No clickable element found with text: ' + text,
      availableActions: available
    };
  }

  // --- Event listener for Ozwell tool calls ---
  document.addEventListener('ozwell-tool-call', function (e) {
    var detail = e.detail;
    var name = detail.name;
    var args = detail.arguments || {};
    var respond = detail.respond;
    var error = detail.error;

    try {
      if (name === 'get_page_contents') {
        respond(getPageContents());
      } else if (name === 'set_page_contents') {
        respond(setPageContents(args));
      } else if (name === 'submit_form') {
        respond(submitForm());
      } else if (name === 'click_element') {
        respond(clickElement(args));
      } else {
        error('Unknown tool: ' + name);
      }
    } catch (err) {
      error('Tool execution failed: ' + err.message);
    }
  });
})();
