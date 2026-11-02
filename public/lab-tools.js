(() => {
    "use strict";
    function init() {
        if (document.querySelector(".lab-tools")) return;
        const canvases = [...document.querySelectorAll("canvas")];
        if (!canvases.length) return;
        // Names, comments, files and credentials are deliberately excluded from shared links.
        const controls = [...document.querySelectorAll("input[id], select[id]")].filter((input) =>
            !input.closest("#pl-comments-root") &&
            (input.tagName === "SELECT" || ["range", "number", "checkbox", "radio"].includes(input.type)));
        const modeButtons = [...document.querySelectorAll("button[data-mode], button[data-scene], button[data-preset], button[data-sign], button[data-lat], button[data-spin], button[data-step], button[data-lab-share]")];
        const modeKey = (button) => button.id || `${[...button.attributes]
            .filter((attribute) => attribute.name.startsWith("data-") && attribute.name !== "data-lab-share-toggle")
            .map((attribute) => `${attribute.name}=${attribute.value}`).sort().join("|")}:${button.parentElement.id}`;
        const selected = (button) => button.classList.contains("active") || button.getAttribute("aria-pressed") === "true";
        const actions = new URLSearchParams(location.search).get("lab-actions");
        if (actions && actions.length < 2000) {
            try {
                const savedActions = JSON.parse(actions);
                if (Array.isArray(savedActions)) for (const action of savedActions) {
                    const button = modeButtons.find((candidate) => modeKey(candidate) === action?.key);
                    if (!button || button.disabled || typeof action.active !== "boolean") continue;
                    if ((action.active || button.hasAttribute("data-lab-share-toggle")) && selected(button) !== action.active) button.click();
                }
            } catch { /* Unsupported mode state is ignored. */ }
        }
        const saved = new URLSearchParams(location.search).get("lab-state");
        if (saved && saved.length < 12_000) {
            try {
                const values = JSON.parse(saved);
                if (values && typeof values === "object" && !Array.isArray(values)) {
                    const restored = [];
                    for (const input of controls) {
                        if (!Object.hasOwn(values, input.id) || input.disabled) continue;
                        if (input.type === "checkbox" || input.type === "radio") input.checked = values[input.id] === true;
                        else if (typeof values[input.id] === "string") input.value = values[input.id];
                        restored.push(input);
                    }
                    // Restore all numeric values together, then apply dependent preset selects last.
                    for (const input of restored.filter((input) => input.tagName !== "SELECT")) {
                        input.dispatchEvent(new Event("input", { bubbles: true }));
                        input.dispatchEvent(new Event("change", { bubbles: true }));
                    }
                    for (const input of restored.filter((input) => input.tagName === "SELECT")) {
                        input.value = values[input.id];
                        input.dispatchEvent(new Event("change", { bubbles: true }));
                    }
                }
            } catch { /* Invalid links keep the normal page defaults. */ }
        }
        const tools = document.createElement("details");
        tools.className = "lab-tools";
        const summary = document.createElement("summary");
        summary.textContent = "课堂工具";
        tools.append(summary);
        const status = document.createElement("span");
        status.className = "lab-tools-status";
        status.setAttribute("role", "status");
        const share = document.createElement("button");
        share.type = "button";
        share.textContent = "复制参数链接";
        share.addEventListener("click", async () => {
            const url = new URL(location.pathname, location.origin);
            const values = Object.fromEntries(controls.filter((input) => !input.disabled).map((input) => [input.id,
                ["checkbox", "radio"].includes(input.type) ? input.checked : input.value]));
            if (controls.length) url.searchParams.set("lab-state", JSON.stringify(values));
            const modes = modeButtons.map((button) => ({ key: modeKey(button), active: selected(button) }));
            if (modes.length) url.searchParams.set("lab-actions", JSON.stringify(modes));
            try { await navigator.clipboard.writeText(url.href); status.textContent = "参数链接已复制"; }
            catch { window.prompt("复制当前参数链接", url.href); }
        });
        const select = document.createElement("select");
        select.setAttribute("aria-label", "选择导出画布");
        canvases.forEach((canvas, index) => {
            const option = document.createElement("option");
            option.value = String(index);
            option.textContent = canvas.getAttribute("aria-label") || `画布 ${index + 1}`;
            select.append(option);
        });
        const download = document.createElement("button");
        download.type = "button";
        download.textContent = "导出画布 PNG";
        download.addEventListener("click", () => {
            try {
                canvases[Number(select.value)].toBlob((blob) => {
                    if (!blob) { status.textContent = "画布导出失败"; return; }
                    const url = URL.createObjectURL(blob), link = document.createElement("a");
                    link.href = url;
                    link.download = `${document.title.replace(/[<>:"/\\|?*]/g, "_")}.png`;
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    status.textContent = "画布已导出";
                }, "image/png");
            } catch { status.textContent = "此画布包含受限图片，暂不能导出"; }
        });
        tools.append(share);
        if (canvases.length > 1) tools.append(select);
        tools.append(download, status);
        const model = document.querySelector('meta[name="lab-model"]')?.content;
        if (model) {
            const note = document.createElement("p");
            note.className = "lab-model-note";
            note.textContent = model;
            tools.append(note);
        }
        document.body.append(tools);
    }
    // Module experiments finish initialization before shared parameters are restored.
    if (document.readyState !== "complete") window.addEventListener("load", init, { once: true });
    else init();
})();
