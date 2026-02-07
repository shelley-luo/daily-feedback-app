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
  let remoteData = null; // 从链接加载的只读数据，为 null 时使用本地 DB
  let editingId = null; // 正在编辑的反馈 id，为 null 表示新增

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

  function renderNoteContent(note) {
    if (!note) return '';
    if (isNoteHtml(note)) {
      return '<div class="feedback-card-note">' + note + '</div>';
    }
    return '<div class="feedback-card-note note-is-text">' + escapeHtml(note) + '</div>';
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
          ${item.note ? renderNoteContent(item.note) : ''}
          ${imagesHtml}
        </div>
      `;
      card.querySelectorAll('.feedback-card-images img').forEach((img) => {
        img.addEventListener('click', () => openPreview(item));
      });
      if (canEdit && item.id != null) {
        card.querySelector('.btn-edit').addEventListener('click', () => startEdit(item));
        card.querySelector('.btn-delete').addEventListener('click', () => confirmDelete(item));
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
    const record = {
      date,
      member,
      note: noteHtml,
      images: pendingImages.slice(),
    };

    if (editingId != null) {
      getAllFeedback().then((items) => {
        const existing = items.find((i) => i.id === editingId);
        const createdAt = (existing && existing.createdAt) || new Date().toISOString();
        record.createdAt = createdAt;
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
        setRemoteMode(true);
        renderFilteredItems(remoteData);
        alert('已加载 ' + list.length + ' 条反馈（只读）');
      })
      .catch(() => {
        alert('加载失败，请检查链接是否可访问（需支持 CORS）');
      });
  });

  btnUseLocal.addEventListener('click', () => {
    remoteData = null;
    setRemoteMode(false);
    getAllFeedback().then((items) => renderFilteredItems(items));
  });

  // 初始化：加载列表
  applyFilter();
})();
