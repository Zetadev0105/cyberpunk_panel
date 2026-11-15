/* =============================================================
   PCB's Panel — lógica (V0.3)
   Archivo único en el Paso 0. Se puede dividir más adelante
   en db / state / helpers / persist / render / views / actions /
   timer / shortcuts / main sin cambiar el comportamiento.
============================================================= */

/* =============================================================
   SECCIÓN 1 · CONSTANTES Y ESTADO
============================================================= */
const DB_NAME = 'pkm-v0';
const DB_VERSION = 1;
const DB_STORES = ['projects','tasks','notes','plans','links','sessions','settings'];

const DEFAULT_SHORTCUTS = {
  newTask:      't',
  newNote:      'n',
  newProject:   'p',
  newPlan:      'e',
  openPomodoro: 'i',
  openUsage:    'u',
  openPanel:    'h',
  openSearch:   ''
};

const SHORTCUT_LABELS = {
  newTask:      'Nueva tarea',
  newNote:      'Nueva nota',
  newProject:   'Nuevo proyecto',
  newPlan:      'Nuevo plan de estudio',
  openPomodoro: 'Abrir Pomodoro',
  openUsage:    'Abrir Uso del tiempo',
  openPanel:    'Abrir Panel Principal',
  openSearch:   'Foco en buscador'
};

const state = {
  view: 'panel',
  viewParam: null,
  projectTab: 'tasks',
  planTab: 'academic',
  tasks: [], notes: [], projects: [], plans: [], links: [], sessions: [],
  settings: {
    workDuration: 25,
    breakDuration: 5,
    shortcuts: { ...DEFAULT_SHORTCUTS },
    timerContext: { projectId: '', taskId: '' }
  },
  timeFilters: { range: 'today', projectId: '', taskId: '' }
};
let searchQuery = '';

