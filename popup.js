const $ = (id) => document.getElementById(id);
const DEFAULTS = { enabled: true, threshold: 3, disabledSites: [] };

(async () => {
  const s = await browser.storage.local.get(DEFAULTS);
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

  let state = null;
  try {
    state = await browser.tabs.sendMessage(tab.id, { type: "getState" });
  } catch (e) {
    $("status").textContent = "Not available on this page.";
  }

  $("enabled").checked = s.enabled;
  $("threshold").value = String(s.threshold);
  if (!$("threshold").value) $("threshold").value = "3";

  if (state) {
    $("count").textContent = state.count;
    $("countLabel").textContent = state.count === 1 ? "paragraph collapsed" : "paragraphs collapsed";
    $("host").textContent = state.hostname;
    $("siteDisabled").checked = s.disabledSites.includes(state.hostname);
    if (!state.active) $("status").textContent = "Inactive on this page.";
    else if (state.page && state.page.scored) {
      $("status").textContent = `${state.snips || 0} fragments snipped · ` +
        `page: ${state.page.density} slop points / 100 words` +
        (state.page.slop ? " — flagged as slop" : "");
    }
  } else {
    $("siteDisabled").disabled = true;
  }

  $("enabled").onchange = () => browser.storage.local.set({ enabled: $("enabled").checked });
  $("threshold").onchange = () => browser.storage.local.set({ threshold: Number($("threshold").value) });
  $("siteDisabled").onchange = async () => {
    const { disabledSites } = await browser.storage.local.get(DEFAULTS);
    const set = new Set(disabledSites);
    if ($("siteDisabled").checked) set.add(state.hostname); else set.delete(state.hostname);
    await browser.storage.local.set({ disabledSites: [...set] });
  };
  $("expandAll").onclick = () => browser.tabs.sendMessage(tab.id, { type: "expandAll" }).catch(() => {});
  $("collapseAll").onclick = () => browser.tabs.sendMessage(tab.id, { type: "collapseAll" }).catch(() => {});
  $("options").onclick = (e) => { e.preventDefault(); browser.runtime.openOptionsPage(); window.close(); };
})();
