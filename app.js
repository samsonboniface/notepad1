(() => {
    const editor = document.querySelector("#editor");
    const filePicker = document.querySelector("#file-picker");
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
    const notesStorageKey = `${storageKey}-notes`;
    const historyStorageKey = `${storageKey}-history`;
    const appTitle = "MY Notepad";
    const defaultFileName = "KEEP FOR LETTRE USE";
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

    function getEditorText() {
        return editor.innerText.replace(/\r/g, "").replace(/\u00a0/g, " ");
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
            editor.focus();
            selection.removeAllRanges();
            selection.addRange(lastEditorRange);
        } else {
            lastEditorRange = selection.getRangeAt(0).cloneRange();
        }
        const range = selection.getRangeAt(0);
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
        editor.textContent = text;
        lastEditorRange = null;
    }

    function sanitizeEditorHtml(html) {
        const template = document.createElement("template");
        template.innerHTML = html;
        const allowedTags = new Set(["BR", "DIV", "P", "H1", "H2", "STRONG", "B", "EM", "I", "U", "UL", "OL", "LI"]);
        const cleanNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
            if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
            const fragment = document.createDocumentFragment();
            for (const child of node.childNodes) fragment.append(cleanNode(child));
            if (!allowedTags.has(node.tagName)) return fragment;
            const cleanElement = document.createElement(node.tagName.toLowerCase());
            cleanElement.append(fragment);
            return cleanElement;
        };
        const clean = document.createDocumentFragment();
        for (const node of template.content.childNodes) clean.append(cleanNode(node));
        editor.replaceChildren(clean);
        lastEditorRange = null;
    }

    function editorContentIsEmpty() {
        return !getEditorText().trim();
    }

    function applyBlockFormat(tagName) {
        const selection = window.getSelection();
        if (!selection) return;
        if (!selection.rangeCount || !editor.contains(selection.anchorNode)) {
            selection.removeAllRanges();
            if (lastEditorRange && editor.contains(lastEditorRange.commonAncestorContainer)) {
                selection.addRange(lastEditorRange);
            } else {
                editor.focus();
                const range = document.createRange();
                range.selectNodeContents(editor);
                range.collapse(false);
                selection.addRange(range);
            }
        }
        if (!editor.contains(selection.anchorNode)) {
            return;
        }
        editor.focus();
        document.execCommand("formatBlock", false, tagName);
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
        const dirty = editor.innerHTML !== savedText;
        unsavedIndicator.hidden = !dirty;
        documentName.textContent = fileName;
        document.title = `${dirty ? "● " : ""}${fileName} - ${appTitle}`;
        emptyHint.hidden = getEditorText().length > 0;
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
                html: editor.innerHTML,
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
            html: editor.innerHTML,
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
            html: editor.innerHTML,
            color: textColorPicker.value,
            createdAt: activeCreatedAt,
            updatedAt: activeUpdatedAt
        };
        notes = [record, ...notes.filter((note) => note.id !== activeNoteId)];
        if (!persistNotes()) return false;

        fileName = record.title;
        savedText = editor.innerHTML;
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
        if (editor.innerHTML !== savedText && !window.confirm("Discard your unsaved changes and open this saved version?")) return;

        if (typeof entry.html === "string") sanitizeEditorHtml(entry.html);
        else setEditorText(entry.text);
        fileName = entry.title;
        savedText = editor.innerHTML;
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
        savedText = editor.innerHTML;
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
        savedText = editor.innerHTML;
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
        return editor.innerHTML === savedText || window.confirm("You have unsaved changes. Discard them?");
    }

    function createNewDocument() {
        if (!confirmDiscard()) return;
        editor.replaceChildren();
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

    async function readSelectedFile() {
        const file = filePicker.files && filePicker.files[0];
        filePicker.value = "";
        if (!file) return;

        try {
            setEditorText(await file.text());
            fileName = file.name;
            savedText = editor.innerHTML;
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
        let outputName = fileName;
        if (usePrompt) {
            const enteredName = window.prompt("Save as", fileName === defaultFileName ? "note.txt" : fileName);
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

        try {
            const content = getEditorText().replace(/\r?\n/g, "\r\n");
            const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
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
            savedText = editor.innerHTML;
            updateStatus();
            persistDraft();
            recordSaveHistory("device", outputName);
            showToast(`Saved ${outputName}`);
        } catch (error) {
            console.error("Could not save the document.", error);
            showToast("Could not save the document.");
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
        if (!findDialog.open) findDialog.showModal();
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
            case "save":
                saveDialog.showModal();
                break;
            case "save-note":
                saveDialog.close();
                saveNoteFromButton();
                break;
            case "save-device":
                saveDialog.close();
                downloadDocument(true);
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
    document.addEventListener("selectionchange", () => {
        const selection = window.getSelection();
        if (selection?.rangeCount && editor.contains(selection.anchorNode)) {
            lastEditorRange = selection.getRangeAt(0).cloneRange();
            updateStatus();
        }
    });
    editor.addEventListener("keydown", (event) => {
        if (event.key === "Tab") {
            event.preventDefault();
            replaceEditorSelection("    ");
            handleEditorChange();
        }
    });

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
        if (editor.innerHTML !== savedText) {
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
                    ? recovered.savedHtml
                    : recovered.savedText === recovered.text
                        ? editor.innerHTML
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
