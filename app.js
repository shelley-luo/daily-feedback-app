(function () {
  'use strict';

  const DB_NAME = 'DailyFeedbackDB';
  const STORE_NAME = 'feedback';
  const DB_VERSION = 1;

  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      if (db) {
        resolve(db);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        db = req.result;
        resolve(db);
      };
      req.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('member', 'member', { unique: false });
          store.createIndex('dateMember', ['date', 'member'], { unique: false });
        }
      };
    });
  }

  function getAllFeedback() {
    return openDB().then((database) => {
      return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    });
  }

  function addFeedback(item) {
    return openDB().then((database) => {
      return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const record = {
          date: item.date,
          member: (item.member || '').trim(),
          note: (item.note || '').trim(),
          images: item.images || [],
          itemDones: item.itemDones || [],
          createdAt: new Date().toISOString(),
        };
        const req = store.add(record);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    });
  }

  function updateFeedback(id, item) {
    return openDB().then((database) => {
      return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const record = {
          id: id,
          date: item.date,
          member: (item.member || '').trim(),
          note: (item.note || '').trim(),
          images: item.images || [],
          itemDones: item.itemDones || [],
          createdAt: item.createdAt || new Date().toISOString(),
        };
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }

  function deleteFeedback(id) {
    return openDB().then((database) => {
      return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function getUniqueMembers(list) {
    const set = new Set();
    list.forEach((item) => {
      if (item.member) set.add(item.member);
    });
    return Array.from(set).sort();
  }

  function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // ---------- DOM ----------
  const filterDate = document.getElementById('filter-date');
  const filterMember = document.getElementById('filter-member');
  const btnApplyFilter = document.getElementById('btn-apply-filter');
  const feedbackList = document.getElementById('feedback-list');
  const emptyHint = document.getElementById('empty-hint');
  const addForm = document.getElementById('add-form');
  const addDate = document.getElementById('add-date');
  const addMember = document.getElementById('add-member');
  const addNote = document.getElementById('add-note');
  const addImages = document.getElementById('add-images');
  const imagePreview = document.getElementById('image-preview');
  const memberList = document.getElementById('member-list');
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');
  const btnExport = document.getElementById('btn-export');
  const inputImport = document.getElementById('input-import');
  const remoteUrl = document.getElementById('remote-url');
  const btnLoadRemote = document.getElementById('btn-load-remote');
  const btnUseLocal = document.getElementById('btn-use-local');
  const remoteHint = document.getElementById('remote-hint');

  let pendingImages = []; // 待提交的图片 base64
  let remoteData = null; // 从链接加载的数据，为 null 时使用本地 DB
  let remoteDataUrl = ''; // 当前加载的远程数据链接，用于保存组员打勾状态
  let editingId = null; // 正在编辑的反馈 id，为 null 表示新增

  const REMOTE_DONES_KEY = 'daily-feedback-remote-dones';

  function getRemoteDonesStore() {
    try {
      const raw = localStorage.getItem(REMOTE_DONES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function getRemoteDones(url, item) {
    if (!url) return undefined;
    const key = `${item.date}_${item.member}_${(item.createdAt || '')}`;
    const store = getRemoteDonesStore();
    const byUrl = store[url];
    return byUrl && byUrl[key] ? byUrl[key] : undefined;
  }

  function setRemoteDones(url, item, itemDones) {
    if (!url) return;
    const key = `${item.date}_${item.member}_${(item.createdAt || '')}`;
    const store = getRemoteDonesStore();
    if (!store[url]) store[url] = {};
    store[url][key] = itemDones;
    try {
      localStorage.setItem(REMOTE_DONES_KEY, JSON.stringify(store));
    } catch (e) {}
  }

  // 默认日期为今天
  addDate.value = todayStr();
  filterDate.value = todayStr();

  // 切换模式
  document.querySelectorAll('.mode-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.mode-tabs .tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.mode-panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.getAttribute('data-mode');
      document.getElementById(mode + '-mode').classList.add('active');
      if (mode === 'view') {
        applyFilter();
      }
    });
  });

  // 刷新成员列表（下拉与 datalist）
  function refreshMemberOptions(items) {
    const members = getUniqueMembers(items);
    filterMember.innerHTML = '<option value="">全部组员</option>' + members.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    memberList.innerHTML = members.map((m) => `<option value="${escapeHtml(m)}">`).join('');
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function isNoteHtml(note) {
    return typeof note === 'string' && note.includes('<');
  }

  // 展示前去掉笔记里的表单控件（input/select/button），避免粘贴或误插入的日期框等破坏排版
  function sanitizeNoteHtml(html) {
    if (!html || typeof html !== 'string') return html;
    try {
      const wrap = document.createElement('div');
      wrap.innerHTML = html;
      wrap.querySelectorAll('input, select, button').forEach((el) => {
        const span = document.createElement('span');
        if (el.tagName === 'INPUT' && (el.type === 'date' || el.type === 'text' || el.type === 'datetime-local')) {
          span.textContent = el.value || '';
        } else if (el.tagName === 'SELECT') {
          span.textContent = el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : '';
        } else {
          span.textContent = el.value != null ? el.value : el.textContent || '';
        }
        span.className = 'note-sanitized-value';
        el.parentNode.replaceChild(span, el);
      });
      return wrap.innerHTML;
    } catch (e) {
      return html;
    }
  }

  // 判断是否为「仅单个 HTML 标签」（如 <p>、<div>、<br>），这类片段会导致后续内容被错误缩进
  function isOnlySingleTag(s) {
    const t = (s || '').trim();
    return t.length > 0 && /^<(\w+)(\s[^>]*)?\/?>$/.test(t) || t === '<br>';
  }

  // 去掉末尾未闭合的开标签（如 </p><p>、</div><div>），避免下一行被包进同一块导致缩进
  function stripTrailingOpenTag(html) {
    if (!html || typeof html !== 'string') return html;
    return html.replace(/(<\s*\/\s*\w+\s*>)\s*(<\s*\w+(\s[^>]*)?\s*>)\s*$/, '$1').replace(/(<\s*\w+(\s[^>]*)?\s*>)\s*$/, '');
  }

  // 将修改要点按「1. 2. 3.」拆成多条（数字 + 点 + 至少一个空格或 &nbsp;）
  // 同时识别普通空格和 &nbsp;，避免加字号等格式后圆圈消失
  function parseNoteIntoItems(html) {
    if (!html || typeof html !== 'string') return { segments: [], itemCount: 0 };
    const itemStart = /(?=\d+[\.．](?:\s|&nbsp;)+)/;
    const segments = html.split(itemStart);
    const result = segments.map((content) => {
      const isItem = /\d+[\.．](?:\s|&nbsp;)+/.test(content);
      return { content: content.trim(), contentRaw: content, isItem };
    }).filter((s) => s.content.length > 0);
    const itemCount = result.filter((s) => s.isItem).length;
    return { segments: result, itemCount };
  }

  function renderNoteContent(item) {
    const note = item.note;
    if (!note) return '';
    const noteHtml = isNoteHtml(note);
    const parsed = parseNoteIntoItems(note);
    const itemDones = Array.isArray(item.itemDones) ? item.itemDones : [];
    const canToggle = parsed.itemCount > 0;

    if (parsed.itemCount === 0) {
      if (noteHtml) return '<div class="feedback-card-note">' + sanitizeNoteHtml(note) + '</div>';
      return '<div class="feedback-card-note note-is-text">' + escapeHtml(note) + '</div>';
    }

    let itemIndex = 0;
    let html = '<div class="feedback-card-note feedback-card-note-items">';
    parsed.segments.forEach((seg) => {
      if (seg.isItem) {
        const done = itemDones[itemIndex] === true;
        const idx = itemIndex;
        itemIndex++;
        const checkClass = done ? 'note-item-check done' : 'note-item-check';
        const contentClass = done ? 'note-item-content note-item-done' : 'note-item-content';
        const label = done ? '取消完成' : '标记完成';
        const safeContent = sanitizeNoteHtml(stripTrailingOpenTag(seg.contentRaw));
        html += '<div class="note-item-row">';
        html += `<span class="${checkClass}" role="button" tabindex="0" data-item-idx="${idx}" data-done="${done}" title="${label}" aria-label="${label}">${done ? '✓' : '○'}</span>`;
        html += `<div class="${contentClass}">${safeContent}</div>`;
        html += '</div>';
      } else if (!isOnlySingleTag(seg.contentRaw)) {
        html += '<div class="note-item-intro">' + sanitizeNoteHtml(seg.contentRaw) + '</div>';
      }
    });
    html += '</div>';
    return html;
  }

  // 筛选并渲染列表（items 可为本地 DB 或 remoteData）
  function renderFilteredItems(items) {
    const dateVal = filterDate.value;
    const memberVal = (filterMember.value || '').trim();
    // 先保存当前选中的组员，刷新选项后再恢复，避免筛选后跳回「全部组员」
    const selectedMember = filterMember.value || '';
    refreshMemberOptions(items);
    filterMember.value = selectedMember;

    let filtered = items;
    if (dateVal) filtered = filtered.filter((i) => i.date === dateVal);
    if (memberVal) filtered = filtered.filter((i) => i.member === memberVal);
    filtered.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    const canEdit = remoteData === null;

    feedbackList.innerHTML = '';
    if (filtered.length === 0) {
      emptyHint.classList.remove('hidden');
      return;
    }
    emptyHint.classList.add('hidden');
    filtered.forEach((item) => {
      const displayItem =
        remoteData && remoteDataUrl
          ? { ...item, itemDones: getRemoteDones(remoteDataUrl, item) ?? item.itemDones ?? [] }
          : item;
      const card = document.createElement('div');
      card.className = 'feedback-card';
      card.setAttribute('data-id', item.id != null ? item.id : '');
      const imagesHtml =
        (item.images && item.images.length)
          ? `<div class="feedback-card-images">${item.images
              .map(
                (src, idx) =>
                  `<img src="${src}" alt="反馈图${idx + 1}" data-full="${escapeHtml(src)}" />`
              )
              .join('')}</div>`
          : '';
      const actionsHtml =
        canEdit && item.id != null
          ? `<div class="feedback-card-actions">
              <button type="button" class="btn-card btn-edit" data-id="${item.id}">编辑</button>
              <button type="button" class="btn-card btn-delete" data-id="${item.id}">删除</button>
            </div>`
          : '';
      card.innerHTML = `
        <div class="feedback-card-header">
          <span class="feedback-card-member">${escapeHtml(item.member)}</span>
          <span class="feedback-card-date">${escapeHtml(item.date)}</span>
          ${actionsHtml}
        </div>
        <div class="feedback-card-body">
          ${item.note ? renderNoteContent(displayItem) : ''}
          ${imagesHtml}
        </div>
      `;
      card.querySelectorAll('.feedback-card-images img').forEach((img) => {
        img.addEventListener('click', () => openPreview(item));
      });
      card.querySelectorAll('.note-item-check').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          toggleItemDone(item, parseInt(el.getAttribute('data-item-idx'), 10));
        });
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleItemDone(item, parseInt(el.getAttribute('data-item-idx'), 10));
          }
        });
      });
      if (canEdit && item.id != null) {
        const editBtn = card.querySelector('.btn-edit');
        const deleteBtn = card.querySelector('.btn-delete');
        if (editBtn) editBtn.addEventListener('click', () => startEdit(item));
        if (deleteBtn) deleteBtn.addEventListener('click', () => confirmDelete(item));
      }
      feedbackList.appendChild(card);
    });
  }

  function setRemoteMode(isRemote) {
    remoteData = isRemote ? remoteData : null;
    if (btnUseLocal) btnUseLocal.classList.toggle('hidden', !isRemote);
    if (remoteHint) remoteHint.classList.toggle('hidden', !isRemote);
  }

  function applyFilter() {
    if (remoteData !== null) {
      setRemoteMode(true);
      renderFilteredItems(remoteData);
      return;
    }
    setRemoteMode(false);
    getAllFeedback().then((items) => {
      renderFilteredItems(items);
    });
  }

  function openPreview(item) {
    const parts = [];
    if (item.note) {
      if (isNoteHtml(item.note)) {
        parts.push('<div class="preview-note preview-note-html">' + item.note + '</div>');
      } else {
        parts.push('<div class="preview-note">' + escapeHtml(item.note) + '</div>');
      }
    }
    if (item.images && item.images.length) {
      parts.push(
        '<div class="preview-images">' +
          item.images.map((src) => `<img src="${src}" alt="反馈图" />`).join('') +
          '</div>'
      );
    }
    modalBody.innerHTML = parts.length ? parts.join('') : '<p>无内容</p>';
    modal.classList.remove('hidden');
  }

  modal.querySelector('.modal-backdrop').addEventListener('click', () => modal.classList.add('hidden'));
  modal.querySelector('.modal-close').addEventListener('click', () => modal.classList.add('hidden'));

  btnApplyFilter.addEventListener('click', applyFilter);

  function startEdit(item) {
    editingId = item.id;
    addDate.value = item.date || '';
    addMember.value = item.member || '';
    addNote.innerHTML = item.note || '';
    pendingImages = (item.images && item.images.slice()) || [];
    renderImagePreview();
    document.querySelector('.mode-tabs .tab[data-mode="add"]').click();
    const submitBtn = addForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.textContent = '更新反馈';
  }

  function confirmDelete(item) {
    if (!confirm('确定要删除这条反馈吗？')) return;
    deleteFeedback(item.id)
      .then(() => applyFilter())
      .catch((err) => alert('删除失败：' + (err && err.message ? err.message : '未知错误')));
  }

  function toggleItemDone(item, idx) {
    const baseDones =
      remoteData && remoteDataUrl
        ? (getRemoteDones(remoteDataUrl, item) ?? item.itemDones ?? [])
        : (item.itemDones || []).slice();
    const itemDones = baseDones.slice();
    while (itemDones.length <= idx) itemDones.push(false);
    itemDones[idx] = !itemDones[idx];

    if (remoteData !== null && remoteDataUrl) {
      setRemoteDones(remoteDataUrl, item, itemDones);
      applyFilter();
      return;
    }
    if (item.id == null) return;
    const updated = {
      date: item.date,
      member: item.member,
      note: item.note,
      images: item.images || [],
      itemDones: itemDones,
      createdAt: item.createdAt,
    };
    updateFeedback(item.id, updated)
      .then(() => applyFilter())
      .catch((err) => alert('更新完成状态失败：' + (err && err.message ? err.message : '未知错误')));
  }

  function cancelEdit() {
    editingId = null;
    const submitBtn = addForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.textContent = '保存本条反馈';
  }

  // 切换到「查看反馈」时取消编辑状态
  document.querySelectorAll('.mode-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.getAttribute('data-mode') === 'view') cancelEdit();
    });
  });

  // 修改要点工具栏：加粗、下划线、字号、颜色
  let savedNoteRange = null;

  addNote.addEventListener('blur', () => {
    const sel = window.getSelection();
    if (sel.rangeCount && addNote.contains(sel.anchorNode)) {
      savedNoteRange = sel.getRangeAt(0).cloneRange();
    }
  });

  function restoreNoteSelection() {
    addNote.focus();
    if (savedNoteRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedNoteRange);
    }
  }

  function applyNoteCommand(cmd, value) {
    restoreNoteSelection();
    document.execCommand(cmd, false, value || null);
  }

  document.getElementById('note-bold').addEventListener('click', () => applyNoteCommand('bold'));

  document.getElementById('note-underline').addEventListener('click', () => applyNoteCommand('underline'));

  function isInlineNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    const inlineTags = /^(A|B|STRONG|I|EM|U|S|SPAN|FONT|SUB|SUP|CITE|CODE|LABEL)$/i;
    return inlineTags.test(node.tagName);
  }

  function expandRangeToFormatting(range, root) {
    if (!root || !range) return;
    let start = range.startContainer;
    let end = range.endContainer;
    while (start && start !== root && isInlineNode(start.parentNode)) {
      const par = start.parentNode;
      if (par.childNodes.length === 1 || (par.firstChild === start && range.startOffset === 0)) {
        range.setStart(par, 0);
        start = par;
      } else break;
    }
    while (end && end !== root && isInlineNode(end.parentNode)) {
      const par = end.parentNode;
      const last = par.lastChild;
      if (par.childNodes.length === 1 || (last === end && range.endOffset === (end.nodeType === Node.TEXT_NODE ? end.length : end.childNodes.length))) {
        range.setEnd(par, par.childNodes.length);
        end = par;
      } else break;
    }
  }

  document.getElementById('note-fontsize').addEventListener('change', function () {
    const px = this.value;
    if (!px) return;
    restoreNoteSelection();
    const sel = window.getSelection();
    if (!sel.rangeCount) {
      this.value = '';
      return;
    }
    const range = sel.getRangeAt(0).cloneRange();
    const text = sel.toString();
    if (!text) {
      this.value = '';
      return;
    }
    try {
      expandRangeToFormatting(range, addNote);
      const fragment = range.cloneContents();
      const wrap = document.createElement('div');
      wrap.appendChild(fragment);
      let innerHtml = wrap.innerHTML;
      innerHtml = innerHtml.replace(/\s*font-size\s*:\s*\d+px\s*;?/gi, ' ');
      innerHtml = innerHtml.replace(/\s*style="\s*"/gi, '');
      document.execCommand('insertHTML', false, '<span style="font-size:' + px + 'px">' + innerHtml + '</span>');
    } catch (e) {
      document.execCommand('insertHTML', false, '<span style="font-size:' + px + 'px">' + text + '</span>');
    }
    this.value = '';
  });

  document.querySelector('.note-toolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('.toolbar-color-btn');
    if (btn) {
      applyNoteCommand('foreColor', btn.getAttribute('data-color'));
    }
  });

  document.querySelector('.note-toolbar').addEventListener('mousedown', (e) => {
    if (e.target.closest('.toolbar-btn') || e.target.closest('.toolbar-select') || e.target.closest('.toolbar-color-btn')) {
      const sel = window.getSelection();
      if (sel.rangeCount && addNote.contains(sel.anchorNode)) {
        savedNoteRange = sel.getRangeAt(0).cloneRange();
      }
    }
    if (e.target.closest('.toolbar-btn') || e.target.closest('.toolbar-color-btn')) e.preventDefault();
  });

  // 修改要点编辑区：粘贴图片、拖放图片
  addNote.addEventListener('paste', (e) => {
    const file = e.clipboardData && e.clipboardData.files && e.clipboardData.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    e.preventDefault();
    const reader = new FileReader();
    reader.onload = () => {
      insertImageAtCaret(addNote, reader.result);
    };
    reader.readAsDataURL(file);
  });

  addNote.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });
  addNote.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    e.preventDefault();
    const reader = new FileReader();
    reader.onload = () => {
      insertImageAtCaret(addNote, reader.result);
    };
    reader.readAsDataURL(file);
  });

  function insertImageAtCaret(container, dataUrl) {
    const selection = window.getSelection();
    const range = selection.rangeCount ? selection.getRangeAt(0) : null;
    const img = document.createElement('img');
    img.src = dataUrl;
    img.setAttribute('data-embedded', '1');
    if (range && container.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      range.insertNode(img);
      range.setStartAfter(img);
      range.setEndAfter(img);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      container.appendChild(img);
    }
  }

  // 图片选择预览与待提交
  addImages.addEventListener('change', () => {
    const files = Array.from(addImages.files || []);
    Promise.all(files.map((f) => fileToBase64(f))).then((base64List) => {
      pendingImages = pendingImages.concat(base64List);
      renderImagePreview();
    });
    addImages.value = '';
  });

  function renderImagePreview() {
    imagePreview.innerHTML = pendingImages
      .map(
        (src, idx) => `
      <div class="image-preview-item">
        <img src="${src}" alt="预览${idx + 1}" />
        <button type="button" class="remove-img" data-idx="${idx}">×</button>
      </div>
    `
      )
      .join('');
    imagePreview.querySelectorAll('.remove-img').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        pendingImages.splice(idx, 1);
        renderImagePreview();
      });
    });
  }

  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const date = addDate.value;
    const member = addMember.value.trim();
    if (!date || !member) return;

    const noteHtml = addNote.innerHTML.trim();
    const parsed = parseNoteIntoItems(noteHtml);
    let itemDones = parsed.segments.filter((s) => s.isItem).map(() => false);

    if (editingId != null) {
      getAllFeedback().then((items) => {
        const existing = items.find((i) => i.id === editingId);
        const createdAt = (existing && existing.createdAt) || new Date().toISOString();
        const existingDones = (existing && existing.itemDones) || [];
        itemDones = existingDones.slice(0, parsed.itemCount);
        while (itemDones.length < parsed.itemCount) itemDones.push(false);
        const record = {
          date,
          member,
          note: noteHtml,
          images: pendingImages.slice(),
          itemDones,
          createdAt,
        };
        return updateFeedback(editingId, record);
      })
        .then(() => {
          editingId = null;
          addNote.innerHTML = '';
          pendingImages = [];
          renderImagePreview();
          addForm.querySelector('button[type="submit"]').textContent = '保存本条反馈';
          document.querySelector('.mode-tabs .tab[data-mode="view"]').click();
          applyFilter();
          alert('已更新');
        })
        .catch((err) => {
          alert('更新失败：' + (err && err.message ? err.message : '未知错误'));
        });
      return;
    }

    const record = {
      date,
      member,
      note: noteHtml,
      images: pendingImages.slice(),
      itemDones,
    };
    addFeedback(record)
      .then(() => {
        addNote.innerHTML = '';
        pendingImages = [];
        renderImagePreview();
        addDate.value = date;
        alert('已保存');
      })
      .catch((err) => {
        alert('保存失败：' + (err && err.message ? err.message : '未知错误'));
      });
  });

  // 导出：当前筛选结果或全部
  btnExport.addEventListener('click', () => {
    const dateVal = filterDate.value;
    const memberVal = (filterMember.value || '').trim();
    const source = remoteData !== null ? Promise.resolve(remoteData) : getAllFeedback();
    source.then((items) => {
      let list = items;
      if (dateVal) list = list.filter((i) => i.date === dateVal);
      if (memberVal) list = list.filter((i) => i.member === memberVal);
      const json = JSON.stringify({ version: 1, data: list, exportAt: new Date().toISOString() }, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `反馈-${dateVal || '全部'}-${memberVal || '全部'}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  });

  // 导入：合并到本地
  inputImport.addEventListener('change', () => {
    const file = inputImport.files && inputImport.files[0];
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const obj = JSON.parse(fr.result);
        const list = Array.isArray(obj) ? obj : (obj.data || []);
        if (!list.length) {
          alert('文件中没有可导入的反馈数据');
          inputImport.value = '';
          return;
        }
        const promises = list.map((item) =>
          addFeedback({
            date: item.date,
            member: item.member || '',
            note: item.note || '',
            images: item.images || [],
            itemDones: item.itemDones || [],
          })
        );
        Promise.all(promises)
          .then(() => {
            remoteData = null;
            applyFilter();
            alert('已导入 ' + list.length + ' 条');
            inputImport.value = '';
          })
          .catch(() => {
            inputImport.value = '';
            alert('导入失败');
          });
      } catch (e) {
        alert('文件格式错误：' + (e.message || ''));
        inputImport.value = '';
      }
    };
    fr.readAsText(file);
  });

  // 从链接加载（只读）
  btnLoadRemote.addEventListener('click', () => {
    const url = (remoteUrl.value || '').trim();
    if (!url) {
      alert('请输入数据链接');
      return;
    }
    fetch(url)
      .then((r) => r.json())
      .then((obj) => {
        const list = Array.isArray(obj) ? obj : (obj.data || []);
        remoteData = list;
        remoteDataUrl = url;
        setRemoteMode(true);
        renderFilteredItems(remoteData);
        alert('已加载 ' + list.length + ' 条反馈，可勾选完成项');
      })
      .catch(() => {
        alert('加载失败，请检查链接是否可访问（需支持 CORS）');
      });
  });

  btnUseLocal.addEventListener('click', () => {
    remoteData = null;
    remoteDataUrl = '';
    setRemoteMode(false);
    getAllFeedback().then((items) => renderFilteredItems(items));
  });

  // 初始化：加载列表
  applyFilter();
})();
