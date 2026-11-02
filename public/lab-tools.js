(() => {
    "use strict";
    const svgStyleProperties = [
        "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-dashoffset",
        "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "opacity", "color", "font-family", "font-size", "font-style",
        "font-weight", "letter-spacing", "text-anchor", "dominant-baseline", "alignment-baseline", "visibility", "display",
        "paint-order", "vector-effect", "shape-rendering", "text-rendering", "stop-color", "stop-opacity", "marker-start",
        "marker-mid", "marker-end", "clip-path", "mask", "filter", "transform", "transform-origin", "transform-box",
    ];
    function pngBlob(canvas) {
        return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法生成 PNG")), "image/png"));
    }
    async function svgPng(svg) {
        const box = svg.viewBox.baseVal;
        const width = Math.ceil(box.width || svg.width.baseVal.value || svg.getBoundingClientRect().width);
        const height = Math.ceil(box.height || svg.height.baseVal.value || svg.getBoundingClientRect().height);
        if (!(width > 0 && height > 0) || width > 8192 || height > 8192) throw new Error("图形尺寸无效或过大");
        const clone = svg.cloneNode(true);
        const originals = [svg, ...svg.querySelectorAll("*")];
        const copies = [clone, ...clone.querySelectorAll("*")];
        const localIds = new Set(copies.map((node) => node.id).filter(Boolean));
        function localUrl(value) {
            return value.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (_, quote, reference) => {
                const url = new URL(reference, location.href);
                const current = new URL(location.href);
                if (!url.hash || url.origin !== current.origin || url.pathname !== current.pathname
                    || !localIds.has(decodeURIComponent(url.hash.slice(1)))) throw new Error("图形包含外部或未嵌入的资源");
                return `url("${url.hash}")`;
            });
        }
        originals.forEach((source, index) => {
            const target = copies[index];
            const computed = getComputedStyle(source);
            // Resolve inherited rules and CSS variables before detaching from the document.
            target.removeAttribute("style");
            for (const property of svgStyleProperties) {
                const value = computed.getPropertyValue(property);
                if (value) target.style.setProperty(property, localUrl(value));
            }
            for (const attribute of [...target.attributes]) {
                if (/^on/i.test(attribute.name)) target.removeAttribute(attribute.name);
                else if (/^(?:href|xlink:href)$/i.test(attribute.name)) {
                    if (target.localName === "a") { target.removeAttribute(attribute.name); continue; }
                    const value = attribute.value;
                    if (/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(value)) continue;
                    const url = new URL(value, location.href);
                    const current = new URL(location.href);
                    if (!url.hash || url.origin !== current.origin || url.pathname !== current.pathname
                        || !localIds.has(decodeURIComponent(url.hash.slice(1)))) throw new Error("图形包含外部或未嵌入的资源");
                    target.setAttribute(attribute.name, url.hash);
                } else if (/url\(/i.test(attribute.value)) target.setAttribute(attribute.name, localUrl(attribute.value));
            }
        });
        clone.querySelectorAll("script, style, link, foreignObject, animate, animateTransform, animateMotion, set").forEach((node) => node.remove());
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        clone.setAttribute("width", String(width));
        clone.setAttribute("height", String(height));
        clone.style.width = `${width}px`;
        clone.style.height = `${height}px`;
        const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" }));
        try {
            const image = new Image();
            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = () => reject(new Error("无法读取导出图形"));
                image.src = url;
            });
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d");
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, width, height);
            context.drawImage(image, 0, 0, width, height);
            return await pngBlob(canvas);
        } finally { URL.revokeObjectURL(url); }
    }
    function init() {
        if (document.querySelector(".lab-tools")) return;
        const surfaces = [...document.querySelectorAll("canvas, svg[data-lab-export]")];
        if (!surfaces.length) return;
        const hasSvg = surfaces.some((surface) => surface.localName === "svg");
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
                    const restoreValue = (input) => {
                        if (input.type === "checkbox" || input.type === "radio") input.checked = values[input.id] === true;
                        else input.value = values[input.id];
                    };
                    for (const input of controls) {
                        if (!Object.hasOwn(values, input.id) || input.disabled) continue;
                        if (!["checkbox", "radio"].includes(input.type) && typeof values[input.id] !== "string") continue;
                        restoreValue(input);
                        restored.push(input);
                    }
                    // Restore all numeric values together, then apply dependent preset selects last.
                    for (const input of restored.filter((input) => input.tagName !== "SELECT")) {
                        restoreValue(input);
                        input.dispatchEvent(new Event("input", { bubbles: true }));
                        restoreValue(input);
                        input.dispatchEvent(new Event("change", { bubbles: true }));
                    }
                    for (const input of restored.filter((input) => input.tagName === "SELECT")) {
                        restoreValue(input);
                        input.dispatchEvent(new Event("change", { bubbles: true }));
                    }
                    window.dispatchEvent(new CustomEvent("physicslab:state-restored", {
                        detail: { values: Object.fromEntries(restored.map((input) => [input.id, values[input.id]])) },
                    }));
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
        select.setAttribute("aria-label", hasSvg ? "选择导出图形" : "选择导出画布");
        surfaces.forEach((surface, index) => {
            const option = document.createElement("option");
            option.value = String(index);
            option.textContent = surface.getAttribute("aria-label") || `图形 ${index + 1}`;
            select.append(option);
        });
        const download = document.createElement("button");
        download.type = "button";
        download.textContent = hasSvg ? "导出图形 PNG" : "导出画布 PNG";
        download.addEventListener("click", async () => {
            download.disabled = true;
            try {
                const surface = surfaces[Number(select.value)];
                const blob = surface.localName === "svg" ? await svgPng(surface) : await pngBlob(surface);
                const url = URL.createObjectURL(blob), link = document.createElement("a");
                link.href = url;
                link.download = `${document.title.replace(/[<>:"/\\|?*]/g, "_")}.png`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                status.textContent = hasSvg ? "图形已导出" : "画布已导出";
            } catch { status.textContent = "图形包含受限资源或无法读取，暂不能导出"; }
            finally { download.disabled = false; }
        });
        tools.append(share);
        if (surfaces.length > 1) tools.append(select);
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