/* =============================================================
   SECCIÓN 2 · DB LAYER (IndexedDB)
============================================================= */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        DB_STORES.forEach(s => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); });
      };
      req.onsuccess = e => { this.db = e.target.result; res(); };
      req.onerror = e => rej(e.target.error);
    });
  },
  _store(name, mode = 'readonly') { return this.db.transaction(name, mode).objectStore(name); },
  getAll(name) { return new Promise((res, rej) => { const r = this._store(name).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  get(name, id) { return new Promise((res, rej) => { const r = this._store(name).get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  put(name, obj) { return new Promise((res, rej) => { const r = this._store(name, 'readwrite').put(obj); r.onsuccess = () => res(obj); r.onerror = () => rej(r.error); }); },
  del(name, id) { return new Promise((res, rej) => { const r = this._store(name, 'readwrite').delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }); }
};

/* =============================================================
   SECCIÓN 3 · HELPERS GENERALES
============================================================= */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
const addDays = (dateStr, n) => { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0,10); };
const $ = sel => document.querySelector(sel);
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const jsStr = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
const upsert = (arr, obj) => { const i = arr.findIndex(x => x.id === obj.id); if (i >= 0) arr[i] = obj; else arr.push(obj); };

function currentProjectContext() { return state.view === 'project' ? state.viewParam : null; }

function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    // 1. Estado (Pendientes primero, luego Hechas)
    if (a.status !== b.status) {
      return a.status === 'done' ? 1 : -1;
    }

    // 2. Fecha de vencimiento (Ascendente, sin fecha va al final)
    const dateA = a.dueDate || '9999-12-31';
    const dateB = b.dueDate || '9999-12-31';
    if (dateA !== dateB) {
      return dateA.localeCompare(dateB);
    }

    // 3. Prioridad (Alta: 3, Media: 2, Baja: 1)
    const priorityMap = { high: 3, medium: 2, low: 1 };
    const pA = priorityMap[a.priority] || 1;
    const pB = priorityMap[b.priority] || 1;
    return pB - pA; // Orden descendente
  });
}

function md(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^#### (.*)$/gm, '<h5>$1</h5>')
    .replace(/^### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^## (.*)$/gm, '<h3>$1</h3>')
    .replace(/^# (.*)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br>');
}

function notePreview(content) {
  const plain = String(content || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return escapeHtml(plain).slice(0, 300);
}

function fmtTime(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${m}:${ss}`;
}

function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return ss > 0 ? `${m}m ${ss}s` : `${m}m`;
  return `${ss}s`;
}

/* =============================================================
   SECCIÓN 4 · IMÁGENES
============================================================= */
function fileToResizedDataURL(file, maxW = 600, maxH = 600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxW || height > maxH) {
          const r = Math.min(maxW / width, maxH / height);
          width = Math.round(width * r);
          height = Math.round(height * r);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleImagePick(e, hiddenId) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const dataURL = await fileToResizedDataURL(file);
    document.getElementById(hiddenId).value = dataURL;
    const prev = document.getElementById(hiddenId + '-preview');
    prev.src = dataURL;
    prev.style.display = 'block';
  } catch (err) {
    alert('No se pudo leer la imagen: ' + err.message);
  }
}

function clearImage(hiddenId) {
  document.getElementById(hiddenId).value = '';
  const prev = document.getElementById(hiddenId + '-preview');
  prev.src = '';
  prev.style.display = 'none';
  const input = document.getElementById(hiddenId + '-input');
  if (input) input.value = '';
}

function imageFieldHTML(hiddenId, currentImage) {
  return `
    <label>Imagen (opcional)</label>
    <input type="hidden" id="${hiddenId}" value="${currentImage ? escapeHtml(currentImage) : ''}">
    <img id="${hiddenId}-preview" class="img-preview" src="${currentImage || ''}" style="${currentImage ? '' : 'display:none;'}">
    <div style="display:flex; gap:0.4rem; margin-bottom:0.5rem;">
      <input type="file" id="${hiddenId}-input" accept="image/*" onchange="handleImagePick(event, '${hiddenId}')" style="margin:0;">
      <button type="button" onclick="clearImage('${hiddenId}')">Quitar</button>
    </div>
  `;
}

/* =============================================================
   SECCIÓN 5 · PERSISTENCIA
============================================================= */
const saveTask     = async t => { await DB.put('tasks', t);       upsert(state.tasks, t); };
const saveNote     = async n => { await DB.put('notes', n);       upsert(state.notes, n); };
const saveProject  = async p => { await DB.put('projects', p);    upsert(state.projects, p); };
const savePlan     = async p => { await DB.put('plans', p);       upsert(state.plans, p); };
const saveLink     = async l => { await DB.put('links', l);       upsert(state.links, l); };
const saveSettings = async () => { await DB.put('settings', { id: 'main', value: state.settings }); };
const deleteItem = async (store, id, arr) => { await DB.del(store, id); const i = arr.findIndex(x => x.id === id); if (i >= 0) arr.splice(i, 1); };

/* =============================================================
   SECCIÓN 6 · CARGA Y SEED
============================================================= */
async function loadAll() {
  await DB.open();
  state.tasks    = await DB.getAll('tasks');
  state.notes    = await DB.getAll('notes');
  state.projects = await DB.getAll('projects');
  state.plans    = await DB.getAll('plans');
  state.links    = await DB.getAll('links');
  state.sessions = await DB.getAll('sessions');
  const s = await DB.get('settings', 'main');
  if (s && s.value) Object.assign(state.settings, s.value);
  state.settings.shortcuts = { ...DEFAULT_SHORTCUTS, ...(state.settings.shortcuts || {}) };
  if (!state.settings.timerContext) state.settings.timerContext = { projectId: '', taskId: '' };
}

async function seed() {
  if (state.links.length === 0) {
    const examples = [
      { id: uid(), title: 'Gmail', url: 'https://mail.google.com', type: 'link', projectId: null },
      { id: uid(), title: 'GitHub', url: 'https://github.com', type: 'link', projectId: null },
      { id: uid(), title: 'Spotify Focus', url: 'https://open.spotify.com/playlist/37i9dQZF1DWZeKCadgRdKQ', type: 'spotify', projectId: null }
    ];
    for (const l of examples) { await DB.put('links', l); state.links.push(l); }
  }
  if (!(await DB.get('settings', 'main'))) {
    await DB.put('settings', { id: 'main', value: state.settings });
  }
}

/* =============================================================
   SECCIÓN 7 · MODAL Y ATAJOS DE MODAL
============================================================= */
function openModal(html) {
  const modal = $('#modal');
  modal.innerHTML = `<div class="content">${html}</div>`;
  modal.classList.remove('hidden');
  setTimeout(() => {
    const first = modal.querySelector('[autofocus]') ||
      modal.querySelector('input:not([type=checkbox]):not([type=hidden]):not([type=file]), textarea, select');
    if (first) { first.focus(); if (typeof first.select === 'function' && first.tagName === 'INPUT') first.select(); }
  }, 0);
}

function closeModal() {
  const modal = $('#modal');
  modal.classList.add('hidden');
  modal.innerHTML = '';
}

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    const form = e.target.closest('form');
    if (form && form.requestSubmit) { e.preventDefault(); form.requestSubmit(); }
  }
}, true);

/* =============================================================
   SECCIÓN 8 · RENDER DISPATCHER
============================================================= */
function render() {
  document.querySelectorAll('#nav a').forEach(a => {
    let active = a.dataset.view === state.view
      || (state.view === 'project' && a.dataset.view === 'projects')
      || (state.view === 'plan'    && a.dataset.view === 'plans');
    a.classList.toggle('active', active);

    if (a.dataset.view === 'projects') {
      if (state.view === 'project') {
        const p = state.projects.find(x => x.id === state.viewParam);
        if (p) a.innerHTML = `Proyectos <span class="sidebar-sub">↳ ${escapeHtml(p.name)}</span>`;
        else a.innerHTML = 'Proyectos';
      } else { a.innerHTML = 'Proyectos'; }
    }

    if (a.dataset.view === 'plans') {
      if (state.view === 'plan') {
        const p = state.plans.find(x => x.id === state.viewParam);
        if (p) a.innerHTML = `Planes de Estudio <span class="sidebar-sub">↳ ${escapeHtml(p.name)}</span>`;
        else a.innerHTML = 'Planes de Estudio';
      } else { a.innerHTML = 'Planes de Estudio'; }
    }
  });

  // Limpiamos los botones contextuales de la cabecera
  const headerActions = document.getElementById('header-view-actions');
  if (headerActions) headerActions.innerHTML = '';

  const main = $('#main-content');
  switch (state.view) {
    case 'panel':     main.innerHTML = viewPanel();                break;
    case 'today':     main.innerHTML = viewToday();                break;
    case 'inbox':     
      main.innerHTML = viewInbox();                
      break;
    case 'projects':  
      main.innerHTML = viewProjects();             
      if (headerActions) headerActions.innerHTML = `<button onclick="newProject()">+ Proyecto</button>`;
      break;
    case 'project':   main.innerHTML = viewProjectDetail(state.viewParam); break;
    case 'tasks':     
      main.innerHTML = viewTasks();                
      break;
    case 'notes':     
      main.innerHTML = viewNotes();                
      break;
    case 'plans':     
      main.innerHTML = viewPlans();                
      if (headerActions) headerActions.innerHTML = `<button onclick="newPlan()">+ Plan</button>`;
      break;
    case 'plan':      main.innerHTML = viewPlanDetail(state.viewParam); break;
    case 'pomodoro':  main.innerHTML = viewPomodoro();             break;
    case 'timeusage': main.innerHTML = viewTimeUsage();            break;
    case 'tags':      main.innerHTML = viewTags();                 break;
    case 'settings':  main.innerHTML = viewSettings();             break;
    case 'search':    main.innerHTML = viewSearch();               break;
    default:          main.innerHTML = '<p>Vista no encontrada.</p>';
  }
  updateTimerDisplays();
}

/* =============================================================
   SECCIÓN 9 · COMPONENTES REUTILIZABLES
============================================================= */
function taskRow(t) {
  const isDone = t.status === 'done';
  const proj = t.projectId ? (state.projects.find(p => p.id === t.projectId) || {}).name : '';
  return `<div class="task-row priority-${t.priority || 'low'} ${isDone ? 'done' : ''}">
    <input type="checkbox" ${isDone ? 'checked' : ''} onchange="toggleTask('${t.id}')">
    <span class="title" onclick="editTask('${t.id}')" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</span>
    ${!isDone ? `<button class="btn-play" onclick="event.stopPropagation(); startTaskSession('${t.id}')" title="Iniciar sesión con esta tarea">▶</button>` : ''}
    ${proj ? `<span class="meta">${escapeHtml(proj)}</span>` : ''}
    ${t.dueDate ? `<span class="meta">${t.dueDate}</span>` : ''}
    ${(t.tags || []).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
  </div>`;
}

function spotifyEmbedUrl(url) {
  const m = String(url || '').match(/open\.spotify\.com\/(playlist|track|album|artist|episode|show)\/([a-zA-Z0-9]+)/);
  if (!m) return null;
  return `https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=generator&theme=0`;
}

function linkCard(l) {
  if (l.type === 'spotify') {
    const embed = spotifyEmbedUrl(l.url);
    if (embed) {
      return `<div class="link-card embed" style="position:relative;" title="${escapeHtml(l.title)}">
        <iframe src="${embed}" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>
        <button style="position:absolute; top:4px; right:4px; padding:1px 6px; font-size:11px; z-index: 20;" onclick="event.stopPropagation(); deleteLink('${l.id}')">×</button>
      </div>`;
    }
  }
  
  // Si tiene imagen, la seteamos como background-image inline
  const bgStyle = l.image ? `background-image: url('${l.image}');` : '';
  
  return `<a class="link-card" href="${escapeHtml(l.url)}" target="_blank" rel="noopener" title="${escapeHtml(l.url)}" style="${bgStyle}">
    <div class="link-title">${escapeHtml(l.title)}</div>
    <button style="position:absolute; top:4px; right:4px; padding:1px 6px; font-size:11px; z-index: 20;" onclick="event.preventDefault(); event.stopPropagation(); deleteLink('${l.id}')">×</button>
  </a>`;
}

function timerWidgetHTML(big) {
  const cls = big ? 'timer-display big' : 'timer-display';
  const flexStyle = big ? '' : 'flex:1;'; // Solo se estira en el panel principal
  
  return `<div style="${flexStyle} display:flex; flex-direction:column; align-items:center; justify-content:center;">
    <div class="${cls}" data-timer-display>25:00</div>
    <div class="timer-mode" data-timer-mode>Pomodoro</div>
    
    <div class="timer-progress-container">
      <div class="timer-progress-bar" data-timer-progress></div>
    </div>

    <div class="timer-actions">
      <button onclick="toggleTimer()">Start / Pause</button>
      ${timer.currentSession 
        ? `<button class="btn-danger" onclick="stopTimerAndSave()">Detener y Guardar</button>` 
        : `<button class="btn-ghost" onclick="resetTimer(); render();">Reset</button>`}
    </div>
  </div>`;
}

/* =============================================================
   SECCIÓN 10 · VISTAS
============================================================= */
function viewPanel() {
  const today = todayStr();
  const overdue = state.tasks.filter(t => t.status === 'pending' && t.dueDate && t.dueDate < today);
  const todayTasks = state.tasks.filter(t => t.status === 'pending' && t.dueDate === today);
  const recentNotes = [...state.notes].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 6);
  const globalLinks = state.links.filter(l => !l.projectId);
  return `
    <h2>Panel Principal</h2>
    <div class="panel-grid">
      <div class="card"><h3>Pomodoro</h3>${timerWidgetHTML(false)}</div>
      <div class="card">
        <h3>Hoy · ${todayTasks.length + overdue.length}</h3>
        <div class="card-body">
          ${overdue.length ? `<p style="color:#c33; font-size:11px; margin-bottom:0.3rem;">Vencidas: ${overdue.length}</p>` : ''}
          ${sortTasks(overdue.concat(todayTasks)).slice(0, 12).map(t => `<div class="task-row priority-${t.priority || 'low'}">
            <input type="checkbox" onchange="toggleTask('${t.id}')">
            <span class="title" onclick="editTask('${t.id}')">${escapeHtml(t.title)}</span>
          </div>`).join('') || '<div class="empty">Sin tareas para hoy.</div>'}
        </div>
      </div>
      <div class="card">
        <h3>Notas recientes</h3>
        <div class="card-body">
          ${recentNotes.map(n => `<div class="task-row">
            ${n.image ? `<img src="${n.image}" class="card-image-sm">` : ''}
            <span class="title" onclick="viewNote('${n.id}')">${escapeHtml(n.title || '(sin título)')}</span>
          </div>`).join('') || '<div class="empty">Sin notas.</div>'}
        </div>
      </div>
      <div class="card">
        <h3>Planes</h3>
        <div class="card-body">
          ${state.plans.map(p => {
            const subs = p.subjects || [];
            const total = subs.reduce((s, x) => s + (x.topics || []).length, 0);
            const done = subs.reduce((s, x) => s + (x.topics || []).filter(t => t.done).length, 0);
            return `<div class="task-row">
              ${p.image ? `<img src="${p.image}" class="card-image-sm">` : ''}
              <span class="title" onclick="openPlan('${p.id}')">${escapeHtml(p.name)}</span>
              <span class="meta">${done}/${total}</span>
            </div>`;
          }).join('') || '<div class="empty">Sin planes.</div>'}
        </div>
      </div>
    </div>
    <h3 style="margin-top:1.25rem;">Accesos rápidos</h3>
    <div class="grid-links">
      ${globalLinks.map(linkCard).join('')}
      <button class="link-card" onclick="newLink(null)">
        <div style="font-size:2.2rem; line-height:1; margin-bottom:0.2rem; color:var(--accent); font-weight:bold; text-shadow: 0 0 8px rgba(252,238,10,0.5);">+</div>
        <div class="link-title">Agregar</div>
      </button>
    </div>
  `;
}

function viewToday() {
  const today = todayStr();
  const overdue = state.tasks.filter(t => t.status === 'pending' && t.dueDate && t.dueDate < today);
  const todayTasks = state.tasks.filter(t => t.status === 'pending' && t.dueDate === today);
  const next7 = state.tasks.filter(t => t.status === 'pending' && t.dueDate && t.dueDate > today && t.dueDate <= addDays(today, 7));
  return `
    <h2>Hoy · ${today}</h2>
    ${overdue.length ? `<h3 style="color:#c33;">Vencidas · ${overdue.length}</h3>${overdue.map(taskRow).join('')}` : ''}
    <h3 style="margin-top:1rem;">Tareas de hoy · ${todayTasks.length}</h3>
    ${todayTasks.map(taskRow).join('') || '<div class="empty">Sin tareas para hoy.</div>'}
    <h3 style="margin-top:1rem;">Próximos 7 días · ${next7.length}</h3>
    ${next7.map(taskRow).join('') || '<div class="empty">Sin tareas próximas.</div>'}
  `;
}

function viewInbox() {
  const inbox = state.tasks.filter(t => !t.projectId && t.status !== 'archived');
  return `
    <h2>Inbox · ${inbox.length}</h2>
    <p style="font-size:12px; color:#666; margin-bottom:0.75rem;">Tareas sin proyecto asignado.</p>
    ${inbox.map(taskRow).join('') || '<div class="empty">Sin tareas en Inbox.</div>'}
  `;
}

function viewTasks() {
  // Usamos la nueva función sortTasks
  const tasks = sortTasks(state.tasks); 
  
  return `
    <h2>Tareas · ${tasks.length}</h2>
    ${tasks.map(taskRow).join('') || '<div class="empty">Sin tareas.</div>'}
  `;
}

function viewNotes() {
  const sorted = [...state.notes].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return `
    <h2>Notas · ${sorted.length}</h2>
    <div class="notes-grid">
      <div class="note-card new-note" onclick="newNote(currentProjectContext())">+ Nueva nota</div>
      ${sorted.map(n => `
        <div class="note-card" onclick="viewNote('${n.id}')">
          ${n.image ? `<img class="note-image" src="${n.image}" alt="">` : ''}
          <div class="note-title">${escapeHtml(n.title || '(sin título)')}</div>
          <div class="note-preview">${notePreview(n.content)}</div>
          ${(n.tags || []).length ? `<div class="note-footer">${(n.tags || []).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
          ${n.projectId ? `<div style="font-size:10px; color:#999; margin-top:0.4rem;">${escapeHtml((state.projects.find(p => p.id === n.projectId) || {}).name || '')}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function viewProjects() {
  return `
    <h2>Proyectos · ${state.projects.length}</h2>
    <div class="grid-auto">
      ${state.projects.map(p => {
        const pending = state.tasks.filter(t => t.projectId === p.id && t.status === 'pending').length;
        return `<div class="card" style="cursor:pointer;" onclick="openProject('${p.id}')">
          ${p.image ? `<img class="card-image" src="${p.image}" alt="">` : ''}
          <h3>${escapeHtml(p.name)}</h3>
          <p style="font-size:12px; color:#666; min-height:1.2em;">${escapeHtml(p.description || '')}</p>
          <p style="font-size:11px; color:#888; margin-top:0.5rem;">${pending} tareas pendientes</p>
        </div>`;
      }).join('') || '<div class="empty">Sin proyectos.</div>'}
    </div>
  `;
}

function viewProjectDetail(id) {
  const p = state.projects.find(x => x.id === id);
  if (!p) return '<p>Proyecto no encontrado.</p>';
  const tab = state.projectTab;

  const tasks = sortTasks(state.tasks.filter(t => t.projectId === id)); 


  const notes = state.notes.filter(n => n.projectId === id);
  const links = state.links.filter(l => l.projectId === id);
  let body = '';
  if (tab === 'tasks') body = tasks.map(taskRow).join('') || '<div class="empty">Sin tareas.</div>';
  else if (tab === 'notes') {
    body = notes.length
      ? `<div class="notes-grid">${notes.map(n => `
          <div class="note-card" onclick="viewNote('${n.id}')">
            ${n.image ? `<img class="note-image" src="${n.image}" alt="">` : ''}
            <div class="note-title">${escapeHtml(n.title || '(sin título)')}</div>
            <div class="note-preview">${notePreview(n.content)}</div>
          </div>`).join('')}</div>`
      : '<div class="empty">Sin notas.</div>';
  }
  else body = `<div class="grid-links">
    ${links.map(linkCard).join('')}
    <button class="link-card" onclick="newLink('${id}')">
      <div style="font-size:2.2rem; line-height:1; margin-bottom:0.2rem; color:var(--accent); font-weight:bold; text-shadow: 0 0 8px rgba(252,238,10,0.5);">+</div>
      <div class="link-title">Agregar</div>
    </button>
  </div>`;

  return `
    <div class="section-header">
      <div style="display:flex; gap:0.75rem; align-items:center;">
        <button class="btn-ghost btn-back" onclick="state.view='projects'; state.viewParam=null; render();" title="Volver a Proyectos">←</button>
        ${p.image ? `<img src="${p.image}" style="width:48px; height:48px; object-fit:cover; border-radius:6px;">` : ''}
        <div>
          <h2>${escapeHtml(p.name)}</h2>
          <p style="font-size:12px; color:#666;">${escapeHtml(p.description || '')}</p>
        </div>
      </div>
      <div>
        <button onclick="editProject('${id}')">Editar</button>
        <button class="btn-danger" onclick="deleteProject('${id}')">Eliminar</button>
      </div>
    </div>
    <div class="tabs">
      <button class="${tab === 'tasks' ? 'active' : ''}" onclick="setProjectTab('tasks')">Tareas</button>
      <button class="${tab === 'notes' ? 'active' : ''}" onclick="setProjectTab('notes')">Notas</button>
      <button class="${tab === 'panel' ? 'active' : ''}" onclick="setProjectTab('panel')">Panel</button>
    </div>
    <div style="margin-bottom:0.75rem;">
      ${tab === 'tasks' ? `<button onclick="newTask('${id}')">+ Nueva tarea</button>` : ''}
      ${tab === 'notes' ? `<button onclick="newNote('${id}')">+ Nueva nota</button>` : ''}
      ${tab === 'panel' ? `<button onclick="newLink('${id}')">+ Agregar enlace</button>` : ''}
    </div>
    ${body}
  `;
}

function viewPlans() {
  const activeTab = state.planTab || 'academic';
  
  // Filtramos los planes según la pestaña. Si no tienen tipo, asumimos 'academic'.
  const currentPlans = state.plans.filter(p => (p.type || 'academic') === activeTab);

  return `
    <h2>Planes de Estudio · ${state.plans.length}</h2>
    
    <div class="tabs" style="margin-bottom: 1rem;">
      <button class="${activeTab === 'academic' ? 'active' : ''}" onclick="state.planTab='academic'; render();">Académico</button>
      <button class="${activeTab === 'personal' ? 'active' : ''}" onclick="state.planTab='personal'; render();">Personal</button>
    </div>

    <div class="grid-auto">
      ${currentPlans.map(p => {
        const subs = p.subjects || [];
        const total = subs.reduce((s, x) => s + (x.topics || []).length, 0);
        const done = subs.reduce((s, x) => s + (x.topics || []).filter(t => t.done).length, 0);
        return `<div class="card" style="cursor:pointer;" onclick="openPlan('${p.id}')">
          ${p.image ? `<img class="card-image" src="${p.image}" alt="">` : ''}
          <h3>${escapeHtml(p.name)}</h3>
          <p style="font-size:12px; color:#666;">${escapeHtml(p.description || '')}</p>
          <p style="font-size:11px; color:#888; margin-top:0.5rem;">${subs.length} temas/secciones · ${done}/${total} completados</p>
        </div>`;
      }).join('') || `<div class="empty">No hay planes en la categoría ${activeTab === 'academic' ? 'Académica' : 'Personal'} todavía.</div>`}
    </div>
  `;
}

function viewPlanDetail(id) {
  const p = state.plans.find(x => x.id === id);
  if (!p) return '<p>Plan no encontrado.</p>';
  return `
    <div class="section-header">
      <div style="display:flex; gap:0.75rem; align-items:center;">
        <button class="btn-ghost btn-back" onclick="state.view='plans'; state.viewParam=null; render();" title="Volver a Planes">←</button>
        ${p.image ? `<img src="${p.image}" style="width:48px; height:48px; object-fit:cover; border-radius:6px;">` : ''}
        <div>
          <h2>${escapeHtml(p.name)}</h2>
          <p style="font-size:12px; color:#666;">${escapeHtml(p.description || '')}</p>
        </div>
      </div>
      <div>
        <button onclick="editPlan('${id}')">Editar</button>
        <button class="btn-danger" onclick="deletePlan('${id}')">Eliminar</button>
      </div>
    </div>
    
    ${(p.subjects || []).map(sub => `
      <div class="card" style="margin-bottom:0.75rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
          <h3 style="margin:0;">${escapeHtml(sub.name)}</h3>
          ${(p.type || 'academic') === 'academic' ? `<button class="btn-ghost" onclick="newExam('${p.id}', '${sub.id}')">+ Examen</button>` : ''}
        </div>
        
        <!-- Lista de Exámenes -->
        ${(sub.exams && sub.exams.length) ? `
          <div style="display:flex; flex-wrap:wrap; gap:0.5rem; margin-bottom:1rem;">
            ${sub.exams.map(ex => {
              const today = new Date(); today.setHours(0,0,0,0);
              const exDate = new Date(ex.date + 'T00:00:00');
              const diffTime = exDate - today;
              const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              
              let color = 'var(--text)';
              let bg = 'var(--surface-2)';
              let border = '1px solid var(--border)';
              let daysText = '';

              if (diffDays >= 0 && diffDays <= 7) {
                bg = 'rgba(255, 176, 0, 0.15)'; border = '1px solid var(--warning)'; color = 'var(--warning)';
                daysText = ` (Faltan ${diffDays} días)`;
              } else if (diffDays < 0) {
                bg = 'rgba(255, 0, 60, 0.15)'; border = '1px solid var(--danger)'; color = 'var(--danger)';
                daysText = ` (Vencido)`;
              }

              return `<div style="background:${bg}; border:${border}; color:${color}; border-radius:var(--radius-sm); padding:4px 8px; font-size:12px; cursor:pointer; display:flex; gap:0.5rem; align-items:center;" onclick="editExam('${p.id}','${sub.id}','${ex.id}')">
                <span style="font-weight:bold;">${escapeHtml(ex.name)}</span>
                <span style="text-transform:capitalize; opacity:0.8;">${escapeHtml(ex.type)}</span>
                <span>${ex.date}${daysText}</span>
              </div>`;
            }).join('')}
          </div>
        ` : ''}

        <!-- Lista de Temas -->
        ${(sub.topics || []).map(t => `<div class="task-row">
          <input type="checkbox" ${t.done ? 'checked' : ''} onchange="toggleTopic('${p.id}','${sub.id}','${t.id}')">
          <span class="title" style="${t.done ? 'text-decoration:line-through; opacity:0.55;' : ''}">${escapeHtml(t.name)}</span>
        </div>`).join('') || '<div class="empty">Sin temas.</div>'}
      </div>
    `).join('') || '<div class="empty">Sin materias.</div>'}
  `;
}

function newExam(planId, subjectId) {
  editExamForm(planId, subjectId, null);
}

function editExam(planId, subjectId, examId) {
  const p = state.plans.find(x => x.id === planId);
  const sub = (p.subjects || []).find(x => x.id === subjectId);
  const ex = sub.exams ? sub.exams.find(x => x.id === examId) : null;
  editExamForm(planId, subjectId, ex);
}

function editExamForm(planId, subjectId, exam) {
  openModal(`
    <h3>${exam ? 'Editar Examen' : 'Nuevo Examen'}</h3>
    <form onsubmit="submitExam(event, '${planId}', '${subjectId}', '${exam ? exam.id : ''}')">
      <label>Nombre del Examen</label>
      <input type="text" id="exam-name" value="${exam ? escapeHtml(exam.name) : ''}" placeholder="Ej: 1er Parcial" required autofocus>
      
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
        <div>
          <label>Tipo</label>
          <select id="exam-type">
            <option value="normal" ${exam && exam.type === 'normal' ? 'selected' : ''}>Normal</option>
            <option value="recuperatorio" ${exam && exam.type === 'recuperatorio' ? 'selected' : ''}>Recuperatorio</option>
            <option value="trimestral" ${exam && exam.type === 'trimestral' ? 'selected' : ''}>Trimestral</option>
            <option value="previa" ${exam && exam.type === 'previa' ? 'selected' : ''}>Previa</option>
            <option value="global" ${exam && exam.type === 'global' ? 'selected' : ''}>Global</option>
          </select>
        </div>
        <div>
          <label>Fecha</label>
          <input type="date" id="exam-date" value="${exam ? exam.date : ''}" required>
        </div>
      </div>

      <div style="margin-top:1rem; display:flex; gap:0.5rem; justify-content:flex-end;">
        ${exam ? `<button type="button" class="btn-danger" onclick="deleteExam('${planId}', '${subjectId}', '${exam.id}')" style="margin-right:auto;">Eliminar</button>` : ''}
        <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="primary">Guardar</button>
      </div>
    </form>
  `);
}

async function submitExam(e, planId, subjectId, examId) {
  e.preventDefault();
  const name = document.getElementById('exam-name').value.trim();
  const date = document.getElementById('exam-date').value;
  const type = document.getElementById('exam-type').value;
  
  const p = state.plans.find(x => x.id === planId);
  const sub = p.subjects.find(x => x.id === subjectId);
  
  if (!sub.exams) sub.exams = [];
  
  if (examId) {
    const ex = sub.exams.find(x => x.id === examId);
    ex.name = name; ex.date = date; ex.type = type;
  } else {
    sub.exams.push({ id: uid(), name, date, type });
  }
  
  await savePlan(p);
  closeModal();
  render();
}

async function deleteExam(planId, subjectId, examId) {
  if (!confirm('¿Eliminar este examen?')) return;
  const p = state.plans.find(x => x.id === planId);
  const sub = p.subjects.find(x => x.id === subjectId);
  sub.exams = sub.exams.filter(x => x.id !== examId);
  await savePlan(p);
  closeModal();
  render();
}

function viewPomodoro() {
  const ctx = state.settings.timerContext || { projectId: '', taskId: '' };
  const projectOptions = state.projects.map(p => `<option value="${p.id}" ${p.id === ctx.projectId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
  const tasksInProject = ctx.projectId ? state.tasks.filter(t => t.projectId === ctx.projectId && t.status !== 'done') : [];
  const taskOptions = tasksInProject.map(t => `<option value="${t.id}" ${t.id === ctx.taskId ? 'selected' : ''}>${escapeHtml(t.title)}</option>`).join('');
  const locked = !!timer.currentSession;
  
  return `
    <h2>Pomodoro</h2>
    <div class="grid-auto" style="grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));">
      <div class="card" style="display:flex; flex-direction:column; min-height: 420px; padding-bottom: 1.5rem;">
        <div style="margin-bottom:0.5rem;">
          <label>Proyecto</label>
          <select id="timer-project-select" onchange="onTimerProjectChange(this.value)" ${locked ? 'disabled' : ''}>
            <option value="">Sin proyecto</option>
            ${projectOptions}
          </select>
          ${ctx.projectId ? `
            <label>Tarea</label>
            <select id="timer-task-select" onchange="onTimerTaskChange(this.value)" ${locked ? 'disabled' : ''}>
              <option value="">Sin tarea</option>
              ${taskOptions}
            </select>
          ` : ''}
          ${locked ? `<p style="font-size:11px; color:#888; margin-top:0.25rem;">Sesión en curso: los selectores se bloquean. Usá Reset para cambiarlos.</p>` : ''}
        </div>
        
        <!-- Contenedor centrado para el reloj y los botones de abajo -->
        <div style="flex:1; display:flex; flex-direction:column; justify-content:center;">
          ${timerWidgetHTML(true)}
          
          <div style="display:flex; gap:0.4rem; justify-content:center; margin-top:1rem; flex-wrap:wrap;">
            <button onclick="setTimerMode('pomodoro')">Pomodoro</button>
            <button onclick="setTimerMode('stopwatch')">Cronómetro</button>
            ${timer.mode === 'stopwatch' && timer.currentSession ? `<button onclick="saveAndStopStopwatch()" class="primary">Guardar sesión</button>` : ''}
          </div>
        </div>
      </div>
      
      <div class="card">
        <h3>Configuración</h3>
        <label>Duración trabajo (min)</label>
        <input type="number" min="1" value="${state.settings.workDuration}" onchange="changeWorkDuration(this.value)">
        <label>Duración descanso (min)</label>
        <input type="number" min="1" value="${state.settings.breakDuration}" onchange="changeBreakDuration(this.value)">
        <p style="font-size:11px; color:#888; margin-top:1rem;">El historial y los resúmenes están en <a href="#" onclick="event.preventDefault(); state.view='timeusage'; state.viewParam=null; render();">Uso del tiempo</a>.</p>
      </div>
    </div>
  `;
}

function viewTimeUsage() {
  const f = state.timeFilters;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let startFilter = null;
  if (f.range === 'today') startFilter = todayStart;
  else if (f.range === '7days') { startFilter = new Date(todayStart); startFilter.setDate(startFilter.getDate() - 6); }
  else if (f.range === 'month') startFilter = new Date(now.getFullYear(), now.getMonth(), 1);

  const sessions = state.sessions.filter(s => {
    if (!s.endedAt) return false;
    if (startFilter && new Date(s.endedAt) < startFilter) return false;
    if (f.projectId && s.projectId !== f.projectId) return false;
    if (f.taskId && s.taskId !== f.taskId) return false;
    return true;
  }).sort((a, b) => (b.endedAt || '').localeCompare(a.endedAt || ''));

  const totalSec = sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
  const byProject = {};
  sessions.forEach(s => {
    const key = s.projectName || '(Sin proyecto)';
    if (!byProject[key]) byProject[key] = 0;
    byProject[key] += s.duration || 0;
  });
  const projectList = Object.entries(byProject).sort((a, b) => b[1] - a[1]);
  const maxProjSec = projectList.length ? projectList[0][1] : 1;
  const byTask = {};
  sessions.forEach(s => {
    if (!s.taskTitle) return;
    byTask[s.taskTitle] = (byTask[s.taskTitle] || 0) + (s.duration || 0);
  });
  const topTasks = Object.entries(byTask).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const activeSession = timer.currentSession;
  const activeDuration = getCurrentSessionDuration();
  const tasksForFilter = f.projectId ? state.tasks.filter(t => t.projectId === f.projectId) : state.tasks;

  return `
    <h2>Uso del tiempo</h2>

    <div class="card" style="margin-bottom:1rem;">
      <div style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:flex-end;">
        <div style="flex:1; min-width:140px;">
          <label>Rango</label>
          <select onchange="setTimeFilter('range', this.value)">
            <option value="today" ${f.range==='today'?'selected':''}>Hoy</option>
            <option value="7days" ${f.range==='7days'?'selected':''}>Últimos 7 días</option>
            <option value="month" ${f.range==='month'?'selected':''}>Este mes</option>
            <option value="all" ${f.range==='all'?'selected':''}>Todo</option>
          </select>
        </div>
        <div style="flex:1; min-width:140px;">
          <label>Proyecto</label>
          <select onchange="setTimeFilter('projectId', this.value)">
            <option value="">Todos</option>
            ${state.projects.map(p => `<option value="${p.id}" ${f.projectId===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}
          </select>
        </div>
        <div style="flex:1; min-width:140px;">
          <label>Tarea</label>
          <select onchange="setTimeFilter('taskId', this.value)">
            <option value="">Todas</option>
            ${tasksForFilter.map(t => `<option value="${t.id}" ${f.taskId===t.id?'selected':''}>${escapeHtml(t.title)}</option>`).join('')}
          </select>
        </div>
        <button onclick="newManualSession()">+ Sesión manual</button>
      </div>
    </div>

            ${activeSession ? `
      <div class="card active-session" style="margin-bottom:1rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
          
          <div>
            <h3 style="color: var(--success); margin:0 0 0.5rem 0; text-shadow: 0 0 8px rgba(0,255,159,0.4);">
              ● En curso
            </h3>
            <div style="font-size:1.1rem; font-weight:var(--fw-semibold); color:var(--text); margin-bottom:0.2rem;">
              ${escapeHtml(activeSession.projectName || '(Sin proyecto)')}
            </div>
            <div style="font-size:var(--fs-sm2); color:var(--text-muted);">
              ${escapeHtml(activeSession.taskTitle || '(Sin tarea)')}
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:1.5rem;">
            <div style="font-family:var(--font-display); font-size:1.8rem; font-weight:bold; color:var(--success); text-shadow:0 0 10px rgba(0,255,159,0.5);" data-usage-active-time>
              ${formatDuration(activeDuration)}
            </div>
            <button class="btn-danger" onclick="stopTimerAndSave()" style="height:fit-content; padding: 0.5rem 1rem;">
              Detener
            </button>
          </div>

        </div>
      </div>
    ` : ''}

    <div class="grid-auto" style="margin-bottom:1rem;">
      <div class="card">
        <h3>Total en rango</h3>
        <div style="font-size:1.6rem; font-weight:600;">${formatDuration(totalSec)}</div>
        <p style="font-size:12px; color:#888;">${sessions.length} sesiones</p>
      </div>
      <div class="card" style="grid-column: span 2;">
        <h3>Por proyecto</h3>
        ${projectList.length ? projectList.map(([name, sec]) => {
          const pct = maxProjSec ? Math.round(sec / maxProjSec * 100) : 0;
          return `<div class="usage-summary-row">
            <span class="name">${escapeHtml(name)}</span>
            <div class="usage-bar-bg"><div class="usage-bar-fill" style="width:${pct}%;"></div></div>
            <span class="val">${formatDuration(sec)}</span>
          </div>`;
        }).join('') : '<div class="empty">Sin datos.</div>'}
      </div>
      <div class="card">
        <h3>Top tareas</h3>
        ${topTasks.length ? topTasks.map(([name, sec]) =>
          `<div style="font-size:12px; padding:0.2rem 0;">${escapeHtml(name)} <span style="color:#888;">· ${formatDuration(sec)}</span></div>`
        ).join('') : '<div class="empty">Sin datos.</div>'}
      </div>
    </div>

    <h3>Sesiones · ${sessions.length}</h3>
    ${sessions.length ? sessions.map(s => `
      <div class="card" style="margin-bottom:0.5rem; padding:0.6rem;">
        <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
          <span class="tag">${s.type === 'pomodoro' ? '🍅 Pomodoro' : s.type === 'break' ? '☕ Descanso' : '⏱️ Cronómetro'}</span>
          <span style="flex:1; min-width:120px; font-size:13px; font-weight:500;">${escapeHtml(s.projectName || '(Sin proyecto)')}</span>
          <span style="flex:1; min-width:120px; font-size:12px; color:#666;">${escapeHtml(s.taskTitle || '(Sin tarea)')}</span>
          <span style="font-size:13px; font-weight:600; min-width:70px; text-align:right;">${formatDuration(s.duration)}</span>
          <span style="font-size:11px; color:#888;">${new Date(s.endedAt).toLocaleString()}</span>
          ${(!s.projectId && !s.taskId) ? `<button onclick="assignSession('${s.id}')">Asignar</button>` : ''}
          <button onclick="deleteSession('${s.id}')" title="Eliminar">×</button>
        </div>
      </div>
    `).join('') : '<div class="empty">Sin sesiones en este rango.</div>'}
  `;
}

function viewTags() {
  const set = new Set();
  state.tasks.forEach(t => (t.tags || []).forEach(x => set.add(x)));
  state.notes.forEach(n => (n.tags || []).forEach(x => set.add(x)));
  const tags = [...set].sort();
  return `
    <h2>Etiquetas · ${tags.length}</h2>
    <p style="font-size:12px; color:#666; margin-bottom:0.75rem;">Etiquetas libres para agrupar tareas y notas a través de proyectos.</p>
    <div class="grid-auto">
      ${tags.map(tag => {
        const count = state.tasks.filter(t => (t.tags || []).includes(tag)).length + state.notes.filter(n => (n.tags || []).includes(tag)).length;
        return `<div class="card" style="cursor:pointer;" onclick="openTag('${jsStr(tag)}')"><h3>#${escapeHtml(tag)}</h3><p style="font-size:12px;">${count} elementos</p></div>`;
      }).join('') || '<div class="empty">Sin etiquetas todavía.</div>'}
    </div>
  `;
}

function viewSettings() {
  const lastBackupDate = state.settings.lastBackup 
    ? new Date(state.settings.lastBackup).toLocaleString() 
    : 'Nunca (¡Hacé uno ya!)';

  return `
    <h2>Ajustes</h2>
    <div class="grid-auto">
      <div class="card">
        <h3>Datos y Respaldos</h3>
        <p style="font-size:var(--fs-sm2); color:var(--text-muted); margin-bottom:0.5rem;">
          Último backup: <strong style="color:var(--accent); text-shadow:var(--glow-yellow);">${lastBackupDate}</strong>
        </p>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:1rem;">
          <button class="primary" onclick="exportData()">↓ Exportar JSON</button>
          <button class="btn-ghost" onclick="document.getElementById('import-file').click()">↑ Importar JSON</button>
          <input type="file" id="import-file" accept=".json" onchange="importData(event)" style="display:none;">
        </div>
      </div>
      <div class="card">
        <h3>Pomodoro</h3>
        <label>Duración trabajo (min)</label>
        <input type="number" min="1" value="${state.settings.workDuration}" onchange="changeWorkDuration(this.value)">
        <label>Duración descanso (min)</label>
        <input type="number" min="1" value="${state.settings.breakDuration}" onchange="changeBreakDuration(this.value)">
      </div>
      <div class="card" style="grid-column: 1 / -1;">
        <h3>Atajos de teclado</h3>
        <p style="font-size:12px; color:#666; margin-bottom:0.75rem;">
          Hacé clic en un campo y presioná la tecla. <kbd>Backspace</kbd>/<kbd>Delete</kbd> para dejarlo vacío. <kbd>Esc</kbd> cancela la edición.
        </p>
        <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:0.4rem;">
          ${Object.entries(SHORTCUT_LABELS).map(([action, label]) => `
            <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; padding:0.35rem 0; border-bottom:1px solid var(--border);">
              <span style="font-size:13px;">${label}</span>
              <input type="text" class="shortcut-input" data-action="${action}" value="${(state.settings.shortcuts[action] || '').toUpperCase()}" onkeydown="captureShortcut(event, '${action}')" onfocus="this.select();">
            </div>
          `).join('')}
        </div>
        <button onclick="resetShortcuts()" style="margin-top:0.75rem;">Restaurar atajos por defecto</button>
      </div>
    </div>
  `;
}

function viewSearch() {
  const q = searchQuery.toLowerCase().trim();
  if (!q) return '<p>Escribe algo para buscar.</p>';
  const tasks = state.tasks.filter(t => (t.title || '').toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q) || (t.tags || []).some(x => x.toLowerCase().includes(q)));
  const notes = state.notes.filter(n => (n.title || '').toLowerCase().includes(q) || (n.content || '').toLowerCase().includes(q) || (n.tags || []).some(x => x.toLowerCase().includes(q)));
  return `
    <h2>Resultados · "${escapeHtml(searchQuery)}"</h2>
    <h3>Tareas (${tasks.length})</h3>
    ${tasks.map(taskRow).join('') || '<div class="empty">Sin resultados.</div>'}
    <h3 style="margin-top:1rem;">Notas (${notes.length})</h3>
    ${notes.length
      ? `<div class="notes-grid">${notes.map(n => `
          <div class="note-card" onclick="viewNote('${n.id}')">
            ${n.image ? `<img class="note-image" src="${n.image}" alt="">` : ''}
            <div class="note-title">${escapeHtml(n.title || '(sin título)')}</div>
            <div class="note-preview">${notePreview(n.content)}</div>
          </div>`).join('')}</div>`
      : '<div class="empty">Sin resultados.</div>'}
  `;
}

/* =============================================================
   SECCIÓN 11 · NAVEGACIÓN
============================================================= */
function openProject(id) { state.view = 'project'; state.viewParam = id; state.projectTab = 'tasks'; render(); }
function setProjectTab(tab) { state.projectTab = tab; render(); }
function openPlan(id) { state.view = 'plan'; state.viewParam = id; render(); }
function openTag(tag) {
  const tasks = state.tasks.filter(t => (t.tags || []).includes(tag));
  const notes = state.notes.filter(n => (n.tags || []).includes(tag));
  openModal(`
    <h3>#${escapeHtml(tag)}</h3>
    <h4 style="margin-top:0.75rem;">Tareas (${tasks.length})</h4>
    ${tasks.map(t => `<div class="task-row"><span class="title" onclick="closeModal(); editTask('${t.id}')">${escapeHtml(t.title)}</span></div>`).join('') || '<div class="empty">Sin tareas.</div>'}
    <h4 style="margin-top:0.75rem;">Notas (${notes.length})</h4>
    ${notes.map(n => `<div class="task-row"><span class="title" onclick="closeModal(); editNote('${n.id}')">${escapeHtml(n.title || '(sin título)')}</span></div>`).join('') || '<div class="empty">Sin notas.</div>'}
    <div style="margin-top:1rem; text-align:right;"><button onclick="closeModal()">Cerrar</button></div>
  `);
}

/* =============================================================
   SECCIÓN 12 · ACCIONES DE TAREAS
============================================================= */
function newTask(projectId = null) {
  editTaskForm({
    id: uid(), title: '', notes: '', projectId: projectId || null,
    status: 'pending', priority: 'medium', dueDate: todayStr(),
    tags: [], subtasks: [], recurrence: 'none', isNew: true
  });
}
function editTask(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  editTaskForm({ ...t, isNew: false });
}

function editTaskForm(task) {
  openModal(`
    <h3>${task.isNew ? 'Nueva tarea' : 'Editar tarea'}</h3>
    <form onsubmit="submitTask(event, '${task.id}')">
      <label>Título</label>
      <input type="text" id="task-title" value="${escapeHtml(task.title)}" required autofocus>
      <label>Notas</label>
      <textarea id="task-notes">${escapeHtml(task.notes || '')}</textarea>
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:0.5rem;">
        <div><label>Proyecto</label><select id="task-project"><option value="">(Inbox)</option>${state.projects.map(p => `<option value="${p.id}" ${p.id === task.projectId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select></div>
        <div><label>Prioridad</label><select id="task-priority">
          <option value="low" ${task.priority === 'low' ? 'selected' : ''}>Baja</option>
          <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>Media</option>
          <option value="high" ${task.priority === 'high' ? 'selected' : ''}>Alta</option>
        </select></div>
        <div><label>Vence</label><input type="date" id="task-due" value="${task.dueDate || ''}"></div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
        <div><label>Recurrencia</label><select id="task-recurrence">
          <option value="none" ${task.recurrence === 'none' ? 'selected' : ''}>Ninguna</option>
          <option value="daily" ${task.recurrence === 'daily' ? 'selected' : ''}>Diaria</option>
          <option value="weekly" ${task.recurrence === 'weekly' ? 'selected' : ''}>Semanal</option>
          <option value="monthly" ${task.recurrence === 'monthly' ? 'selected' : ''}>Mensual</option>
        </select></div>
        <div><label>Etiquetas (coma)</label><input type="text" id="task-tags" value="${escapeHtml((task.tags || []).join(', '))}"></div>
      </div>
      <label>Subtareas</label>
      <div id="subtask-list"></div>
      <button type="button" onclick="addSubtaskRow()" style="margin-bottom:0.5rem;">+ Subtarea</button>
      <div style="margin-top:0.5rem; display:flex; gap:0.5rem; justify-content:flex-end;">
        ${!task.isNew ? `<button type="button" class="btn-danger" onclick="deleteTask('${task.id}')" style="margin-right:auto;">Eliminar</button>` : ''}
        <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="primary">Guardar</button>
      </div>
    </form>
  `);
  (task.subtasks || []).forEach(s => addSubtaskRow(s.title, s.done));
}

function addSubtaskRow(title = '', done = false) {
  const list = document.getElementById('subtask-list');
  if (!list) return;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; gap:0.3rem; margin-bottom:0.3rem; align-items:center;';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = done; cb.style.width = 'auto';
  const inp = document.createElement('input'); inp.type = 'text'; inp.value = title; inp.placeholder = 'Subtarea'; inp.style.cssText = 'flex:1; margin:0;';
  const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = '×'; btn.onclick = () => row.remove();
  row.appendChild(cb); row.appendChild(inp); row.appendChild(btn);
  list.appendChild(row);
}

async function submitTask(e, id) {
  e.preventDefault();
  const existing = state.tasks.find(x => x.id === id);
  const task = {
    id,
    title: document.getElementById('task-title').value.trim(),
    notes: document.getElementById('task-notes').value.trim(),
    projectId: document.getElementById('task-project').value || null,
    priority: document.getElementById('task-priority').value,
    dueDate: document.getElementById('task-due').value || null,
    recurrence: document.getElementById('task-recurrence').value,
    tags: document.getElementById('task-tags').value.split(',').map(s => s.trim()).filter(Boolean),
    status: existing ? existing.status : 'pending',
    subtasks: [...document.querySelectorAll('#subtask-list > div')].map(row => ({
      id: uid(),
      title: row.querySelector('input[type="text"]').value.trim(),
      done: row.querySelector('input[type="checkbox"]').checked
    })).filter(s => s.title),
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await saveTask(task);
  closeModal();
  render();
}

async function toggleTask(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  if (t.status === 'pending' && t.recurrence && t.recurrence !== 'none') {
    const base = t.dueDate || todayStr();
    if (t.recurrence === 'daily') t.dueDate = addDays(base, 1);
    else if (t.recurrence === 'weekly') t.dueDate = addDays(base, 7);
    else if (t.recurrence === 'monthly') {
      const d = new Date(base + 'T00:00:00');
      d.setMonth(d.getMonth() + 1);
      t.dueDate = d.toISOString().slice(0, 10);
    }
  } else {
    t.status = t.status === 'done' ? 'pending' : 'done';
  }
  t.updatedAt = new Date().toISOString();
  await saveTask(t);
  render();
}

async function deleteTask(id) {
  if (!confirm('¿Eliminar tarea?')) return;
  await deleteItem('tasks', id, state.tasks);
  closeModal();
  render();
}

function startTaskSession(taskId) {
  const t = state.tasks.find(x => x.id === taskId);
  if (!t) return;
  state.settings.timerContext = { projectId: t.projectId || '', taskId: t.id };
  saveSettings();
  if (!timer.running && !timer.currentSession) {
    timer.mode = 'pomodoro';
    timer.onBreak = false;
    timer.remaining = state.settings.workDuration * 60;
    startTimer();
  }
  state.view = 'pomodoro'; state.viewParam = null;
  render();
}

/* =============================================================
   SECCIÓN 13 · ACCIONES DE NOTAS
============================================================= */
function newNote(projectId = null) {
  editNoteForm({ id: uid(), title: '', content: '', projectId: projectId || null, tags: [], image: '', isNew: true });
}
function editNote(id) {
  const n = state.notes.find(x => x.id === id);
  if (!n) return;
  editNoteForm({ ...n, isNew: false });
}

function viewNote(id) {
  const n = state.notes.find(x => x.id === id);
  if (!n) return;
  const proj = n.projectId ? state.projects.find(p => p.id === n.projectId) : null;
  
  openModal(`
    <h2 style="margin:0 0 0.5rem 0; font-size:1.6rem; font-family:var(--font-display); color:var(--text); text-transform:none;">${escapeHtml(n.title || '(sin título)')}</h2>
    
    <div style="display:flex; gap:1rem; font-size:12px; color:var(--text-muted); margin-bottom:1.5rem; flex-wrap:wrap; align-items:center;">
      ${proj ? `<span>📁 ${escapeHtml(proj.name)}</span>` : ''}
      ${(n.tags || []).length ? `<span>${(n.tags || []).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</span>` : ''}
      <span style="margin-left:auto; opacity:0.7;">Actualizada: ${new Date(n.updatedAt).toLocaleString()}</span>
    </div>

    ${n.image ? `<img src="${n.image}" style="max-width:100%; max-height:300px; border-radius:var(--radius-md); object-fit:cover; margin-bottom:1.5rem; display:block; border:1px solid var(--border);">` : ''}
    
    <div class="md-preview" style="border:none; padding:0; min-height:auto; background:transparent; font-size: 14px;">
      ${md(n.content || '')}
    </div>

    <div style="margin-top:2rem; display:flex; gap:0.5rem; justify-content:flex-end; border-top:1px solid var(--border); padding-top:1rem;">
      <button class="btn-ghost" onclick="closeModal()">Cerrar</button>
      <button class="primary" onclick="editNote('${n.id}')">Editar nota</button>
    </div>
  `);
}

function editNoteForm(note) {
  openModal(`
    <h3>${note.isNew ? 'Nueva nota' : 'Editar nota'}</h3>
    <form onsubmit="submitNote(event, '${note.id}')">
      <label>Título</label>
      <input type="text" id="note-title" value="${escapeHtml(note.title || '')}" required autofocus>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
        <div><label>Proyecto</label><select id="note-project"><option value="">(Ninguno)</option>${state.projects.map(p => `<option value="${p.id}" ${p.id === note.projectId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select></div>
        <div><label>Etiquetas (coma)</label><input type="text" id="note-tags" value="${escapeHtml((note.tags || []).join(', '))}"></div>
      </div>
      ${imageFieldHTML('note-image', note.image || '')}
      <label>Contenido (Markdown simple)</label>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
        <textarea id="note-content" style="min-height:240px;" oninput="document.getElementById('note-preview').innerHTML = md(this.value)">${escapeHtml(note.content || '')}</textarea>
        <div id="note-preview" class="md-preview">${md(note.content || '')}</div>
      </div>
      <div style="margin-top:0.5rem; display:flex; gap:0.5rem; justify-content:flex-end;">
        ${!note.isNew ? `<button type="button" class="btn-danger" onclick="deleteNote('${note.id}')" style="margin-right:auto;">Eliminar</button>` : ''}
        <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="primary">Guardar</button>
      </div>
    </form>
  `);
}

async function submitNote(e, id) {
  e.preventDefault();
  const existing = state.notes.find(x => x.id === id);
  const note = {
    id,
    title: document.getElementById('note-title').value.trim(),
    content: document.getElementById('note-content').value,
    projectId: document.getElementById('note-project').value || null,
    tags: document.getElementById('note-tags').value.split(',').map(s => s.trim()).filter(Boolean),
    image: document.getElementById('note-image').value || '',
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await saveNote(note);
  closeModal();
  render();
}
async function deleteNote(id) {
  if (!confirm('¿Eliminar nota?')) return;
  await deleteItem('notes', id, state.notes);
  closeModal();
  render();
}

/* =============================================================
   SECCIÓN 14 · ACCIONES DE PROYECTOS
============================================================= */
function newProject() {
  openModal(`
    <h3>Nuevo proyecto</h3>
    <form onsubmit="submitProject(event, null)">
      <label>Nombre</label>
      <input type="text" id="proj-name" required autofocus>
      <label>Descripción</label>
      <textarea id="proj-desc"></textarea>
      ${imageFieldHTML('proj-image', '')}
      <div style="margin-top:0.5rem; display:flex; gap:0.5rem; justify-content:flex-end;">
        <button type="button" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="primary">Guardar</button>
      </div>
    </form>
  `);
}
function editProject(id) {
  const p = state.projects.find(x => x.id === id);
  if (!p) return;
  openModal(`
    <h3>Editar proyecto</h3>
    <form onsubmit="submitProject(event, '${id}')">
      <label>Nombre</label>
      <input type="text" id="proj-name" value="${escapeHtml(p.name)}" required autofocus>
      <label>Descripción</label>
      <textarea id="proj-desc">${escapeHtml(p.description || '')}</textarea>
      ${imageFieldHTML('proj-image', p.image || '')}
      <div style="margin-top:0.5rem; display:flex; gap:0.5rem; justify-content:flex-end;">
        <button type="button" class="btn-danger" onclick="deleteProject('${id}')" style="margin-right:auto;">Eliminar</button>
        <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="primary">Guardar</button>
      </div>
    </form>
  `);
}
async function submitProject(e, id) {
  e.preventDefault();
  const existing = id ? state.projects.find(x => x.id === id) : null;
  const project = {
    id: id || uid(),
    name: document.getElementById('proj-name').value.trim(),
    description: document.getElementById('proj-desc').value.trim(),
    image: document.getElementById('proj-image').value || '',
    createdAt: existing ? existing.createdAt : new Date().toISOString()
  };
  await saveProject(project);
  closeModal();
  render();
}
async function deleteProject(id) {
  if (!confirm('¿Eliminar proyecto? Las tareas, notas y enlaces quedan sin proyecto.')) return;
  await deleteItem('projects', id, state.projects);
  for (const t of state.tasks.filter(t => t.projectId === id)) { t.projectId = null; await saveTask(t); }
  for (const n of state.notes.filter(n => n.projectId === id)) { n.projectId = null; await saveNote(n); }
  for (const l of state.links.filter(l => l.projectId === id)) { l.projectId = null; await saveLink(l); }
  if (state.view === 'project' && state.viewParam === id) { state.view = 'projects'; state.viewParam = null; }
  closeModal();
  render();
}

/* =============================================================
   SECCIÓN 15 · ACCIONES DE ACCESOS RÁPIDOS
============================================================= */
function newLink(projectId = null) {
  openModal(`
    <h3>Nuevo acceso rápido</h3>
    <form onsubmit="submitLink(event, '${projectId || ''}')">
      <label>Título</label>
      <input type="text" id="link-title" required autofocus>
      <label>URL</label>
      <input type="url" id="link-url" placeholder="https://..." required>
      <label>Tipo</label>
      <select id="link-type">
        <option value="link">Enlace normal</option>
        <option value="spotify">Spotify embed</option>
      </select>
      ${imageFieldHTML('link-image', '')}
      <div style="margin-top:0.5rem; display:flex; gap:0.5rem; justify-content:flex-end;">
        <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="primary">Guardar</button>
      </div>
    </form>
  `);
}
async function submitLink(e, projectId) {
  e.preventDefault();
  const link = {
    id: uid(),
    title: document.getElementById('link-title').value.trim(),
    url: document.getElementById('link-url').value.trim(),
    type: document.getElementById('link-type').value,
    image: document.getElementById('link-image').value || '', // <-- Guardamos la imagen
    projectId: projectId || null
  };
  await saveLink(link);
  closeModal();
  render();
}
async function deleteLink(id) {
  if (!confirm('¿Eliminar acceso rápido?')) return;
  await deleteItem('links', id, state.links);
  render();
}

/* =============================================================
   SECCIÓN 16 · ACCIONES DE PLANES
============================================================= */
function newPlan() {
  editPlanForm({ id: uid(), name: '', description: '', subjects: [], image: '', isNew: true });
}
function editPlan(id) {
  const p = state.plans.find(x => x.id === id);
  if (!p) return;
  editPlanForm({ ...p, isNew: false });
}
function editPlanForm(plan) {
  openModal(`
    <h3>${plan.isNew ? 'Nuevo plan' : 'Editar plan'}</h3>
    <form onsubmit="submitPlan(event, '${plan.id}')">
      <label>Nombre</label>
      <input type="text" id="plan-name" value="${escapeHtml(plan.name || '')}" required autofocus>
      
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;">
        <div>
          <label>Categoría</label>
          <select id="plan-type">
            <option value="academic" ${plan.type === 'personal' ? '' : 'selected'}>Académico (Escuela/Uni)</option>
            <option value="personal" ${plan.type === 'personal' ? 'selected' : ''}>Personal (Hobbies/Skills)</option>
          </select>
        </div>
        <div>
          <label>Descripción</label>
          <input type="text" id="plan-desc" value="${escapeHtml(plan.description || '')}">
        </div>
      </div>
      
      ${imageFieldHTML('plan-image', plan.image || '')}
      
      <label>Materias / Secciones</label>
      <div id="subject-list"></div>
      <button type="button" onclick="addSubjectRow()" style="margin-bottom:0.5rem;">+ Materia/Sección</button>
      
      <div style="margin-top:0.5rem; display:flex; gap:0.5rem; justify-content:flex-end;">
        ${!plan.isNew ? `<button type="button" class="btn-danger" onclick="deletePlan('${plan.id}')" style="margin-right:auto;">Eliminar</button>` : ''}
        <button type="button" class="btn-ghost" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="primary">Guardar</button>
      </div>
    </form>
  `);
  (plan.subjects || []).forEach(s => addSubjectRow(s.name, (s.topics || []).map(t => t.name).join('\n')));
  if (!(plan.subjects || []).length) addSubjectRow();
}

function addSubjectRow(name = '', topicsText = '') {
  const list = document.getElementById('subject-list');
  if (!list) return;
  const div = document.createElement('div');
  div.style.cssText = 'border:1px solid #ddd; padding:0.5rem; margin-bottom:0.5rem; border-radius:4px;';
  div.innerHTML = `
    <div style="display:flex; gap:0.3rem; margin-bottom:0.3rem; align-items:center;">
      <input type="text" class="subject-name" placeholder="Nombre de la materia" value="${escapeHtml(name)}" style="flex:1; margin:0;">
      <button type="button" onclick="this.parentElement.parentElement.remove()">×</button>
    </div>
    <textarea class="subject-topics" placeholder="Temas (uno por línea)" style="margin:0; min-height:60px;">${escapeHtml(topicsText)}</textarea>
  `;
  list.appendChild(div);
}

async function submitPlan(e, id) {
  e.preventDefault();
  const existing = state.plans.find(x => x.id === id);
  
  const subjects = [...document.querySelectorAll('#subject-list > div')].map(div => {
    const name = div.querySelector('.subject-name').value.trim();
    const topicsText = div.querySelector('.subject-topics').value;
    const topicNames = topicsText.split('\n').map(s => s.trim()).filter(Boolean);
    const existingSub = existing && (existing.subjects || []).find(s => s.name === name);
    
    return {
      id: existingSub ? existingSub.id : uid(),
      name,
      exams: existingSub ? (existingSub.exams || []) : [], // <-- NUEVA LÍNEA PARA CONSERVAR EXÁMENES
      topics: topicNames.map(tn => {
        const et = existingSub && (existingSub.topics || []).find(t => t.name === tn);
        return { id: et ? et.id : uid(), name: tn, done: et ? et.done : false };
      })
    };
  }).filter(s => s.name);
  
  const plan = {
    id,
    name: document.getElementById('plan-name').value.trim(),
    type: document.getElementById('plan-type').value,
    description: document.getElementById('plan-desc').value.trim(),
    image: document.getElementById('plan-image').value || '',
    subjects,
    createdAt: existing ? existing.createdAt : new Date().toISOString()
  };
  await savePlan(plan);
  closeModal();
  render();
}

async function deletePlan(id) {
  if (!confirm('¿Eliminar plan de estudio?')) return;
  await deleteItem('plans', id, state.plans);
  if (state.view === 'plan' && state.viewParam === id) { state.view = 'plans'; state.viewParam = null; }
  closeModal();
  render();
}
async function toggleTopic(planId, subjId, topicId) {
  const p = state.plans.find(x => x.id === planId);
  if (!p) return;
  const sub = (p.subjects || []).find(s => s.id === subjId);
  if (!sub) return;
  const topic = (sub.topics || []).find(t => t.id === topicId);
  if (!topic) return;
  topic.done = !topic.done;
  await savePlan(p);
  render();
}

/* =============================================================
   SECCIÓN 17 · BÚSQUEDA GLOBAL
============================================================= */
document.getElementById('search-main').addEventListener('input', e => {
  searchQuery = e.target.value;
  if (searchQuery.trim()) {
    state.view = 'search';
    state.viewParam = null;
    render();
  } else if (state.view === 'search') {
    state.view = 'panel';
    render();
  }
});

/* =============================================================
   SECCIÓN 18 · POMODORO / TIMER
============================================================= */
const timer = {
  mode: 'pomodoro',
  running: false,
  remaining: 25 * 60,
  elapsed: 0,
  onBreak: false,
  intervalId: null,
  currentSession: null,
  lastTick: null // <-- Agregado para persistencia
};

function saveTimerState() {
  const stateToSave = {
    mode: timer.mode,
    running: timer.running,
    remaining: timer.remaining,
    elapsed: timer.elapsed,
    onBreak: timer.onBreak,
    currentSession: timer.currentSession,
    lastTick: Date.now()
  };
  localStorage.setItem('pcb_timer_state', JSON.stringify(stateToSave));
}

function loadTimerState() {
  const saved = localStorage.getItem('pcb_timer_state');
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved);
    timer.mode = parsed.mode;
    timer.currentSession = parsed.currentSession;
    timer.onBreak = parsed.onBreak;
    timer.remaining = parsed.remaining;
    timer.elapsed = parsed.elapsed;
    timer.running = parsed.running;
    
    // Si estaba corriendo, calculamos cuánto tiempo pasó desde que se cerró la pestaña
    if (timer.running && parsed.lastTick) {
      const delta = Math.floor((Date.now() - parsed.lastTick) / 1000);
      if (delta > 0) {
        if (timer.mode === 'pomodoro') {
          timer.remaining -= delta;
        } else {
          timer.elapsed += delta;
        }
      }
    }

    if (timer.running) {
      // Si el reloj llegó a cero mientras la app estaba cerrada
      if (timer.mode === 'pomodoro' && timer.remaining <= 0) {
        timer.remaining = 0;
        timer.running = false;
        setTimeout(async () => {
          await finalizeSession();
          timer.onBreak = false;
          timer.remaining = state.settings.workDuration * 60;
          saveTimerState();
          render();
          alert('El Pomodoro terminó mientras estabas fuera.');
        }, 500);
      } else {
        // Si todavía queda tiempo, seguimos el intervalo
        timer.intervalId = setInterval(tickTimer, 1000);
      }
    }
  } catch(e) {
    console.error('Error cargando el timer', e);
  }
}

function getCurrentSessionDuration() {
  if (!timer.currentSession) return 0;
  if (timer.currentSession.type === 'stopwatch') return timer.elapsed;
  if (timer.onBreak) return state.settings.breakDuration * 60 - Math.max(0, timer.remaining);
  return state.settings.workDuration * 60 - Math.max(0, timer.remaining);
}

function startTimer() {
  if (timer.running) return;
  if (!timer.currentSession) {
    const ctx = state.settings.timerContext || {};
    if (!ctx.projectId && !ctx.taskId) {
      if (!confirm('No asignaste esta sesión a ningún proyecto ni tarea. ¿Iniciar igual?')) return;
    }
    const proj = ctx.projectId ? state.projects.find(p => p.id === ctx.projectId) : null;
    const task = ctx.taskId ? state.tasks.find(t => t.id === ctx.taskId) : null;
    timer.currentSession = {
      type: timer.mode === 'stopwatch' ? 'stopwatch' : (timer.onBreak ? 'break' : 'pomodoro'),
      projectId: ctx.projectId || null,
      projectName: proj ? proj.name : null,
      taskId: ctx.taskId || null,
      taskTitle: task ? task.title : null,
      startedAt: new Date().toISOString()
    };
  }
  timer.running = true;
  timer.intervalId = setInterval(tickTimer, 1000);
  saveTimerState(); // Guardamos
  updateTimerDisplays();
}

function pauseTimer() {
  timer.running = false;
  if (timer.intervalId) { clearInterval(timer.intervalId); timer.intervalId = null; }
  updateTimerDisplays();
  saveTimerState(); // Guardamos
}

function toggleTimer() { 
  timer.running ? pauseTimer() : startTimer(); 
  render(); // <-- Forzamos a que la pantalla se actualice para mostrar el botón
}

async function stopTimerAndSave() {
  if (!timer.currentSession) return;
  await finalizeSession();
  resetTimer(); // Resetea el reloj visualmente
  render();     // Actualiza la pantalla
}

function resetTimer() {
  pauseTimer();
  timer.currentSession = null;
  if (timer.mode === 'pomodoro') {
    timer.onBreak = false;
    timer.remaining = state.settings.workDuration * 60;
  } else {
    timer.elapsed = 0;
  }
  updateTimerDisplays();
  saveTimerState(); // Guardamos
}

async function setTimerMode(mode) {
  if (timer.currentSession) {
    if (!confirm('Hay una sesión en curso. ¿Deseas guardar el progreso y cambiar de modo?')) return;
    await finalizeSession();
  }
  pauseTimer();
  timer.currentSession = null;
  timer.mode = mode;
  if (mode === 'pomodoro') {
    timer.onBreak = false;
    timer.remaining = state.settings.workDuration * 60;
  } else {
    timer.elapsed = 0;
  }
  saveTimerState();
  render();
}

async function finalizeSession() {
  if (!timer.currentSession) return;
  const cs = timer.currentSession;
  
  // Calculamos el tiempo REAL transcurrido
  let duration = 0;
  if (cs.type === 'stopwatch') {
    duration = timer.elapsed;
  } else if (cs.type === 'break') {
    duration = (state.settings.breakDuration * 60) - Math.max(0, timer.remaining);
  } else {
    duration = (state.settings.workDuration * 60) - Math.max(0, timer.remaining);
  }

  if (duration <= 0) { timer.currentSession = null; return; }
  
  const session = {
    id: uid(),
    type: cs.type,
    projectId: cs.projectId,
    projectName: cs.projectName,
    taskId: cs.taskId,
    taskTitle: cs.taskTitle,
    duration: duration,
    startedAt: cs.startedAt,
    endedAt: new Date().toISOString()
  };
  
  await DB.put('sessions', session);
  state.sessions.push(session);
  timer.currentSession = null;
  localStorage.removeItem('pcb_timer_state');
}

async function tickTimer() {
  if (timer.mode === 'pomodoro') {
    if (timer.onBreak) {
      timer.remaining--;
      if (timer.remaining <= 0) {
        await finalizeSession();
        timer.onBreak = false;
        timer.remaining = state.settings.workDuration * 60;
        pauseTimer();
        notify('Descanso terminado');
      }
    } else {
      timer.remaining--;
      if (timer.remaining <= 0) {
        await finalizeSession();
        timer.onBreak = true;
        timer.remaining = state.settings.breakDuration * 60;
        pauseTimer();
        notify('Pomodoro completado');
      }
    }
  } else {
    timer.elapsed++;
  }
  updateTimerDisplays();
  saveTimerState(); // Guardamos
}

function updateTimerDisplays() {
  document.querySelectorAll('[data-timer-display]').forEach(el => {
    el.textContent = timer.mode === 'pomodoro' ? fmtTime(Math.max(0, timer.remaining)) : fmtTime(timer.elapsed);
    el.style.color = timer.onBreak ? '#00FF9F' : ''; // Verde neón en descanso, color normal en foco
  });
  
  document.querySelectorAll('[data-timer-mode]').forEach(el => {
    el.textContent = timer.mode === 'pomodoro' ? (timer.onBreak ? 'Descanso' : 'Pomodoro') : 'Cronómetro';
  });

  // Actualizar la barra de progreso
  const progressBars = document.querySelectorAll('[data-timer-progress]');
  progressBars.forEach(bar => {
    if (timer.mode === 'stopwatch') {
      // En cronómetro no hay un "fin", así que la barra se llena lentamente cada hora (3600s)
      const pct = Math.min(100, ((timer.elapsed % 3600) / 3600) * 100);
      bar.style.width = `${pct}%`;
      bar.style.background = 'var(--info)';
      bar.style.boxShadow = '0 0 10px var(--info)';
    } else {
      const total = timer.onBreak ? state.settings.breakDuration * 60 : state.settings.workDuration * 60;
      const elapsed = total - Math.max(0, timer.remaining);
      const pct = Math.min(100, (elapsed / total) * 100);
      
      bar.style.width = `${pct}%`;
      if (timer.onBreak) {
        bar.style.background = 'var(--success)'; // Verde
        bar.style.boxShadow = '0 0 10px var(--success)';
      } else {
        bar.style.background = 'var(--accent)'; // Amarillo
        bar.style.boxShadow = '0 0 10px var(--accent)';
      }
    }
  });

  const usageEl = document.querySelector('[data-usage-active-time]');
  if (usageEl && timer.currentSession) usageEl.textContent = formatDuration(getCurrentSessionDuration());
}

function notify(msg) {
  if ('Notification' in window) {
    if (Notification.permission === 'granted') new Notification(msg);
    else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => { if (p === 'granted') new Notification(msg); });
  }
  console.log(msg);
}

function onTimerProjectChange(value) {
  state.settings.timerContext.projectId = value || '';
  state.settings.timerContext.taskId = '';
  saveSettings();
  render();
}

function onTimerTaskChange(value) {
  state.settings.timerContext.taskId = value || '';
  saveSettings();
  render();
}

async function changeWorkDuration(v) {
  const n = parseInt(v, 10);
  if (!n || n < 1) return;
  state.settings.workDuration = n;
  if (timer.mode === 'pomodoro' && !timer.running && !timer.onBreak && !timer.currentSession) timer.remaining = n * 60;
  await saveSettings();
  updateTimerDisplays();
}

async function changeBreakDuration(v) {
  const n = parseInt(v, 10);
  if (!n || n < 1) return;
  state.settings.breakDuration = n;
  if (timer.mode === 'pomodoro' && !timer.running && timer.onBreak && !timer.currentSession) timer.remaining = n * 60;
  await saveSettings();
  updateTimerDisplays();
}

/* =============================================================
   SECCIÓN 19 · USO DEL TIEMPO · FILTROS Y ACCIONES
============================================================= */
function setTimeFilter(key, value) {
  state.timeFilters[key] = value;
  if (key === 'projectId') state.timeFilters.taskId = '';
  render();
}

async function deleteSession(id) {
  if (!confirm('¿Eliminar esta sesión del historial?')) return;
  await deleteItem('sessions', id, state.sessions);
  render();
}

function assignSession(id) {
  openModal(`
    <h3>Asignar sesión</h3>
    <form onsubmit="submitAssignSession(event, '${id}')">
      <label>Proyecto</label>
      <select id="as-project" onchange="(function(sel){var t=document.getElementById('as-task');t.innerHTML='<option value=&quot;&quot;>Sin tarea</option>';state.tasks.filter(function(x){return x.projectId===sel.value;}).forEach(function(x){var o=document.createElement('option');o.value=x.id;o.textContent=x.title;t.appendChild(o);});})(this)">
        <option value="">Sin proyecto</option>
        ${state.projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
      </select>
      <label>Tarea (opcional)</label>
      <select id="as-task"><option value="">Sin tarea</option></select>
      <div style="margin-top:0.5rem; display:flex; gap:0.5rem; justify-content:flex-end;">
        <button type="button" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="primary">Guardar</button>
      </div>
    </form>
  `);
}

async function submitAssignSession(e, id) {
  e.preventDefault();
  const s = state.sessions.find(x => x.id === id);
  if (!s) return;
  const projectId = document.getElementById('as-project').value || null;
  const taskId = document.getElementById('as-task').value || null;
  const proj = projectId ? state.projects.find(p => p.id === projectId) : null;
  const task = taskId ? state.tasks.find(t => t.id === taskId) : null;
  s.projectId = projectId;
  s.projectName = proj ? proj.name : null;
  s.taskId = taskId;
  s.taskTitle = task ? task.title : null;
  await DB.put('sessions', s);
  closeModal();
  render();
}

function newManualSession() {
  openModal(`
    <h3>Nueva sesión manual</h3>
    <form onsubmit="submitManualSession(event)">
      <label>Proyecto</label>
      <select id="ms-project" onchange="(function(sel){var t=document.getElementById('ms-task');t.innerHTML='<option value=&quot;&quot;>Sin tarea</option>';state.tasks.filter(function(x){return x.projectId===sel.value;}).forEach(function(x){var o=document.createElement('option');o.value=x.id;o.textContent=x.title;t.appendChild(o);});})(this)">
        <option value="">Sin proyecto</option>
        ${state.projects.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
      </select>
      <label>Tarea (opcional)</label>
      <select id="ms-task"><option value="">Sin tarea</option></select>
      <label>Tipo</label>
      <select id="ms-type">
        <option value="pomodoro">Pomodoro</option>
        <option value="stopwatch">Cronómetro</option>
        <option value="break">Descanso</option>
      </select>
      <label>Duración (minutos)</label>
      <input type="number" id="ms-duration" min="1" value="25" required>
      <label>Fecha</label>
      <input type="date" id="ms-date" value="${todayStr()}" required>
      <label>Hora de inicio</label>
      <input type="time" id="ms-time" value="09:00" required>
      <div style="margin-top:0.5rem; display:flex; gap:0.5rem; justify-content:flex-end;">
        <button type="button" onclick="closeModal()">Cancelar</button>
        <button type="submit" class="primary">Guardar</button>
      </div>
    </form>
  `);
}

async function submitManualSession(e) {
  e.preventDefault();
  const projectId = document.getElementById('ms-project').value || null;
  const taskId = document.getElementById('ms-task').value || null;
  const type = document.getElementById('ms-type').value;
  const minutes = parseInt(document.getElementById('ms-duration').value, 10);
  const date = document.getElementById('ms-date').value;
  const time = document.getElementById('ms-time').value;
  if (!minutes || minutes < 1) return;
  const startedAt = new Date(date + 'T' + time + ':00').toISOString();
  const endedAt = new Date(new Date(startedAt).getTime() + minutes * 60000).toISOString();
  const proj = projectId ? state.projects.find(p => p.id === projectId) : null;
  const task = taskId ? state.tasks.find(t => t.id === taskId) : null;
  const session = {
    id: uid(),
    type,
    projectId,
    projectName: proj ? proj.name : null,
    taskId,
    taskTitle: task ? task.title : null,
    duration: minutes * 60,
    startedAt,
    endedAt,
    manual: true
  };
  await DB.put('sessions', session);
  state.sessions.push(session);
  closeModal();
  render();
}

/* =============================================================
   SECCIÓN 20 · EXPORT / IMPORT
============================================================= */
async function exportData() {
  const data = {};
  for (const store of DB_STORES) data[store] = await DB.getAll(store);
  
  // Guardamos la fecha del último backup en la configuración
  state.settings.lastBackup = new Date().toISOString();
  
  // Nos aseguramos de que el archivo JSON incluya esta nueva configuración
  let settingsObj = data.settings.find(x => x.id === 'main');
  if (!settingsObj) { settingsObj = { id: 'main', value: {} }; data.settings.push(settingsObj); }
  settingsObj.value = state.settings;
  
  await saveSettings(); // Lo guardamos en IndexedDB

  // Generamos un nombre de archivo con fecha y hora (Ej: PCB_BACKUP_2023-10-25_14-30.json)
  const d = new Date();
  const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}-${String(d.getMinutes()).padStart(2,'0')}`;
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `PCB_BACKUP_${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
  
  render(); // Actualizamos la vista para que se vea la nueva fecha
}

async function importData(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const data = JSON.parse(await file.text());
  if (!confirm('Esto reemplazará TODOS los datos actuales. ¿Continuar?')) { ev.target.value = ''; return; }
  for (const store of ['projects','tasks','notes','plans','links','sessions']) {
    const all = await DB.getAll(store);
    for (const item of all) await DB.del(store, item.id);
    for (const item of (data[store] || [])) await DB.put(store, item);
  }
  if (data.settings) {
    const s = data.settings.find(x => x.id === 'main');
    if (s) await DB.put('settings', s);
  }
  await loadAll();
  render();
  ev.target.value = '';
  alert('Datos importados.');
}

/* =============================================================
   SECCIÓN 21 · ATAJOS CONFIGURABLES
============================================================= */
function captureShortcut(e, action) {
  if (e.key === 'Tab') return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') { e.target.blur(); return; }
  if (e.key === 'Backspace' || e.key === 'Delete') {
    state.settings.shortcuts[action] = '';
    saveSettings();
    e.target.value = '';
    return;
  }
  if (e.key.length !== 1) return;
  const k = e.key.toLowerCase();
  if (!/^[a-z0-9 ]$/.test(k)) return;
  for (const [other, val] of Object.entries(state.settings.shortcuts)) {
    if (other !== action && val === k) state.settings.shortcuts[other] = '';
  }
  state.settings.shortcuts[action] = k;
  saveSettings();
  e.target.value = k.toUpperCase();
}

async function resetShortcuts() {
  if (!confirm('¿Restaurar todos los atajos a sus valores por defecto?')) return;
  state.settings.shortcuts = { ...DEFAULT_SHORTCUTS };
  await saveSettings();
  render();
}

/* =============================================================
   SECCIÓN 22 · SIDEBAR Y ATAJOS GLOBALES
============================================================= */
document.querySelectorAll('#nav a').forEach(a => {
  a.addEventListener('click', () => {
    document.getElementById('search-main').value = '';
    searchQuery = '';
    state.view = a.dataset.view;
    state.viewParam = null;
    render();
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); return; }
  if (!$('#modal').classList.contains('hidden')) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (!k) return;
  const sc = state.settings.shortcuts;
  if      (sc.newTask      && k === sc.newTask)      { e.preventDefault(); newTask(currentProjectContext()); }
  else if (sc.newNote      && k === sc.newNote)      { e.preventDefault(); newNote(currentProjectContext()); }
  else if (sc.newProject   && k === sc.newProject)   { e.preventDefault(); newProject(); }
  else if (sc.newPlan      && k === sc.newPlan)      { e.preventDefault(); newPlan(); }
  else if (sc.openPomodoro && k === sc.openPomodoro) { e.preventDefault(); state.view = 'pomodoro';  state.viewParam = null; render(); }
  else if (sc.openUsage    && k === sc.openUsage)    { e.preventDefault(); state.view = 'timeusage'; state.viewParam = null; render(); }
  else if (sc.openPanel    && k === sc.openPanel)    { e.preventDefault(); state.view = 'panel';     state.viewParam = null; render(); }
  else if (sc.openSearch   && k === sc.openSearch)   { e.preventDefault(); $('#search-main').focus(); }
});

/* =============================================================
   SECCIÓN 23 · BOOT
============================================================= */
(async function init() {
  try {
    await loadAll();
    await seed();
    loadTimerState(); // <-- Cargamos el timer antes de dibujar
    render();

    // --- Registro de la PWA ---
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then(reg => console.log('PWA Service Worker listo', reg.scope))
          .catch(err => console.warn('Error al registrar SW:', err));
      });
    }
    // --------------------------
    
  } catch (err) {
    console.error(err);
    document.getElementById('main-content').innerHTML = `<div class="card" style="color:#c33;">Error al iniciar: ${escapeHtml(err.message)}</div>`;
  }
})();