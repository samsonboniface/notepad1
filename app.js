(() => {
    const editor = document.querySelector("#editor");
    const filePicker = document.querySelector("#file-picker");
    const imagePicker = document.querySelector("#image-picker");
    const imageTools = document.querySelector("#image-tools");
    const imageWidthInput = document.querySelector("#image-width");
    const imageZoomLevel = document.querySelector("#image-zoom-level");
    const imageRotateHint = document.querySelector("#image-rotate-hint");
    const fontPicker = document.querySelector("#font-family");
    const textColorPicker = document.querySelector("#text-color");
    const documentName = document.querySelector("#document-name");
    const unsavedIndicator = document.querySelector("#unsaved-indicator");
    const cursorPosition = document.querySelector("#cursor-position");
    const selectionStatus = document.querySelector("#selection-status");
    const zoomLevel = document.querySelector("#zoom-level");
    const emptyHint = document.querySelector("#empty-hint");
    const findDialog = document.querySelector("#find-dialog");
    const findInput = document.querySelector("#find-input");
    const replaceInput = document.querySelector("#replace-input");
    const replaceFields = document.querySelector("#replace-fields");
    const findFeedback = document.querySelector("#find-feedback");
    const lineDialog = document.querySelector("#line-dialog");
    const lineInput = document.querySelector("#line-input");
    const lineCount = document.querySelector("#line-count");
    const toastElement = document.querySelector("#toast");
    const noteTimestamp = document.querySelector("#note-timestamp");
    const notesDialog = document.querySelector("#notes-dialog");
    const notesList = document.querySelector("#notes-list");
    const saveDialog = document.querySelector("#save-dialog");
    const historyDialog = document.querySelector("#history-dialog");
    const historyList = document.querySelector("#history-list");
    const storageKey = "notepad-web-draft-v1";
    const gridLineStorageKey = `${storageKey}-grid-lines`;
    const gridVisibilityStorageKey = `${storageKey}-grid-visible`;
    const notesStorageKey = `${storageKey}-notes`;
    const historyStorageKey = `${storageKey}-history`;
    const appTitle = "MY Notepad";
    const defaultFileName = "KEEP FOR LETTRE USE";
    const minimumGridLineGap = 4;
    const gridLinePlacementGap = 16;
    const editorFonts = {
        consolas: 'Consolas, "Courier New", monospace',
        courier: '"Courier New", monospace',
        segoe: '"Segoe UI", Arial, sans-serif',
        arial: 'Arial, sans-serif',
        georgia: 'Georgia, serif'
    }

    let fileName = defaultFileName;
    let savedText = "";
    let notes = [];
    let saveHistory = [];
    let activeNoteId = null;
    let activeCreatedAt = null;
    let activeUpdatedAt = null;
    let zoom = 100;
    let toastTimer;
    let storageErrorShown = false;
    let lastEditorRange = null;
    let selectedImage = null;
    let imagePointerDrag = null;
    let lastCanvasPoint = { x: 24, y: 24 };
    const gridSpacing = { horizontal: 28, vertical: 28 };
    const gridLinePositions = { horizontal: [], vertical: [] };
    let selectedGridLine = null;
    let gridLineDrag = null;
    let pendingGridLineAxis = null;
    let gridLinesVisible = true;

    function getEditorHtml() {
        const content = editor.cloneNode(true);
        content.querySelector(".grid-lines")?.remove();
        return content.innerHTML;
    }

    function getGridLineLimit(axis) {
        return axis === "horizontal" ? 1200 : 1600;
    }

    function updateGridLineControls() {
        const status = document.querySelector("#selected-grid-line");
        const picker = document.querySelector("#grid-line-picker");
        const hasSelection = selectedGridLine &&
            gridLinePositions[selectedGridLine.axis][selectedGridLine.index] !== undefined;
        if (!hasSelection) {
            selectedGridLine = null;
            picker.value = "";
            status.textContent = "Select or drag a line on the canvas";
        } else {
            const position = gridLinePositions[selectedGridLine.axis][selectedGridLine.index];
            const direction = selectedGridLine.axis === "horizontal" ? "from top" : "from left";
            picker.value = `${selectedGridLine.axis}:${selectedGridLine.index}`;
            status.textContent = `${selectedGridLine.axis === "horizontal" ? "Horizontal" : "Vertical"} line ${selectedGridLine.index + 1} · ${position} px ${direction}`;
            const option = picker.selectedOptions[0];
            if (option) option.textContent = `${selectedGridLine.axis === "horizontal" ? "Horizontal" : "Vertical"} line ${selectedGridLine.index + 1} · ${position} px`;
        }
        document.querySelectorAll("[data-grid-delta]").forEach((button) => {
            button.disabled = !hasSelection;
        });
        document.querySelector("#delete-grid-line").disabled = !hasSelection;
        editor.querySelectorAll(".grid-line").forEach((line) => {
            line.classList.toggle(
                "grid-line-selected",
                hasSelection &&
                    line.dataset.axis === selectedGridLine.axis &&
                    Number(line.dataset.index) === selectedGridLine.index
            );
        });
    }

    function selectGridLine(axis, index) {
        selectedGridLine = { axis, index };
        updateGridLineControls();
    }

    function persistGridLines() {
        try {
            localStorage.setItem(gridLineStorageKey, JSON.stringify(gridLinePositions));
        } catch (error) {
            console.error("Could not save individual grid line positions.", error);
            showToast("Grid line moved, but its position could not be saved.");
        }
    }

    function setGridLinesVisible(visible, persist = true) {
        gridLinesVisible = Boolean(visible);
        editor.classList.toggle("grid-lines-hidden", !gridLinesVisible);
        document.querySelector(".grid-tools").classList.toggle("grid-tools-lines-hidden", !gridLinesVisible);
        const button = document.querySelector("#toggle-grid-lines");
        button.textContent = gridLinesVisible ? "Hide lines" : "Show lines";
        button.setAttribute("aria-pressed", String(gridLinesVisible));
        if (persist) {
            try {
                localStorage.setItem(gridVisibilityStorageKey, String(gridLinesVisible));
            } catch (error) {
                console.error("Could not save grid visibility.", error);
                showToast("Grid visibility changed, but its preference could not be saved.");
            }
        }
    }

    function beginGridLinePlacement(axis) {
        pendingGridLineAxis = axis;
        editor.classList.remove("grid-line-placement-horizontal", "grid-line-placement-vertical");
        editor.classList.add(`grid-line-placement-${axis}`);
        const name = axis === "horizontal" ? "horizontal" : "vertical";
        document.querySelector("#selected-grid-line").textContent = `Click the canvas to place a ${name} line`;
        setGridLinesVisible(true);
    }

    function cancelGridLinePlacement() {
        if (!pendingGridLineAxis) return;
        pendingGridLineAxis = null;
        editor.classList.remove("grid-line-placement-horizontal", "grid-line-placement-vertical");
        updateGridLineControls();
    }

    function addGridLine(axis, requestedPosition) {
        if (!Number.isFinite(requestedPosition)) {
            showToast("Click inside the canvas to place the line.");
            return;
        }
        const positions = gridLinePositions[axis];
        const limit = getGridLineLimit(axis);
        const target = Math.max(0, Math.min(limit - 1, Math.round(requestedPosition)));
        const index = positions.findIndex((existing) => existing > target);
        const previous = index > 0 ? positions[index - 1] : null;
        const next = index === -1 ? null : positions[index];
        const minimum = previous === null ? 0 : previous + gridLinePlacementGap;
        const maximum = next === null ? limit - 1 : next - gridLinePlacementGap;
        if (minimum > maximum) {
            showToast("There is no room to add another line at this position.");
            return;
        }
        const placementMargin = 12;
        const position = target - minimum < placementMargin || maximum - target < placementMargin
            ? Math.round((minimum + maximum) / 2)
            : target;
        if (index === -1) positions.push(position);
        else positions.splice(index, 0, position);
        pendingGridLineAxis = null;
        editor.classList.remove("grid-line-placement-horizontal", "grid-line-placement-vertical");
        renderGridLines();
        const selectedIndex = positions.indexOf(position);
        selectGridLine(axis, selectedIndex);
        persistGridLines();
        showToast(`Added ${axis} line at ${position} px.`);
    }

    function deleteSelectedGridLine() {
        if (!selectedGridLine) return;
        const { axis, index } = selectedGridLine;
        gridLinePositions[axis].splice(index, 1);
        selectedGridLine = null;
        renderGridLines();
        persistGridLines();
        showToast(`Deleted selected ${axis} line.`);
    }

    function initializeGridLines() {
        for (const axis of Object.keys(gridSpacing)) {
            gridLinePositions[axis] = [];
            for (let position = gridSpacing[axis]; position < getGridLineLimit(axis); position += gridSpacing[axis]) {
                gridLinePositions[axis].push(position);
            }
        }
        try {
            const savedSpacing = JSON.parse(localStorage.getItem(`${storageKey}-grid-spacing`) || "{}");
            for (const axis of Object.keys(gridSpacing)) {
                if (Number.isFinite(savedSpacing[axis])) {
                    gridSpacing[axis] = Math.max(8, Math.min(120, Math.round(savedSpacing[axis] / 4) * 4));
                }
                gridLinePositions[axis] = [];
                for (let position = gridSpacing[axis]; position < getGridLineLimit(axis); position += gridSpacing[axis]) {
                    gridLinePositions[axis].push(position);
                }
            }
            const savedPositions = localStorage.getItem(gridLineStorageKey);
            if (savedPositions) {
                const parsed = JSON.parse(savedPositions);
                let normalized = false;
                for (const axis of Object.keys(gridLinePositions)) {
                    if (!Array.isArray(parsed[axis])) continue;
                    const positions = parsed[axis]
                        .filter((position) => Number.isFinite(position) && position >= 0 && position < getGridLineLimit(axis))
                        .map(Math.round)
                        .sort((a, b) => a - b);
                    gridLinePositions[axis] = positions.filter((position, index) =>
                        index === 0 || position - positions[index - 1] >= minimumGridLineGap
                    );
                    normalized = normalized || gridLinePositions[axis].length !== parsed[axis].length;
                }
                if (normalized) persistGridLines();
            }
        } catch (error) {
            console.error("Could not restore individual grid line positions.", error);
            showToast("Could not restore grid line positions.");
        }
        renderGridLines();
        setGridLinesVisible(localStorage.getItem(gridVisibilityStorageKey) !== "false", false);
    }

    function renderGridLines() {
        editor.querySelector(".grid-lines")?.remove();
        const picker = document.querySelector("#grid-line-picker");
        picker.replaceChildren(new Option("Choose a line…", ""));
        const layer = document.createElement("div");
        layer.className = "grid-lines";
        layer.setAttribute("aria-label", "Draggable horizontal and vertical grid lines");
        for (const axis of Object.keys(gridLinePositions)) {
            gridLinePositions[axis].forEach((position, index) => {
                const option = new Option(
                    `${axis === "horizontal" ? "Horizontal" : "Vertical"} line ${index + 1} · ${position} px`,
                    `${axis}:${index}`
                );
                picker.append(option);
                const line = document.createElement("div");
                line.className = `grid-line grid-line-${axis}`;
                line.dataset.axis = axis;
                line.dataset.index = String(index);
                line.tabIndex = 0;
                line.setAttribute("role", "button");
                line.setAttribute("aria-label", `${axis === "horizontal" ? "Horizontal" : "Vertical"} line ${index + 1} at ${position} pixels; drag to move`);
                line.title = "Select and drag to move this line";
                line.style[axis === "horizontal" ? "top" : "left"] = `${position}px`;
                line.addEventListener("pointerdown", (event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    selectGridLine(axis, index);
                    line.focus({ preventScroll: true });
                    line.setPointerCapture(event.pointerId);
                    gridLineDrag = {
                        axis,
                        index,
                        pointerId: event.pointerId,
                        startCoordinate: axis === "horizontal" ? event.clientY : event.clientX,
                        startPosition: gridLinePositions[axis][index]
                    };
                });
                line.addEventListener("keydown", (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectGridLine(axis, index);
                    } else if (["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"].includes(event.key)) {
                        event.preventDefault();
                        selectGridLine(axis, index);
                        moveSelectedGridLine(event.key === "ArrowUp" || event.key === "ArrowLeft" ? -4 : 4);
                    }
                });
                layer.append(line);
            });
        }
        editor.prepend(layer);
        updateGridLineControls();
    }

    document.querySelector("#grid-line-picker").addEventListener("change", (event) => {
        const [axis, index] = event.target.value.split(":");
        if (gridLinePositions[axis] && Number.isInteger(Number(index))) {
            selectGridLine(axis, Number(index));
        }
    });

    document.querySelector("#toggle-grid-lines").addEventListener("click", () => {
        setGridLinesVisible(!gridLinesVisible);
    });
    document.querySelector("#add-horizontal-line").addEventListener("click", () => beginGridLinePlacement("horizontal"));
    document.querySelector("#add-vertical-line").addEventListener("click", () => beginGridLinePlacement("vertical"));
    document.querySelector("#delete-grid-line").addEventListener("click", deleteSelectedGridLine);
    document.querySelectorAll("#toggle-grid-lines, #add-horizontal-line, #add-vertical-line, #delete-grid-line")
        .forEach((button) => button.addEventListener("mousedown", (event) => event.preventDefault()));

    function moveSelectedGridLine(delta) {
        if (!selectedGridLine) return;
        const { axis, index } = selectedGridLine;
        const currentPosition = gridLinePositions[axis][index];
        const position = findAvailableGridLinePosition(axis, index, currentPosition + delta);
        if (position === null || position === currentPosition) return;
        finishGridLineMove(axis, index, position);
    }

    function findAvailableGridLinePosition(axis, index, requestedPosition) {
        const limit = getGridLineLimit(axis);
        const positions = gridLinePositions[axis];
        const target = Math.max(0, Math.min(limit - 1, Math.round(requestedPosition)));
        for (let distance = 0; distance < limit; distance += 1) {
            const candidates = distance === 0 ? [target] : [target + distance, target - distance];
            const available = candidates.find((candidate) =>
                candidate >= 0 &&
                candidate < limit &&
                positions.every((position, otherIndex) =>
                    otherIndex === index || Math.abs(position - candidate) >= minimumGridLineGap
                )
            );
            if (available !== undefined) return available;
        }
        return null;
    }

    function finishGridLineMove(axis, index, position) {
        const positions = gridLinePositions[axis];
        positions[index] = position;
        positions.sort((a, b) => a - b);
        const newIndex = positions.indexOf(position);
        selectedGridLine = { axis, index: newIndex };
        renderGridLines();
        persistGridLines();
    }

    function moveGridLineFromPointer(event) {
        if (!gridLineDrag || event.pointerId !== gridLineDrag.pointerId) return;
        const { axis, index, startCoordinate, startPosition } = gridLineDrag;
        const layer = editor.querySelector(".grid-lines").getBoundingClientRect();
        const scale = axis === "horizontal"
            ? getGridLineLimit(axis) / layer.height
            : getGridLineLimit(axis) / layer.width;
        const pointerCoordinate = axis === "horizontal" ? event.clientY : event.clientX;
        const position = findAvailableGridLinePosition(
            axis,
            index,
            startPosition + (pointerCoordinate - startCoordinate) * scale
        );
        if (position === null) return;
        gridLinePositions[axis][index] = position;
        const line = editor.querySelector(`.grid-line[data-axis="${axis}"][data-index="${index}"]`);
        if (line) line.style[axis === "horizontal" ? "top" : "left"] = `${position}px`;
        updateGridLineControls();
    }

    function finishGridLineDrag(event) {
        if (!gridLineDrag || event.pointerId !== gridLineDrag.pointerId) return;
        const { axis, index } = gridLineDrag;
        const position = gridLinePositions[axis][index];
        gridLineDrag = null;
        finishGridLineMove(axis, index, position);
    }

    document.querySelectorAll("[data-grid-delta]").forEach((button) => {
        button.addEventListener("click", () => moveSelectedGridLine(Number(button.dataset.gridDelta)));
        button.addEventListener("mousedown", (event) => event.preventDefault());
    });

    function getEditorText() {
        return [...editor.querySelectorAll(".canvas-text")]
            .map((block) => block.innerText.replace(/\r/g, "").replace(/\u00a0/g, " "))
            .filter(Boolean)
            .join("\n");
    }

    function getEditorSelection() {
        const selection = window.getSelection();
        let range = null;
        if (selection?.rangeCount && editor.contains(selection.anchorNode)) {
            range = selection.getRangeAt(0);
            lastEditorRange = range.cloneRange();
        } else if (lastEditorRange && editor.contains(lastEditorRange.commonAncestorContainer)) {
            range = lastEditorRange;
        }
        if (!range) {
            return { start: 0, end: 0, text: "" };
        }

        const start = getEditorTextOffset(range.startContainer, range.startOffset);
        const end = getEditorTextOffset(range.endContainer, range.endOffset);
        const selectedText = getEditorText().slice(start, end);
        return { start, end, text: selectedText };
    }

    function getEditorTextOffset(targetNode, targetOffset) {
        const allText = getEditorText();
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        let consumed = 0;
        while (walker.nextNode()) {
            const node = walker.currentNode;
            if (node === targetNode) return consumed + targetOffset;
            consumed += node.textContent.length;
            if (allText[consumed] === "\n") consumed += 1;
        }

        const before = document.createRange();
        before.selectNodeContents(editor);
        before.setEnd(targetNode, targetOffset);
        return Math.min(fragmentText(before.cloneContents()).length, allText.length);
    }

    function fragmentText(fragment) {
        const container = document.createElement("div");
        container.append(fragment);
        return container.innerText.replace(/\r/g, "").replace(/\u00a0/g, " ");
    }

    function setEditorSelection(start, end = start) {
        const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);
        if (!textNodes.length) {
            const block = placeTextAt({ x: 24, y: 24 });
            const range = document.createRange();
            range.selectNodeContents(block);
            range.collapse(true);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            lastEditorRange = range.cloneRange();
            return;
        }

        const allText = getEditorText();
        const locate = (offset) => {
            let consumed = 0;
            for (const node of textNodes) {
                const length = node.textContent.length;
                if (offset <= consumed + length) return [node, Math.max(0, offset - consumed)];
                consumed += length;
                if (allText[consumed] === "\n") consumed += 1;
            }
            if (textNodes.length) {
                const last = textNodes[textNodes.length - 1];
                return [last, last.textContent.length];
            }
            return [editor, 0];
        };

        const selection = window.getSelection();
        const range = document.createRange();
        const [startNode, startOffset] = locate(start);
        const [endNode, endOffset] = locate(end);
        const startBlock = startNode.nodeType === Node.ELEMENT_NODE
            ? startNode.closest(".canvas-text")
            : startNode.parentElement?.closest(".canvas-text");
        startBlock?.focus();
        range.setStart(startNode, startOffset);
        range.setEnd(endNode, endOffset);
        selection.removeAllRanges();
        selection.addRange(range);
        lastEditorRange = range.cloneRange();
    }

    function replaceEditorSelection(text) {
        const selection = window.getSelection();
        if (!selection) return;
        if (!selection.rangeCount || !editor.contains(selection.anchorNode)) {
            if (!lastEditorRange || !editor.contains(lastEditorRange.commonAncestorContainer)) return;
            selection.removeAllRanges();
            selection.addRange(lastEditorRange);
        } else {
            lastEditorRange = selection.getRangeAt(0).cloneRange();
        }
        const range = selection.getRangeAt(0);
        const selectionBlock = range.startContainer.nodeType === Node.ELEMENT_NODE
            ? range.startContainer.closest(".canvas-text")
            : range.startContainer.parentElement?.closest(".canvas-text");
        selectionBlock?.focus();
        selection.removeAllRanges();
        selection.addRange(range);
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
        lastEditorRange = range.cloneRange();
    }

    function setEditorText(text) {
        editor.replaceChildren();
        renderGridLines();
        lastEditorRange = null;
        selectEditorImage(null);
        if (text) {
            const textBlock = createTextBlock(text, 24, 24);
            editor.append(textBlock);
        }
    }

    function canvasPointFromEvent(event) {
        const bounds = editor.getBoundingClientRect();
        return {
            x: Math.max(0, Math.round(event.clientX - bounds.left + editor.scrollLeft)),
            y: Math.max(0, Math.round(event.clientY - bounds.top + editor.scrollTop))
        };
    }

    function createTextBlock(text = "", x = 24, y = 24) {
        const block = document.createElement("div");
        block.className = "canvas-text";
        block.contentEditable = "true";
        block.spellcheck = false;
        block.setAttribute("role", "textbox");
        block.setAttribute("aria-multiline", "true");
        block.setAttribute("aria-label", "Text at canvas position");
        block.dataset.x = String(Math.min(100000, Math.max(0, Math.round(Number.isFinite(x) ? x : 24))));
        block.dataset.y = String(Math.min(100000, Math.max(0, Math.round(Number.isFinite(y) ? y : 24))));
        block.style.left = `${block.dataset.x}px`;
        block.style.top = `${block.dataset.y}px`;
        block.textContent = text;
        return block;
    }

    function placeTextAt(point, initialText = "") {
        const block = createTextBlock(initialText, point.x, point.y);
        editor.append(block);
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(block);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        lastEditorRange = range.cloneRange();
        block.focus();
        updateStatus();
        return block;
    }

    function createSanitizedEditorContent(html) {
        const template = document.createElement("template");
        template.innerHTML = html;
        const allowedTags = new Set(["BR", "DIV", "P", "H1", "H2", "STRONG", "B", "EM", "I", "U", "UL", "OL", "LI"]);
        const cleanNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
            if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
            if (node.classList.contains("canvas-text")) {
                const block = createTextBlock("", Number(node.dataset.x), Number(node.dataset.y));
                for (const child of node.childNodes) block.append(cleanNode(child));
                return block;
            }
            if (node.tagName === "IMG") {
                const source = node.getAttribute("src") || "";
                if (!/^data:image\/(?:png|jpeg|gif|webp|bmp|avif);base64,[\da-z+/]+=*$/i.test(source)) {
                    return document.createDocumentFragment();
                }
                const image = document.createElement("img");
                image.src = source;
                image.alt = (node.getAttribute("alt") || "").slice(0, 2000);
                image.contentEditable = "false";
                image.tabIndex = 0;
                const x = Number(node.getAttribute("data-x"));
                const y = Number(node.getAttribute("data-y"));
                image.dataset.x = String(Number.isFinite(x) && x >= 0 ? Math.min(100000, x) : 24);
                image.dataset.y = String(Number.isFinite(y) && y >= 0 ? Math.min(100000, y) : 24);
                const width = Number(node.getAttribute("width"));
                if (Number.isFinite(width) && width >= 20 && width <= 2000) image.width = Math.round(width);
                const rotation = Number(node.getAttribute("data-rotation"));
                if (Number.isFinite(rotation)) {
                    const normalizedRotation = Math.round((((rotation % 360) + 360) % 360) * 10) / 10;
                    image.dataset.rotation = String(normalizedRotation);
                }
                const offsetX = Number(node.getAttribute("data-offset-x"));
                const offsetY = Number(node.getAttribute("data-offset-y"));
                if (Number.isFinite(offsetX) && Math.abs(offsetX) <= 10000) image.dataset.offsetX = String(offsetX);
                if (Number.isFinite(offsetY) && Math.abs(offsetY) <= 10000) image.dataset.offsetY = String(offsetY);
                const zoom = Number(node.getAttribute("data-zoom"));
                if (Number.isFinite(zoom) && zoom >= 0.25 && zoom <= 3) image.dataset.zoom = String(zoom);
                updateImagePosition(image);
                updateImageTransform(image);
                return image;
            }
            const fragment = document.createDocumentFragment();
            for (const child of node.childNodes) fragment.append(cleanNode(child));
            if (!allowedTags.has(node.tagName)) return fragment;
            const cleanElement = document.createElement(node.tagName.toLowerCase());
            cleanElement.append(fragment);
            return cleanElement;
        };
        const clean = document.createDocumentFragment();
        for (const node of template.content.childNodes) clean.append(cleanNode(node));
        return clean;
    }

    function sanitizeEditorHtml(html) {
        const clean = createSanitizedEditorContent(html);
        const hasCanvasBlocks = clean.querySelector(".canvas-text");
        if (!hasCanvasBlocks) {
            const images = [...clean.querySelectorAll("img")];
            images.forEach((image) => image.remove());
            const text = clean.textContent || "";
            const approximateHeight = Math.max(72, Math.ceil(text.length / 80) * 28);
            const content = document.createDocumentFragment();
            if (text.trim() || clean.childNodes.length) {
                const textBlock = createTextBlock("", 24, 24);
                textBlock.append(clean);
                content.append(textBlock);
            }
            images.forEach((image, index) => {
                if (image.dataset.x === "24" && image.dataset.y === "24") {
                    image.dataset.y = String(24 + approximateHeight + index * 36);
                    updateImagePosition(image);
                }
                content.append(image);
            });
            editor.replaceChildren(content);
        } else {
            editor.replaceChildren(clean);
        }
        renderGridLines();
        lastEditorRange = null;
        selectEditorImage(null);
    }

    function editorContentIsEmpty() {
        return !getEditorText().trim() && !editor.querySelector("img");
    }

    function applyBlockFormat(tagName) {
        const selection = window.getSelection();
        if (!selection) return;
        if (!selection.rangeCount || !editor.contains(selection.anchorNode)) {
            selection.removeAllRanges();
            if (lastEditorRange && editor.contains(lastEditorRange.commonAncestorContainer)) {
                selection.addRange(lastEditorRange);
            } else {
                const block = editor.querySelector(".canvas-text") || placeTextAt({ x: 24, y: 24 });
                block.focus();
                const range = document.createRange();
                range.selectNodeContents(block);
                range.collapse(false);
                selection.addRange(range);
            }
        }
        if (!editor.contains(selection.anchorNode)) {
            return;
        }
        const activeBlock = selection.anchorNode.nodeType === Node.ELEMENT_NODE
            ? selection.anchorNode.closest(".canvas-text")
            : selection.anchorNode.parentElement?.closest(".canvas-text");
        activeBlock?.focus();
        document.execCommand("formatBlock", false, tagName);
        const currentSelection = window.getSelection();
        lastEditorRange = currentSelection?.rangeCount ? currentSelection.getRangeAt(0).cloneRange() : null;
        handleEditorChange();
        updateStatus();
    }

    function applyInlineFormat(command) {
        const selection = window.getSelection();
        if (!selection) return;
        if ((!selection.rangeCount || !editor.contains(selection.anchorNode)) &&
            lastEditorRange && editor.contains(lastEditorRange.commonAncestorContainer)) {
            selection.removeAllRanges();
            selection.addRange(lastEditorRange);
        }
        if (!selection.rangeCount || !editor.contains(selection.anchorNode)) {
            showToast("Select text in a note first.");
            return;
        }
        document.execCommand(command, false);
        const currentSelection = window.getSelection();
        lastEditorRange = currentSelection?.rangeCount ? currentSelection.getRangeAt(0).cloneRange() : null;
        handleEditorChange();
        updateStatus();
    }

    function showToast(message) {
        toastElement.textContent = message;
        toastElement.classList.add("visible");
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => toastElement.classList.remove("visible"), 2600);
    }

    function updateDocumentState() {
        const dirty = getEditorHtml() !== savedText;
        unsavedIndicator.hidden = !dirty;
        documentName.textContent = fileName;
        document.title = `${dirty ? "● " : ""}${fileName} - ${appTitle}`;
        emptyHint.hidden = !editorContentIsEmpty();
    }

    function formatTimestamp(timestamp) {
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short"
        }).format(new Date(timestamp));
    }

    function updateNoteTimestamp() {
        noteTimestamp.textContent = activeCreatedAt
            ? `Created ${formatTimestamp(activeCreatedAt)}`
            : "No note saved yet";
        noteTimestamp.title = activeUpdatedAt
            ? `Last edited ${formatTimestamp(activeUpdatedAt)}`
            : "";
    }

    function persistDraft() {
        try {
            localStorage.setItem(storageKey, JSON.stringify({
                text: getEditorText(),
                html: getEditorHtml(),
                fileName,
                savedText,
                savedHtml: savedText,
                activeNoteId,
                activeCreatedAt,
                activeUpdatedAt,
                color: textColorPicker.value,
                updatedAt: Date.now()
            }));
        } catch (error) {
            console.error("Could not save the recovery draft.", error);
            if (!storageErrorShown) {
                showToast("Draft recovery is unavailable in this browser.");
                storageErrorShown = true;
            }
        }
    }

    function persistNotes() {
        try {
            localStorage.setItem(notesStorageKey, JSON.stringify(notes));
            return true;
        } catch (error) {
            console.error("Could not save notes in this browser.", error);
            showToast("Could not save the note. Browser storage may be full.");
            return false;
        }
    }

    function persistHistory() {
        try {
            localStorage.setItem(historyStorageKey, JSON.stringify(saveHistory));
            return true;
        } catch (error) {
            console.error("Could not save the save history.", error);
            return false;
        }
    }

    function recordSaveHistory(destination, title) {
        const now = Date.now();
        const entry = {
            id: `save-${now}-${Math.random().toString(36).slice(2)}`,
            destination,
            title,
            text: getEditorText(),
            html: getEditorHtml(),
            color: textColorPicker.value,
            savedAt: now
        };
        saveHistory = [entry, ...saveHistory].slice(0, 50);
        const persisted = persistHistory();
        if (!persisted) showToast("The note was saved, but its save history could not be stored.");
        if (historyDialog.open) renderSaveHistory();
        return persisted;
    }

    function noteTitle() {
        const firstLine = getEditorText().split(/\r?\n/, 1)[0].trim();
        if (firstLine) return firstLine.slice(0, 60);
        return fileName !== defaultFileName ? fileName.replace(/\.[^.]+$/, "") : "New note";
    }

    function saveCurrentNote(showMessage) {
        if (editorContentIsEmpty() && !activeNoteId) {
            updateNoteTimestamp();
            return false;
        }

        const now = Date.now();
        const existing = notes.find((note) => note.id === activeNoteId);
        activeCreatedAt = existing?.createdAt || activeCreatedAt || now;
        activeUpdatedAt = now;
        activeNoteId = activeNoteId || (window.crypto.randomUUID
            ? window.crypto.randomUUID()
            : `note-${now}-${Math.random().toString(36).slice(2)}`);

        const record = {
            id: activeNoteId,
            title: noteTitle(),
            text: getEditorText(),
            html: getEditorHtml(),
            color: textColorPicker.value,
            createdAt: activeCreatedAt,
            updatedAt: activeUpdatedAt
        };
        notes = [record, ...notes.filter((note) => note.id !== activeNoteId)];
        if (!persistNotes()) return false;

        fileName = record.title;
        savedText = getEditorHtml();
        updateDocumentState();
        updateNoteTimestamp();
        if (notesDialog.open) renderNotes();
        if (showMessage) showToast("Note saved in Notepad.");
        return true;
    }

    function renderNotes() {
        notesList.replaceChildren();
        if (!notes.length) {
            const emptyMessage = document.createElement("div");
            emptyMessage.className = "notes-empty";
            emptyMessage.textContent = "No saved notes yet. Start writing or create a new note.";
            notesList.append(emptyMessage);
            return;
        }

        [...notes].sort((a, b) => b.updatedAt - a.updatedAt).forEach((note) => {
            const card = document.createElement("article");
            card.className = "note-card";

            const info = document.createElement("div");
            info.className = "note-card-info";
            const title = document.createElement("div");
            title.className = "note-card-title";
            title.textContent = note.title;
            const dates = document.createElement("div");
            dates.className = "note-card-dates";
            dates.textContent = `Created ${formatTimestamp(note.createdAt)} · Edited ${formatTimestamp(note.updatedAt)}`;
            info.append(title, dates);

            const actions = document.createElement("div");
            actions.className = "note-card-actions";
            const openButton = document.createElement("button");
            openButton.type = "button";
            openButton.textContent = "Open";
            openButton.dataset.noteAction = "open";
            openButton.dataset.noteId = note.id;
            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "delete-note";
            deleteButton.textContent = "Delete";
            deleteButton.dataset.noteAction = "delete";
            deleteButton.dataset.noteId = note.id;
            actions.append(openButton, deleteButton);
            card.append(info, actions);
            notesList.append(card);
        });
    }

    function renderSaveHistory() {
        historyList.replaceChildren();
        if (!saveHistory.length) {
            const emptyMessage = document.createElement("div");
            emptyMessage.className = "notes-empty";
            emptyMessage.textContent = "No save history yet. Save a note to see it here.";
            historyList.append(emptyMessage);
            return;
        }

        [...saveHistory].sort((a, b) => b.savedAt - a.savedAt).forEach((entry) => {
            const card = document.createElement("article");
            card.className = "note-card";

            const info = document.createElement("div");
            info.className = "note-card-info";
            const title = document.createElement("div");
            title.className = "note-card-title";
            title.textContent = entry.title;
            const dates = document.createElement("div");
            dates.className = "note-card-dates";
            dates.textContent = `${entry.destination === "device" ? "Saved to device" : "Saved in Notepad"} · ${formatTimestamp(entry.savedAt)}`;
            info.append(title, dates);

            const actions = document.createElement("div");
            actions.className = "note-card-actions";
            const openButton = document.createElement("button");
            openButton.type = "button";
            openButton.textContent = "Open";
            openButton.dataset.historyAction = "open";
            openButton.dataset.historyId = entry.id;
            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "delete-note";
            deleteButton.textContent = "Delete";
            deleteButton.dataset.historyAction = "delete";
            deleteButton.dataset.historyId = entry.id;
            actions.append(openButton, deleteButton);
            card.append(info, actions);
            historyList.append(card);
        });
    }

    function openHistoryEntry(id) {
        const entry = saveHistory.find((item) => item.id === id);
        if (!entry) {
            showToast("That save history entry could not be found.");
            renderSaveHistory();
            return;
        }
        if (getEditorHtml() !== savedText && !window.confirm("Discard your unsaved changes and open this saved version?")) return;

        if (typeof entry.html === "string") sanitizeEditorHtml(entry.html);
        else setEditorText(entry.text);
        fileName = entry.title;
        savedText = getEditorHtml();
        activeNoteId = null;
        activeCreatedAt = null;
        activeUpdatedAt = null;
        textColorPicker.value = entry.color;
        editor.style.color = entry.color;
        historyDialog.close();
        updateStatus();
        updateNoteTimestamp();
        persistDraft();
        editor.focus();
    }

    function deleteHistoryEntry(id) {
        const previousHistory = saveHistory;
        saveHistory = saveHistory.filter((entry) => entry.id !== id);
        if (!persistHistory()) {
            saveHistory = previousHistory;
            showToast("Could not update the save history. Browser storage may be full.");
            return;
        }
        renderSaveHistory();
    }

    function openSavedNote(id) {
        const note = notes.find((item) => item.id === id);
        if (!note) {
            showToast("That saved note could not be found.");
            renderNotes();
            return;
        }

        if (typeof note.html === "string") sanitizeEditorHtml(note.html);
        else setEditorText(note.text);
        fileName = note.title;
        savedText = getEditorHtml();
        activeNoteId = note.id;
        activeCreatedAt = note.createdAt;
        activeUpdatedAt = note.updatedAt;
        textColorPicker.value = note.color;
        editor.style.color = note.color;
        notesDialog.close();
        updateStatus();
        updateNoteTimestamp();
        persistDraft();
        editor.focus();
    }

    function deleteSavedNote(id) {
        if (!window.confirm("Delete this saved note? This cannot be undone.")) return;
        notes = notes.filter((note) => note.id !== id);
        if (!persistNotes()) return;

        if (activeNoteId === id) {
            activeNoteId = null;
            activeCreatedAt = null;
            activeUpdatedAt = null;
            savedText = "";
            fileName = defaultFileName;
            updateStatus();
            updateNoteTimestamp();
            persistDraft();
        }
        renderNotes();
        showToast("Note deleted.");
    }

    function saveNoteFromButton() {
        if (!saveCurrentNote(true)) {
            if (editorContentIsEmpty()) showToast("Write something before saving a note.");
            return;
        }
        savedText = getEditorHtml();
        updateStatus();
        persistDraft();
        recordSaveHistory("notepad", fileName);
    }

    function handleEditorChange() {
        updateStatus();
        persistDraft();
    }

    function updateStatus() {
        const text = getEditorText();
        const { start, end, text: selectedText } = getEditorSelection();
        const beforeCursor = text.slice(0, start);
        const linesBeforeCursor = beforeCursor.split("\n");
        const line = linesBeforeCursor.length;
        const column = linesBeforeCursor[linesBeforeCursor.length - 1].length + 1;
        const characters = text.length;
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        const selected = end - start;

        cursorPosition.textContent = `Ln ${line}, Col ${column}`;
        selectionStatus.textContent = selected
            ? `${selected} selected`
            : `${characters} ${characters === 1 ? "character" : "characters"} · ${words} ${words === 1 ? "word" : "words"}`;
        updateDocumentState();
    }

    function updateZoom() {
        editor.style.fontSize = `${14 * zoom / 100}px`;
        zoomLevel.textContent = `${zoom}%`;
    }

    function updateFont() {
        editor.style.fontFamily = editorFonts[fontPicker.value];
        try {
            localStorage.setItem(`${storageKey}-font`, fontPicker.value);
        } catch (error) {
            console.error("Could not save the font preference.", error);
        }
    }

    function closeMenus() {
        document.querySelectorAll(".menu.open").forEach((menu) => {
            menu.classList.remove("open");
            menu.querySelector(".menu-trigger").setAttribute("aria-expanded", "false");
        });
    }

    function closeMenuAfterAction() {
        closeMenus();
    }

    function confirmDiscard() {
        return getEditorHtml() === savedText || window.confirm("You have unsaved changes. Discard them?");
    }

    function createNewDocument() {
        if (!confirmDiscard()) return;
        editor.replaceChildren();
        renderGridLines();
        selectEditorImage(null);
        fileName = defaultFileName;
        savedText = "";
        activeNoteId = null;
        activeCreatedAt = null;
        activeUpdatedAt = null;
        updateStatus();
        updateNoteTimestamp();
        persistDraft();
        if (notesDialog.open) renderNotes();
        editor.focus();
    }

    function openFilePicker() {
        if (!confirmDiscard()) return;
        filePicker.click();
    }

    function selectEditorImage(image) {
        const nextImage = image && editor.contains(image) ? image : null;
        const changedImage = selectedImage !== nextImage;
        if (selectedImage && changedImage) selectedImage.dataset.rotateMode = "false";
        selectedImage = nextImage;
        imageTools.hidden = !selectedImage;
        if (selectedImage) {
            imageWidthInput.value = String(selectedImage.width || selectedImage.naturalWidth);
            imageZoomLevel.value = `${Math.round((Number(selectedImage.dataset.zoom) || 1) * 100)}%`;
            imageRotateHint.textContent = selectedImage.dataset.rotateMode === "true"
                ? "Rotate mode on — drag the image to turn it."
                : "Drag image to move. Double-click to enable rotation.";
            if (changedImage) {
                ["crop-top", "crop-right", "crop-bottom", "crop-left"].forEach((id) => {
                    document.querySelector(`#${id}`).value = "0";
                });
                selectedImage.style.clipPath = "";
                selectedImage.style.transition = "";
            }
        }
    }

    function updateSelectedImageWidth(value) {
        if (!selectedImage) return;
        const width = Number(value);
        if (!Number.isFinite(width) || width < 20 || width > 2000) {
            imageWidthInput.value = String(selectedImage.width || selectedImage.naturalWidth);
            showToast("Image width must be between 20 and 2000 pixels.");
            return;
        }
        selectedImage.width = Math.round(width);
        imageWidthInput.value = String(selectedImage.width);
        handleEditorChange();
    }

    function rotateSelectedImage(direction) {
        if (!selectedImage) return;
        const currentRotation = Number(selectedImage.dataset.rotation) || 0;
        setImageRotation(selectedImage, currentRotation + direction);
        handleEditorChange();
    }

    function setImageRotation(image, degrees) {
        const rotation = Math.round((((degrees % 360) + 360) % 360) * 10) / 10;
        image.dataset.rotation = String(rotation);
        updateImageTransform(image);
    }

    function updateImagePosition(image) {
        image.style.left = `${Number(image.dataset.x) || 0}px`;
        image.style.top = `${Number(image.dataset.y) || 0}px`;
    }

    function updateImageTransform(image) {
        const rotation = Number(image.dataset.rotation) || 0;
        const offsetX = Number(image.dataset.offsetX) || 0;
        const offsetY = Number(image.dataset.offsetY) || 0;
        const zoom = Number(image.dataset.zoom) || 1;
        image.style.transform = `translate(${offsetX}px, ${offsetY}px) rotate(${rotation}deg) scale(${zoom})`;
    }

    function updateSelectedImageZoom(amount) {
        if (!selectedImage) return;
        const currentZoom = Number(selectedImage.dataset.zoom) || 1;
        const zoom = Math.max(0.25, Math.min(3, Math.round((currentZoom + amount) * 100) / 100));
        selectedImage.dataset.zoom = String(zoom);
        imageZoomLevel.value = `${Math.round(zoom * 100)}%`;
        updateImageTransform(selectedImage);
        handleEditorChange();
    }

    function resetSelectedImageZoom() {
        if (!selectedImage) return;
        selectedImage.dataset.zoom = "1";
        imageZoomLevel.value = "100%";
        updateImageTransform(selectedImage);
        handleEditorChange();
    }

    function toggleImageRotateMode(image) {
        selectEditorImage(image);
        const enabled = image.dataset.rotateMode !== "true";
        image.dataset.rotateMode = String(enabled);
        imageRotateHint.textContent = enabled
            ? "Rotate mode on — drag the image to turn it."
            : "Drag image to move. Double-click to enable rotation.";
    }

    function startImageRotation(event) {
        const image = event.target.closest("img");
        if (!image || event.button !== 0) return;
        selectEditorImage(image);
        const bounds = image.getBoundingClientRect();
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;
        const pointerAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI;
        imagePointerDrag = {
            image,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startOffsetX: Number(image.dataset.offsetX) || 0,
            startOffsetY: Number(image.dataset.offsetY) || 0,
            mode: image.dataset.rotateMode === "true" ? "rotate" : "move",
            centerX,
            centerY,
            lastAngle: pointerAngle,
            rotation: Number(image.dataset.rotation) || 0,
            moved: false
        };
        image.setPointerCapture(event.pointerId);
        event.preventDefault();
    }

    function updateImageRotation(event) {
        if (!imagePointerDrag || event.pointerId !== imagePointerDrag.pointerId) return;
        const drag = imagePointerDrag;
        drag.moved = drag.moved || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 2;
        if (drag.mode === "move") {
            drag.image.dataset.offsetX = String(Math.round(drag.startOffsetX + event.clientX - drag.startX));
            drag.image.dataset.offsetY = String(Math.round(drag.startOffsetY + event.clientY - drag.startY));
            updateImageTransform(drag.image);
            return;
        }
        const angle = Math.atan2(
            event.clientY - drag.centerY,
            event.clientX - drag.centerX
        ) * 180 / Math.PI;
        const delta = ((angle - drag.lastAngle + 540) % 360) - 180;
        drag.lastAngle = angle;
        drag.rotation += delta;
        setImageRotation(drag.image, drag.rotation);
    }

    function finishImageRotation(event) {
        if (!imagePointerDrag || event.pointerId !== imagePointerDrag.pointerId) return;
        const { image, moved } = imagePointerDrag;
        imagePointerDrag = null;
        if (image.hasPointerCapture(event.pointerId)) image.releasePointerCapture(event.pointerId);
        if (moved) handleEditorChange();
    }

    function getImageCropValues() {
        return {
            top: Number(document.querySelector("#crop-top").value),
            right: Number(document.querySelector("#crop-right").value),
            bottom: Number(document.querySelector("#crop-bottom").value),
            left: Number(document.querySelector("#crop-left").value)
        };
    }

    function updateImageCropPreview() {
        if (!selectedImage) return;
        const crop = getImageCropValues();
        if (Object.values(crop).some((amount) => !Number.isFinite(amount) || amount < 0 || amount > 40) ||
            crop.left + crop.right >= 100 || crop.top + crop.bottom >= 100) {
            selectedImage.style.clipPath = "";
            return;
        }
        selectedImage.style.clipPath = `inset(${crop.top}% ${crop.right}% ${crop.bottom}% ${crop.left}%)`;
        selectedImage.style.transition = "clip-path 100ms ease";
    }

    function applyImageCrop() {
        if (!selectedImage) return;
        const crop = getImageCropValues();
        if (Object.values(crop).some((amount) => !Number.isFinite(amount) || amount < 0 || amount > 40) ||
            crop.left + crop.right >= 100 || crop.top + crop.bottom >= 100) {
            showToast("Crop values must be between 0 and 40 percent.");
            return;
        }

        const sourceWidth = selectedImage.naturalWidth;
        const sourceHeight = selectedImage.naturalHeight;
        const sourceX = Math.round(sourceWidth * crop.left / 100);
        const sourceY = Math.round(sourceHeight * crop.top / 100);
        const croppedWidth = sourceWidth - sourceX - Math.round(sourceWidth * crop.right / 100);
        const croppedHeight = sourceHeight - sourceY - Math.round(sourceHeight * crop.bottom / 100);
        if (croppedWidth < 1 || croppedHeight < 1) {
            showToast("Those crop values would remove the whole image.");
            return;
        }

        try {
            const canvas = document.createElement("canvas");
            canvas.width = croppedWidth;
            canvas.height = croppedHeight;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Canvas rendering is unavailable.");
            context.drawImage(selectedImage, sourceX, sourceY, croppedWidth, croppedHeight, 0, 0, croppedWidth, croppedHeight);
            const displayedWidth = selectedImage.width || selectedImage.naturalWidth;
            selectedImage.src = canvas.toDataURL("image/png");
            selectedImage.width = displayedWidth;
            selectedImage.style.clipPath = "";
            selectedImage.style.transition = "";
            ["crop-top", "crop-right", "crop-bottom", "crop-left"].forEach((id) => {
                document.querySelector(`#${id}`).value = "0";
            });
            updateImageTransform(selectedImage);
            handleEditorChange();
        } catch (error) {
            console.error("Could not crop the selected image.", error);
            showToast("Could not crop this image.");
        }
    }

    function deleteSelectedImage() {
        if (!selectedImage) return;
        selectedImage.remove();
        selectEditorImage(null);
        handleEditorChange();
        editor.focus();
    }

    async function readImageFile(file) {
        const supportedTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/avif"]);
        if (!supportedTypes.has(file.type)) {
            showToast("Choose a PNG, JPEG, GIF, WebP, BMP, or AVIF image.");
            return;
        }

        try {
            const source = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.addEventListener("load", () => {
                    if (typeof reader.result === "string") resolve(reader.result);
                    else reject(new Error("The selected image could not be read."));
                }, { once: true });
                reader.addEventListener("error", () => reject(reader.error || new Error("The selected image could not be read.")), { once: true });
                reader.readAsDataURL(file);
            });
            const image = new Image();
            image.src = source;
            await new Promise((resolve, reject) => {
                image.addEventListener("load", resolve, { once: true });
                image.addEventListener("error", () => reject(new Error("The selected image could not be decoded.")), { once: true });
            });

            image.alt = file.name;
            image.contentEditable = "false";
            image.tabIndex = 0;
            image.dataset.x = String(lastCanvasPoint.x);
            image.dataset.y = String(lastCanvasPoint.y);
            updateImagePosition(image);
            if (image.naturalWidth > 2000) image.width = 2000;
            editor.append(image);
            selectEditorImage(image);
            image.focus();
            handleEditorChange();
        } catch (error) {
            console.error("Could not insert the selected image.", error);
            showToast("Could not read or insert that image.");
        }
    }

    async function readSelectedFile() {
        const file = filePicker.files && filePicker.files[0];
        filePicker.value = "";
        if (!file) return;

        try {
            setEditorText(await file.text());
            fileName = file.name;
            savedText = getEditorHtml();
            activeNoteId = null;
            activeCreatedAt = null;
            activeUpdatedAt = null;
            updateStatus();
            updateNoteTimestamp();
            persistDraft();
            editor.focus();
            showToast(`Opened ${file.name}`);
        } catch (error) {
            console.error("Could not open the selected file.", error);
            showToast("Could not read that file.");
        }
    }

    function downloadDocument(usePrompt) {
        const hasImages = Boolean(editor.querySelector("img"));
        const hasCanvasContent = Boolean(editor.querySelector(".canvas-text, img"));
        let outputName = fileName;
        if (usePrompt) {
            const enteredName = window.prompt("Save as", fileName === defaultFileName ? (hasCanvasContent ? "note.html" : "note.txt") : fileName);
            if (enteredName === null) return;
            outputName = enteredName.trim();
            if (!outputName) {
                showToast("Enter a file name to save.");
                return;
            }
            if (!/\.[^\\/.]+$/.test(outputName)) outputName = `${outputName}.txt`;
        } else if (outputName === defaultFileName || !/\.[^\\/.]+$/.test(outputName)) {
            if (outputName === defaultFileName) outputName = "note.txt";
            else outputName = `${outputName}.txt`;
        }
        if (hasCanvasContent) {
            outputName = /\.[^\\/.]+$/.test(outputName)
                ? outputName.replace(/\.[^\\/.]+$/, ".html")
                : `${outputName}.html`;
        }

        try {
            let content = getEditorText().replace(/\r?\n/g, "\r\n");
            let contentType = "text/plain;charset=utf-8";
            if (hasCanvasContent) {
                const safeContent = document.createElement("div");
                safeContent.append(createSanitizedEditorContent(getEditorHtml()));
                if (gridLinesVisible) {
                    for (const axis of Object.keys(gridLinePositions)) {
                        for (const position of gridLinePositions[axis]) {
                            const line = document.createElement("div");
                            line.className = `grid-export-line grid-export-line-${axis}`;
                            line.style[axis === "horizontal" ? "top" : "left"] = `${position}px`;
                            safeContent.append(line);
                        }
                    }
                }
                const escapedTitle = outputName.replace(/[&<>"']/g, (character) => ({
                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#39;"
                })[character]);
                content = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapedTitle}</title><style>body{position:relative;min-width:1600px;min-height:1200px;margin:0;padding:24px;box-sizing:border-box;font:14px/1.8 "Segoe UI",Arial,sans-serif;color:${textColorPicker.value}}.canvas-text{position:absolute;z-index:1;min-width:120px;min-height:28px;max-width:80%;padding:2px;white-space:pre-wrap;overflow-wrap:anywhere}.grid-export-line{position:absolute;z-index:0;background:rgba(116,145,185,.35)}.grid-export-line-horizontal{left:0;width:1600px;height:1px}.grid-export-line-vertical{top:0;width:1px;height:1200px}img{position:absolute;z-index:1;max-width:100%;height:auto;transform-origin:center}</style></head><body>${safeContent.innerHTML}</body></html>`;
                contentType = "text/html;charset=utf-8";
            }
            const blob = new Blob([content], { type: contentType });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = outputName;
            link.hidden = true;
            document.body.append(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            fileName = outputName;
            savedText = getEditorHtml();
            updateStatus();
            persistDraft();
            recordSaveHistory("device", outputName);
            showToast(hasImages ? `Saved ${outputName} with images.` : hasCanvasContent ? `Saved ${outputName} with layout.` : `Saved ${outputName}`);
        } catch (error) {
            console.error("Could not save the document.", error);
            showToast("Could not save the document.");
        }
    }

    async function downloadPdf() {
        let outputName = fileName === defaultFileName ? "note.pdf" : fileName;
        outputName = /\.[^\\/.]+$/.test(outputName)
            ? outputName.replace(/\.[^\\/.]+$/, ".pdf")
            : `${outputName}.pdf`;

        try {
            const width = 1600;
            const height = 1200;
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Canvas rendering is unavailable.");

            context.fillStyle = "#fff";
            context.fillRect(0, 0, width, height);
            context.strokeStyle = "rgba(116, 145, 185, 0.2)";
            context.lineWidth = 1;
            if (gridLinesVisible) {
                for (const y of gridLinePositions.horizontal) {
                    context.beginPath();
                    context.moveTo(0, y + 0.5);
                    context.lineTo(width, y + 0.5);
                    context.stroke();
                }
                for (const x of gridLinePositions.vertical) {
                    context.beginPath();
                    context.moveTo(x + 0.5, 0);
                    context.lineTo(x + 0.5, height);
                    context.stroke();
                }
            }

            for (const image of editor.querySelectorAll("img")) {
                if (!image.complete || !image.naturalWidth) {
                    throw new Error("Wait for all images to finish loading before saving the PDF.");
                }
                const imageWidth = image.width || image.naturalWidth;
                const imageHeight = imageWidth * image.naturalHeight / image.naturalWidth;
                const zoom = Number(image.dataset.zoom) || 1;
                const x = (Number(image.dataset.x) || 0) + (Number(image.dataset.offsetX) || 0) + imageWidth / 2;
                const y = (Number(image.dataset.y) || 0) + (Number(image.dataset.offsetY) || 0) + imageHeight / 2;
                context.save();
                context.translate(x, y);
                context.rotate((Number(image.dataset.rotation) || 0) * Math.PI / 180);
                context.scale(zoom, zoom);
                context.drawImage(image, -imageWidth / 2, -imageHeight / 2, imageWidth, imageHeight);
                context.restore();
            }

            for (const block of editor.querySelectorAll(".canvas-text")) {
                const x = Number(block.dataset.x) || 0;
                const y = Number(block.dataset.y) || 0;
                const style = getComputedStyle(block);
                const fontSize = Number.parseFloat(style.fontSize) || 14;
                const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.8;
                const maxWidth = block.clientWidth || width * 0.8;
                const padding = 2;
                const textNodes = [];
                const collectText = (node) => {
                    if (node.nodeType === Node.TEXT_NODE) {
                        const textStyle = getComputedStyle(node.parentElement || block);
                        textNodes.push({
                            text: node.textContent,
                            fontFamily: textStyle.fontFamily,
                            fontSize: Number.parseFloat(textStyle.fontSize) || fontSize,
                            fontWeight: textStyle.fontWeight,
                            fontStyle: textStyle.fontStyle,
                            color: textStyle.color || style.color || "#000",
                            lineHeight: Number.parseFloat(textStyle.lineHeight) || lineHeight,
                            underline: textStyle.textDecorationLine.includes("underline")
                        });
                        return;
                    }
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    if (node.tagName === "BR") {
                        textNodes.push({ text: "\n" });
                        return;
                    }
                    const isLineBlock = node !== block && ["DIV", "P", "H1", "H2", "LI"].includes(node.tagName);
                    if (isLineBlock && textNodes.length && !textNodes.at(-1).text.endsWith("\n")) {
                        textNodes.push({ text: "\n" });
                    }
                    for (const child of node.childNodes) collectText(child);
                    if (isLineBlock && !textNodes.at(-1)?.text.endsWith("\n")) {
                        textNodes.push({ text: "\n" });
                    }
                };
                collectText(block);
                let cursorX = x + padding;
                let cursorY = y + padding + fontSize;
                let lineHasText = false;
                let currentLineHeight = lineHeight;

                const drawWord = (word, textStyle) => {
                    context.font = `${textStyle.fontStyle} ${textStyle.fontWeight} ${textStyle.fontSize}px ${textStyle.fontFamily}`;
                    context.fillStyle = textStyle.color;
                    const wordWidth = context.measureText(word).width;
                    const spaceWidth = lineHasText ? context.measureText(" ").width : 0;
                    if (cursorX + spaceWidth + wordWidth > x + maxWidth && lineHasText) {
                        cursorX = x + padding;
                        cursorY += Math.max(currentLineHeight, textStyle.lineHeight);
                        lineHasText = false;
                        currentLineHeight = textStyle.lineHeight;
                    } else {
                        cursorX += spaceWidth;
                        currentLineHeight = Math.max(currentLineHeight, textStyle.lineHeight);
                    }
                    context.fillText(word, cursorX, cursorY);
                    if (textStyle.underline) {
                        context.beginPath();
                        context.lineWidth = Math.max(1, textStyle.fontSize / 14);
                        context.moveTo(cursorX, cursorY + 1);
                        context.lineTo(cursorX + wordWidth, cursorY + 1);
                        context.strokeStyle = textStyle.color;
                        context.stroke();
                    }
                    cursorX += wordWidth;
                    lineHasText = true;
                };

                for (const segment of textNodes) {
                    if (segment.text === "\n") {
                        cursorX = x + padding;
                        cursorY += currentLineHeight;
                        lineHasText = false;
                        currentLineHeight = lineHeight;
                        continue;
                    }
                    for (const part of segment.text.split(/(\r?\n|\s+)/)) {
                        if (!part) continue;
                        if (/^\r?\n$/.test(part)) {
                            cursorX = x + padding;
                            cursorY += currentLineHeight;
                            lineHasText = false;
                            currentLineHeight = lineHeight;
                        } else if (/^\s+$/.test(part)) {
                            context.font = `${segment.fontStyle} ${segment.fontWeight} ${segment.fontSize}px ${segment.fontFamily}`;
                            if (lineHasText) cursorX += context.measureText(part.replace(/\t/g, "    ")).width;
                        } else {
                            drawWord(part, segment);
                        }
                    }
                }
            }

            const jpegBlob = await new Promise((resolve, reject) => {
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error("Could not encode the PDF page."));
                }, "image/jpeg", 0.92);
            });
            const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
            const encoder = new TextEncoder();
            const chunks = [];
            let byteLength = 0;
            const append = (chunk) => {
                const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
                chunks.push(bytes);
                byteLength += bytes.length;
            };
            const offsets = [0];
            append("%PDF-1.4\n");
            const addObject = (id, parts) => {
                offsets[id] = byteLength;
                append(`${id} 0 obj\n`);
                for (const part of parts) append(part);
                append("\nendobj\n");
            };
            addObject(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
            addObject(2, ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
            addObject(3, ["<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 631.5] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>"]);
            addObject(4, [
                `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`,
                jpegBytes,
                "\nendstream"
            ]);
            const pageContent = "q\n842 0 0 631.5 0 0 cm\n/Im0 Do\nQ\n";
            addObject(5, [`<< /Length ${encoder.encode(pageContent).length} >>\nstream\n${pageContent}endstream`]);
            const xrefOffset = byteLength;
            append(`xref\n0 6\n0000000000 65535 f \n`);
            for (let id = 1; id <= 5; id += 1) append(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
            append(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
            const pdfBlob = new Blob(chunks, { type: "application/pdf" });
            const url = URL.createObjectURL(pdfBlob);
            const link = document.createElement("a");
            link.href = url;
            link.download = outputName;
            link.hidden = true;
            document.body.append(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
            fileName = outputName;
            savedText = getEditorHtml();
            updateStatus();
            persistDraft();
            recordSaveHistory("device", outputName);
            showToast(`Downloaded ${outputName} as PDF.`);
        } catch (error) {
            console.error("Could not create the PDF document.", error);
            showToast(error instanceof Error ? error.message : "Could not create the PDF document.");
        }
    }

    function selectAll() {
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        updateStatus();
    }

    function setFindMode(replaceMode) {
        document.querySelector("#find-title").textContent = replaceMode ? "Find and replace" : "Find";
        replaceFields.hidden = !replaceMode;
        findFeedback.textContent = "";
        if (!findDialog.open) findDialog.show();
        findInput.focus();
        findInput.select();
    }

    function findNext() {
        const query = findInput.value;
        if (!query) {
            findFeedback.textContent = "Enter text to find.";
            findInput.focus();
            return false;
        }

        const source = getEditorText();
        const selection = getEditorSelection();
        const caseSensitive = document.querySelector("#match-case").checked;
        const haystack = caseSensitive ? source : source.toLocaleLowerCase();
        const needle = caseSensitive ? query : query.toLocaleLowerCase();
        let foundAt = haystack.indexOf(needle, selection.end);
        if (foundAt === -1 && selection.end > 0) foundAt = haystack.indexOf(needle, 0);

        if (foundAt === -1) {
            findFeedback.textContent = "No matches found.";
            return false;
        }

        editor.focus();
        setEditorSelection(foundAt, foundAt + query.length);
        updateStatus();
        findFeedback.textContent = "";
        return true;
    }

    function replaceOne() {
        const query = findInput.value;
        if (!query) {
            findFeedback.textContent = "Enter text to find.";
            return;
        }

        const { start, end, text: selectedText } = getEditorSelection();
        const caseSensitive = document.querySelector("#match-case").checked;
        const matches = caseSensitive
            ? selectedText === query
            : selectedText.toLocaleLowerCase() === query.toLocaleLowerCase();

        if (!matches) {
            findNext();
            return;
        }

        replaceEditorSelection(replaceInput.value);
        handleEditorChange();
        findNext();
    }

    function replaceAll() {
        const query = findInput.value;
        if (!query) {
            findFeedback.textContent = "Enter text to find.";
            return;
        }

        const flags = document.querySelector("#match-case").checked ? "g" : "gi";
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const expression = new RegExp(escapedQuery, flags);
        let replacements = 0;
        const source = getEditorText();
        const matches = [...source.matchAll(expression)];
        replacements = matches.length;

        if (replacements) {
            matches.reverse().forEach((match) => {
                setEditorSelection(match.index, match.index + match[0].length);
                replaceEditorSelection(replaceInput.value);
            });
            handleEditorChange();
        }
        findFeedback.textContent = `${replacements} ${replacements === 1 ? "replacement" : "replacements"} made.`;
        editor.focus();
    }

    function goToLine() {
        const lines = getEditorText().split("\n");
        lineCount.textContent = String(lines.length);
        lineInput.max = String(lines.length);
        lineInput.value = String(Math.min(lines.length, Number(lineInput.value) || 1));
        lineDialog.showModal();
        lineInput.focus();
        lineInput.select();
    }

    function jumpToLine() {
        const lines = getEditorText().split("\n");
        const requestedLine = Number(lineInput.value);
        if (!Number.isInteger(requestedLine) || requestedLine < 1 || requestedLine > lines.length) {
            showToast(`Enter a line number from 1 to ${lines.length}.`);
            return;
        }
        const offset = lines.slice(0, requestedLine - 1).reduce((total, current) => total + current.length + 1, 0);
        lineDialog.close();
        editor.focus();
        setEditorSelection(offset);
        updateStatus();
    }

    async function copySelection(cut) {
        const { start, end, text: selectedText } = getEditorSelection();
        if (start === end) return;

        try {
            await navigator.clipboard.writeText(selectedText);
        } catch (error) {
            console.warn("Clipboard API unavailable; using the browser copy command.", error);
            editor.focus();
            document.execCommand("copy");
        }

        if (cut) {
            setEditorSelection(start, end);
            replaceEditorSelection("");
            handleEditorChange();
        }
    }

    async function pasteFromClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            replaceEditorSelection(text);
            handleEditorChange();
        } catch (error) {
            console.warn("Clipboard API unavailable; using the browser paste command.", error);
            editor.focus();
            if (!document.execCommand("paste")) {
                showToast("Clipboard access was denied. Use your browser's paste shortcut.");
            }
        }
    }

    function performAction(action) {
        closeMenuAfterAction();
        switch (action) {
            case "new":
                createNewDocument();
                break;
            case "open":
                openFilePicker();
                break;
            case "insert-image":
                imagePicker.click();
                break;
            case "save":
                saveDialog.showModal();
                break;
            case "save-note":
                saveDialog.close();
                saveNoteFromButton();
                break;
            case "save-device":
                saveDialog.close();
                void downloadPdf();
                break;
            case "format-topic":
                applyBlockFormat("h1");
                break;
            case "format-key-point":
                applyBlockFormat("h2");
                break;
            case "format-normal":
                applyBlockFormat("div");
                break;
            case "underline":
                applyInlineFormat("underline");
                break;
            case "notes":
                renderNotes();
                notesDialog.showModal();
                break;
            case "history":
                renderSaveHistory();
                historyDialog.showModal();
                break;
            case "print":
                window.print();
                break;
            case "undo":
                editor.focus();
                document.execCommand("undo");
                handleEditorChange();
                break;
            case "redo":
                editor.focus();
                document.execCommand("redo");
                handleEditorChange();
                break;
            case "cut":
                void copySelection(true);
                break;
            case "copy":
                void copySelection(false);
                break;
            case "paste":
                void pasteFromClipboard();
                break;
            case "select-all":
                selectAll();
                break;
            case "find":
                setFindMode(false);
                break;
            case "replace":
                setFindMode(true);
                break;
            case "go-to":
                goToLine();
                break;
            case "word-wrap": {
                const button = document.querySelector('[data-action="word-wrap"]');
                const enabled = button.getAttribute("aria-checked") !== "true";
                button.setAttribute("aria-checked", String(enabled));
                editor.style.whiteSpace = enabled ? "pre-wrap" : "pre";
                editor.style.overflowX = enabled ? "hidden" : "auto";
                break;
            }
            case "status-bar": {
                const button = document.querySelector('[data-action="status-bar"]');
                const enabled = button.getAttribute("aria-checked") !== "true";
                button.setAttribute("aria-checked", String(enabled));
                document.body.classList.toggle("no-status", !enabled);
                break;
            }
            case "zoom-in":
                zoom = Math.min(200, zoom + 10);
                updateZoom();
                break;
            case "zoom-out":
                zoom = Math.max(50, zoom - 10);
                updateZoom();
                break;
            case "zoom-reset":
                zoom = 100;
                updateZoom();
                break;
        }
    }

    document.querySelectorAll(".menu-trigger").forEach((trigger) => {
        trigger.addEventListener("click", () => {
            const menu = trigger.closest(".menu");
            const willOpen = !menu.classList.contains("open");
            closeMenus();
            if (willOpen) {
                menu.classList.add("open");
                trigger.setAttribute("aria-expanded", "true");
            }
        });
    });

    document.addEventListener("click", (event) => {
        if (!event.target.closest(".menu")) closeMenus();
        const actionButton = event.target.closest("[data-action]");
        if (actionButton) performAction(actionButton.dataset.action);
    });
    document.querySelectorAll(".format-button").forEach((button) => {
        button.addEventListener("mousedown", (event) => event.preventDefault());
    });
    document.querySelectorAll(".format-menu-item").forEach((button) => {
        button.addEventListener("mousedown", (event) => event.preventDefault());
    });
    document.querySelectorAll(".menu-panel button, #replace-one, #replace-all").forEach((button) => {
        button.addEventListener("mousedown", (event) => event.preventDefault());
    });

    document.querySelector("#theme-toggle").addEventListener("click", () => {
        const isDark = document.body.classList.toggle("dark");
        document.querySelector("#theme-toggle").setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
        try {
            localStorage.setItem(`${storageKey}-theme`, isDark ? "dark" : "light");
        } catch (error) {
            console.error("Could not save the theme preference.", error);
        }
    });
    fontPicker.addEventListener("change", updateFont);
    textColorPicker.addEventListener("input", () => {
        editor.style.color = textColorPicker.value;
        try {
            localStorage.setItem(`${storageKey}-color`, textColorPicker.value);
        } catch (error) {
            console.error("Could not save the text color preference.", error);
        }
        persistDraft();
    });

    editor.addEventListener("input", () => {
        handleEditorChange();
    });
    editor.addEventListener("keyup", updateStatus);
    editor.addEventListener("click", updateStatus);
    editor.addEventListener("click", (event) => {
        if (pendingGridLineAxis) {
            const point = canvasPointFromEvent(event);
            addGridLine(pendingGridLineAxis, pendingGridLineAxis === "horizontal" ? point.y : point.x);
            event.preventDefault();
            return;
        }
        const image = event.target.closest("img");
        if (image) {
            lastCanvasPoint = canvasPointFromEvent(event);
            selectEditorImage(image);
            image.focus({ preventScroll: true });
        } else if (event.target === editor) {
            lastCanvasPoint = canvasPointFromEvent(event);
            editor.querySelectorAll(".canvas-text:empty").forEach((block) => block.remove());
            placeTextAt(lastCanvasPoint);
            handleEditorChange();
        }
    });
    editor.addEventListener("dblclick", (event) => {
        const image = event.target.closest("img");
        if (!image) return;
        event.preventDefault();
        toggleImageRotateMode(image);
    });
    editor.addEventListener("pointerdown", (event) => {
        lastCanvasPoint = canvasPointFromEvent(event);
        startImageRotation(event);
    });
    editor.addEventListener("pointermove", updateImageRotation);
    editor.addEventListener("pointermove", moveGridLineFromPointer);
    editor.addEventListener("pointerup", (event) => {
        finishImageRotation(event);
        finishGridLineDrag(event);
    });
    editor.addEventListener("pointercancel", (event) => {
        finishImageRotation(event);
        finishGridLineDrag(event);
    });
    document.addEventListener("selectionchange", () => {
        const selection = window.getSelection();
        if (selection?.rangeCount && editor.contains(selection.anchorNode)) {
            lastEditorRange = selection.getRangeAt(0).cloneRange();
            updateStatus();
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") cancelGridLinePlacement();
    });
    editor.addEventListener("keydown", (event) => {
        if ((event.key === "Delete" || event.key === "Backspace") &&
            selectedImage && document.activeElement === selectedImage) {
            event.preventDefault();
            selectedImage.remove();
            selectEditorImage(null);
            handleEditorChange();
            return;
        }
        if (event.key === "Tab") {
            event.preventDefault();
            replaceEditorSelection("    ");
            handleEditorChange();
        }
    });
    document.querySelector('[data-action="insert-image"]').addEventListener("mousedown", (event) => event.preventDefault());
    imagePicker.addEventListener("change", () => {
        const file = imagePicker.files && imagePicker.files[0];
        imagePicker.value = "";
        if (file) void readImageFile(file);
    });
    imageWidthInput.addEventListener("change", () => updateSelectedImageWidth(imageWidthInput.value));
    document.querySelector("#image-smaller").addEventListener("click", () => {
        if (selectedImage) updateSelectedImageWidth(Math.max(20, selectedImage.width - 20));
    });
    document.querySelector("#image-larger").addEventListener("click", () => {
        if (selectedImage) updateSelectedImageWidth(Math.min(2000, selectedImage.width + 20));
    });
    document.querySelector("#image-zoom-out").addEventListener("click", () => updateSelectedImageZoom(-0.25));
    document.querySelector("#image-zoom-in").addEventListener("click", () => updateSelectedImageZoom(0.25));
    document.querySelector("#image-zoom-reset").addEventListener("click", resetSelectedImageZoom);
    document.querySelector("#rotate-left").addEventListener("click", () => rotateSelectedImage(-90));
    document.querySelector("#rotate-right").addEventListener("click", () => rotateSelectedImage(90));
    ["crop-top", "crop-right", "crop-bottom", "crop-left"].forEach((id) => {
        document.querySelector(`#${id}`).addEventListener("input", updateImageCropPreview);
    });
    document.querySelector("#apply-crop").addEventListener("click", applyImageCrop);
    document.querySelector("#delete-image").addEventListener("click", deleteSelectedImage);

    document.querySelector("#find-form").addEventListener("submit", (event) => {
        event.preventDefault();
        findNext();
    });
    document.querySelector("#line-form").addEventListener("submit", (event) => {
        event.preventDefault();
        jumpToLine();
    });

    document.addEventListener("keydown", (event) => {
        const key = event.key.toLowerCase();
        const modifier = event.ctrlKey || event.metaKey;
        const target = event.target instanceof Element ? event.target : null;
        const isTextEditor = Boolean(target?.closest(".canvas-text"));
        const canvasHasFocus = target === editor || target === document.body || target === selectedImage;

        if (canvasHasFocus && !isTextEditor && selectedImage && !event.altKey && !event.ctrlKey && !event.metaKey) {
            if (key === "delete" || key === "backspace") {
                event.preventDefault();
                deleteSelectedImage();
                return;
            }
            if (event.key.length === 1) {
                event.preventDefault();
                placeTextAt(lastCanvasPoint, event.key);
                handleEditorChange();
                return;
            }
        }

        if (event.key === "Escape") closeMenus();
        if (!modifier) return;
        if (key === "a" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            event.target.select();
            return;
        }

        const actions = {
            n: "new",
            o: "open",
            s: "save",
            p: "print",
            f: "find",
            h: "replace",
            g: "go-to",
            a: "select-all"
        };
        if (actions[key]) {
            event.preventDefault();
            performAction(actions[key]);
        } else if (key === "+" || key === "=") {
            event.preventDefault();
            performAction("zoom-in");
        } else if (key === "-") {
            event.preventDefault();
            performAction("zoom-out");
        } else if (key === "0") {
            event.preventDefault();
            performAction("zoom-reset");
        }
    });

    document.querySelector("#find-next").addEventListener("click", findNext);
    document.querySelector("#replace-one").addEventListener("click", replaceOne);
    document.querySelector("#replace-all").addEventListener("click", replaceAll);
    document.querySelector("#go-to-confirm").addEventListener("click", (event) => {
        event.preventDefault();
        jumpToLine();
    });
    document.querySelectorAll(".close-dialog, [data-close-dialog]").forEach((button) => {
        button.addEventListener("click", () => button.closest("dialog").close());
    });
    document.querySelector("#new-note-button").addEventListener("click", () => {
        notesDialog.close();
        createNewDocument();
    });
    notesList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-note-action]");
        if (!button) return;
        if (button.dataset.noteAction === "open") openSavedNote(button.dataset.noteId);
        if (button.dataset.noteAction === "delete") deleteSavedNote(button.dataset.noteId);
    });
    historyList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-history-action]");
        if (!button) return;
        if (button.dataset.historyAction === "open") openHistoryEntry(button.dataset.historyId);
        if (button.dataset.historyAction === "delete") deleteHistoryEntry(button.dataset.historyId);
    });
    filePicker.addEventListener("change", () => void readSelectedFile());

    window.addEventListener("beforeunload", (event) => {
        if (getEditorHtml() !== savedText) {
            event.preventDefault();
            event.returnValue = "";
        }
    });

    try {
        const storedNotes = localStorage.getItem(notesStorageKey);
        if (storedNotes) {
            const parsedNotes = JSON.parse(storedNotes);
            if (Array.isArray(parsedNotes)) {
                notes = parsedNotes.filter((note) =>
                    note &&
                    typeof note.id === "string" &&
                    typeof note.title === "string" &&
                    typeof note.text === "string" &&
                    typeof note.color === "string" &&
                    Number.isFinite(note.createdAt) &&
                    Number.isFinite(note.updatedAt)
                );
            }
        }
        const storedHistory = localStorage.getItem(historyStorageKey);
        if (storedHistory) {
            const parsedHistory = JSON.parse(storedHistory);
            if (Array.isArray(parsedHistory)) {
                saveHistory = parsedHistory.filter((entry) =>
                    entry &&
                    typeof entry.id === "string" &&
                    (entry.destination === "notepad" || entry.destination === "device") &&
                    typeof entry.title === "string" &&
                    typeof entry.text === "string" &&
                    typeof entry.html === "string" &&
                    typeof entry.color === "string" &&
                    Number.isFinite(entry.savedAt)
                ).slice(0, 50);
            }
        }
        const savedTheme = localStorage.getItem(`${storageKey}-theme`);
        if (savedTheme === "dark") {
            document.body.classList.add("dark");
            document.querySelector("#theme-toggle").setAttribute("aria-label", "Switch to light theme");
        }
        const savedFont = localStorage.getItem(`${storageKey}-font`);
        if (savedFont && Object.hasOwn(editorFonts, savedFont)) {
            fontPicker.value = savedFont;
        }
        const savedColor = localStorage.getItem(`${storageKey}-color`);
        if (savedColor && /^#[\da-f]{6}$/i.test(savedColor)) {
            textColorPicker.value = savedColor;
        }
        initializeGridLines();
        const draft = localStorage.getItem(storageKey);
        if (draft) {
            const recovered = JSON.parse(draft);
            if (typeof recovered.text === "string" && typeof recovered.fileName === "string") {
                if (typeof recovered.html === "string") sanitizeEditorHtml(recovered.html);
                else setEditorText(recovered.text);
                fileName = ["Untitled", "KEEP FOR LATTER USE"].includes(recovered.fileName)
                    ? defaultFileName
                    : recovered.fileName;
                savedText = typeof recovered.savedHtml === "string"
                    ? recovered.savedHtml === recovered.html
                        ? getEditorHtml()
                        : recovered.savedHtml
                    : recovered.savedText === recovered.text
                        ? getEditorHtml()
                        : `legacy:${recovered.savedText || ""}`;
                activeNoteId = typeof recovered.activeNoteId === "string" &&
                    notes.some((note) => note.id === recovered.activeNoteId)
                    ? recovered.activeNoteId
                    : null;
                activeCreatedAt = activeNoteId && Number.isFinite(recovered.activeCreatedAt)
                    ? recovered.activeCreatedAt
                    : null;
                activeUpdatedAt = activeNoteId && Number.isFinite(recovered.activeUpdatedAt)
                    ? recovered.activeUpdatedAt
                    : null;
                if (typeof recovered.color === "string" && /^#[\da-f]{6}$/i.test(recovered.color)) {
                    textColorPicker.value = recovered.color;
                }
                if (getEditorText()) showToast("Recovered your last draft.");
            }
        }
    } catch (error) {
        console.error("Could not restore the saved draft.", error);
        showToast("Could not restore the saved draft.");
    }

    updateStatus();
    updateZoom();
    editor.style.fontFamily = editorFonts[fontPicker.value];
    editor.style.color = textColorPicker.value;
    updateNoteTimestamp();
    editor.focus();
})();
