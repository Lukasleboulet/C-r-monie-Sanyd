(() => {
  const RESSOURCE = "https://cfx-nui-external-iframe";
  if (!Array.from(location.ancestorOrigins || []).includes(RESSOURCE)) return;

  const post = (route, body) =>
    fetch("https://external-iframe/" + route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  const NOT_TEXT = ["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"];
  const isField = (el) =>
    !!el && (el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !NOT_TEXT.includes(el.type)));

  document.addEventListener("focusin", (e) => isField(e.target) && post("typing", { typing: true }));
  document.addEventListener("click", () => isField(document.activeElement) && post("typing", { typing: true }));
  document.addEventListener("focusout", (e) => isField(e.target) && post("typing", { typing: false }));

  const setValue = (el, v) => {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    set ? set.call(el, v) : (el.value = v);
  };
  const edit = (el, insert, start, end) => {
    try {
      el.setRangeText(insert, start, end, "end");
    } catch {
      setValue(el, insert ? el.value + insert : el.value.slice(0, -1));
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  window.addEventListener("message", (e) => {
    const data = e.data;
    if (!data || e.origin !== RESSOURCE) return;
    const el = document.activeElement;
    if (data.type === "externalIframeTypingEnd") {
      if (isField(el)) el.blur();
      return;
    }
    if (data.type !== "externalIframeKey") return;

    const { event, key, code, repeat, shiftKey, ctrlKey, altKey } = data;
    const init = { key, code, repeat, shiftKey, ctrlKey, altKey, bubbles: true, cancelable: true };
    const notCancelled = (el || document.body).dispatchEvent(new KeyboardEvent(event, init));
    if (event !== "keydown" || !notCancelled || !isField(el)) return;

    if (el.isContentEditable) {
      if (key.length === 1 && !ctrlKey) document.execCommand("insertText", false, key);
      else if (key === "Backspace") document.execCommand("delete");
      else if (key === "Enter") document.execCommand("insertParagraph");
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    if (key.length === 1 && !ctrlKey) edit(el, key, start, end);
    else if (key === "Backspace") edit(el, "", start === end ? Math.max(0, start - 1) : start, end);
    else if (key === "Delete") edit(el, "", start, start === end ? end + 1 : end);
    else if (key === "Enter") el.tagName === "TEXTAREA" ? edit(el, "\n", start, end) : el.form?.requestSubmit();
    else if (key === "ArrowLeft" || key === "ArrowRight") {
      const caret = Math.max(0, Math.min(el.value.length, start + (key === "ArrowLeft" ? -1 : 1)));
      try {
        el.setSelectionRange(caret, caret);
      } catch {}
    }
  });
})();
