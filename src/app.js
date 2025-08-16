// Global state
let currentView = "home"
let trees = []
let allPeople = []
let currentTree = null
let editingPerson = null

// ====== Alta de persona en modo "asistente paso a paso" ======
let createWizard = null; // estado del asistente

/* ===== Poe: perrito que pide cariño cada minuto (bloqueante) ===== */
const PET_INTERVAL_MS = 60 * 1000; // 1 minuto
let petTimer = null;
let dogWidgetReady = false;

/* ===== Confirmación con mantener presionado (hold-to-confirm) ===== */
function showHoldConfirm({ title="Confirmación", text="¿Confirmar?", confirmText="Mantener para confirmar", cancelText="Cancelar" }){
  return new Promise((resolve)=>{
    const overlay = document.createElement('div');
    overlay.className = 'hold-overlay';
    overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true');

    // Bloquear ESC y clic fuera
    const escBlocker = (e)=>{ if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); } };
    document.addEventListener('keydown', escBlocker, true);
    overlay.addEventListener('click',(e)=>{ if (e.target===overlay){ e.stopPropagation(); } }, true);

    const win = document.createElement('div');
    win.className = 'hold-window';

    const h = document.createElement('div'); h.className='hold-title'; h.textContent=title;
    const p = document.createElement('div'); p.className='hold-text';  p.textContent=text;

    const actions = document.createElement('div'); actions.className='hold-actions';

    const btnCancel = document.createElement('button');
    btnCancel.className='hold-cancel';
    btnCancel.textContent = cancelText;

    const btnHold = document.createElement('button');
    btnHold.type='button'; btnHold.className='hold-press';
    btnHold.innerHTML = `<div class="hold-fill"></div><span class="hold-label">${confirmText}</span>`;

    actions.appendChild(btnCancel);
    actions.appendChild(btnHold);

    win.appendChild(h); win.appendChild(p); win.appendChild(actions);
    overlay.appendChild(win); document.body.appendChild(overlay);

    // Lógica de mantener presionado
    const fill = btnHold.querySelector('.hold-fill');
    let progress = 0;
    let timer = null;

    const start = ()=>{
      if (timer) return;
      timer = setInterval(()=>{
        progress = Math.min(100, progress + 4); // ~1.5s
        fill.style.width = progress + '%';
        if (progress >= 100){ done(true); }
      }, 60);
    };
    const stop = ()=>{
      clearInterval(timer); timer = null;
      progress = 0; fill.style.width = '0%';
    };

    function done(val){
      clearInterval(timer); timer = null;
      document.removeEventListener('keydown', escBlocker, true);
      overlay.remove();
      resolve(val);
    }

    // Eventos mouse/touch
    btnHold.addEventListener('mousedown', start);
    btnHold.addEventListener('mouseup', stop);
    btnHold.addEventListener('mouseleave', stop);
    btnHold.addEventListener('touchstart', (e)=>{ e.preventDefault(); start(); }, {passive:false});
    btnHold.addEventListener('touchend',   (e)=>{ e.preventDefault(); stop(); }, {passive:false});
    btnHold.addEventListener('touchcancel',(e)=>{ e.preventDefault(); stop(); }, {passive:false});

    btnCancel.addEventListener('click', ()=> done(false));
  });
}


// Utilidad común
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Rect relativo al contenedor
function getLocalRect(container, el) {
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return {
    x: r.left - c.left,
    y: r.top  - c.top,
    w: r.width,
    h: r.height
  };
}

// ¿Rectángulos se solapan? (con margen)
function rectsOverlap(a, b, margin = 8) {
  return !(
    a.x + a.w + margin < b.x ||
    b.x + b.w + margin < a.x ||
    a.y + a.h + margin < b.y ||
    b.y + b.h + margin < a.y
  );
}

// Ajusta una posición candidata (x,y) para que NO se solape con otros botones.
function resolveOverlap(container, movingBtn, otherButtons, x, y) {
  const c = container.getBoundingClientRect();
  const mb = movingBtn.getBoundingClientRect();
  const pad = 6;

  let nx = clamp(x, pad, c.width  - mb.width  - pad);
  let ny = clamp(y, pad, c.height - mb.height - pad);

  // Iterar empujando fuera de colisiones
  for (let iter = 0; iter < 24; iter++) {
    const mRect = { x: nx, y: ny, w: mb.width, h: mb.height };
    let collided = false;

    for (const ob of otherButtons) {
      // Si el otro aún no está colocado, lo ignoramos
      const obRectDOM = ob.style.left ? getLocalRect(container, ob) : { x: -9999, y: -9999, w: 0, h: 0 };
      if (rectsOverlap(mRect, obRectDOM, 8)) {
        collided = true;

        // Empuje en la dirección opuesta al centro del otro
        const ocx = obRectDOM.x + obRectDOM.w / 2;
        const ocy = obRectDOM.y + obRectDOM.h / 2;
        const ccx = mRect.x + mRect.w / 2;
        const ccy = mRect.y + mRect.h / 2;
        let vx = ccx - ocx, vy = ccy - ocy;
        if (vx === 0 && vy === 0) { vx = (Math.random() < .5 ? 1 : -1); vy = (Math.random() < .5 ? 1 : -1); }
        const len = Math.hypot(vx, vy) || 1;
        vx /= len; vy /= len;

        const push = 16; // px por iteración
        nx = clamp(nx + vx * push, pad, c.width  - mb.width  - pad);
        ny = clamp(ny + vy * push, pad, c.height - mb.height - pad);
      }
    }
    if (!collided) break;
  }

  return { x: nx, y: ny };
}


/* ===== Modales personalizados con botones que huyen ===== */
function showRunawayConfirm({ title="Confirmación", text="", confirmText="Sí", cancelText="Cancelar" }){
  return new Promise((resolve)=>{
    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'runaway-overlay';
    overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true');

    // Bloquear ESC y clic fuera
    const escBlocker = (e)=>{ if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); } };
    document.addEventListener('keydown', escBlocker, true);
    overlay.addEventListener('click',(e)=>{ if (e.target===overlay){ e.stopPropagation(); } }, true);

    // Ventana
    const win = document.createElement('div');
    win.className = 'runaway-window';

    const h = document.createElement('div'); h.className='runaway-title'; h.textContent=title;
    const p = document.createElement('div'); p.className='runaway-text';  p.textContent=text;

    const actions = document.createElement('div'); actions.className='runaway-actions';
    const btnOK = document.createElement('button');   btnOK.className='runaway-btn primary'; btnOK.textContent = confirmText;
    const btnCancel = document.createElement('button'); btnCancel.className='runaway-btn';    btnCancel.textContent = cancelText;

    actions.appendChild(btnOK); actions.appendChild(btnCancel);
    win.appendChild(h); win.appendChild(p); win.appendChild(actions);
    overlay.appendChild(win); document.body.appendChild(overlay);

    // Colocar botones y activar “huida”
    placeButtonsRandom(actions, [btnOK, btnCancel]);
    enableRunaway(actions, [btnOK, btnCancel]);

    // Handlers de click
    const cleanup = ()=>{ document.removeEventListener('keydown', escBlocker, true); overlay.remove(); };
    btnOK.addEventListener('click', ()=>{ cleanup(); resolve(true);  });
    btnCancel.addEventListener('click', ()=>{ cleanup(); resolve(false); });
  });
}

function placeButtonsRandom(container, buttons) {
  const c = container.getBoundingClientRect();
  const pad = 6;

  const placed = [];
  buttons.forEach(btn => {
    // Posición candidata aleatoria
    const br = btn.getBoundingClientRect();
    let x = pad + Math.random() * (c.width  - br.width  - 2 * pad);
    let y = pad + Math.random() * (c.height - br.height - 2 * pad);

    // Ajuste para evitar solapamiento con los ya colocados
    const pos = resolveOverlap(container, btn, placed, x, y);
    btn.style.left = pos.x + 'px';
    btn.style.top  = pos.y + 'px';

    placed.push(btn);
  });
}

function enableRunaway(container, buttons) {
  const moveCounts = new Map(buttons.map(b => [b, 0]));

  const runAway = (btn, pointerX, pointerY) => {
    const cRect = container.getBoundingClientRect();
    const bRect = btn.getBoundingClientRect();

    const localX = pointerX - cRect.left;
    const localY = pointerY - cRect.top;

    const bx = (parseFloat(btn.style.left || 0)) + bRect.width / 2;
    const by = (parseFloat(btn.style.top  || 0)) + bRect.height / 2;

    const dx = bx - localX, dy = by - localY;
    const dist = Math.hypot(dx, dy);

    if (dist < 110) {
      // Candidato “huyendo” del puntero
      const factor = 1.2 + Math.random() * 0.8;
      let xCand = bx + (dx || 1) * factor - bRect.width / 2;
      let yCand = by + (dy || 1) * factor - bRect.height / 2;

      // Desgaste: tras muchos movimientos, huye menos
      const count = moveCounts.get(btn) || 0;
      if (count > 12) {
        xCand += (Math.random() * 20 - 10);
        yCand += (Math.random() * 10 - 5);
      }

      // Ajustar para NO solapar con los otros
      const otherButtons = buttons.filter(b => b !== btn);
      const pos = resolveOverlap(container, btn, otherButtons, xCand, yCand);

      btn.style.left = pos.x + 'px';
      btn.style.top  = pos.y + 'px';

      moveCounts.set(btn, count + 1);
    }
  };

  // Huir si el puntero se acerca (sobre el contenedor)
  container.addEventListener('mousemove', (e) => {
    buttons.forEach(btn => runAway(btn, e.clientX, e.clientY));
  });

  // Huir inmediato si “rozan” el botón
  buttons.forEach(btn => {
    btn.addEventListener('mouseenter', (e) => runAway(btn, e.clientX, e.clientY));
    btn.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      runAway(btn, t.clientX, t.clientY);
    }, { passive: true });
  });
}



function initDogCompanion(){
  if (dogWidgetReady) return; dogWidgetReady = true;

  // Widget en esquina
  const dog = document.createElement('div');
  dog.className = 'dog-widget';
  dog.innerHTML = `<div class="dog-emoji">🐶</div><div class="dog-name">Poe</div>`;
  document.body.appendChild(dog);

  // Clic manual sobre el widget: también abre el cariño (opcional)
  dog.addEventListener('click', () => showPetPrompt(true));

  // Iniciar ciclo
  schedulePetCheck();
}

function schedulePetCheck(){
  clearTimeout(petTimer);
  petTimer = setTimeout(() => {
    // Si hay tutorial en curso, esperar a que termine
    if (document.querySelector('.tutorial-overlay')) {
      // reintentar en 5s
      schedulePetCheckSoon(5000);
    } else {
      showPetPrompt(false);
    }
  }, PET_INTERVAL_MS);
}
function schedulePetCheckSoon(ms){
  clearTimeout(petTimer);
  petTimer = setTimeout(() => {
    if (document.querySelector('.tutorial-overlay')) return schedulePetCheckSoon(3000);
    showPetPrompt(false);
  }, ms);
}

function showPetPrompt(userInitiated){
  // Evitar duplicados
  if (document.querySelector('.pet-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'pet-overlay';
  overlay.setAttribute('role','dialog');
  overlay.setAttribute('aria-modal','true');
  overlay.setAttribute('aria-label','Poe necesita cariño');

  // Bloquear ESC
  const escBlocker = (e)=>{ if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); } };
  document.addEventListener('keydown', escBlocker, true);

  // Bloquear scroll
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  // Caja
  const box = document.createElement('div');
  box.className = 'pet-box';

  const title = document.createElement('div');
  title.className = 'pet-title';
  title.textContent = 'Poe necesita cariño';

  const text = document.createElement('div');
  text.className = 'pet-text';
  text.textContent = 'Mantenga presionado sobre Poe hasta llenar la barra para poder continuar.';

  const dogArea = document.createElement('div');
  dogArea.className = 'pet-dog-area';
  const dog = document.createElement('div');
  dog.className = 'pet-dog';
  dog.innerHTML = `<div class="emoji" aria-hidden="true">🐶</div>`;
  dog.setAttribute('aria-label','Mantener presionado para acariciar a Poe');
  dogArea.appendChild(dog);

  // Barra de progreso
  const prog = document.createElement('div'); prog.className = 'pet-progress';
  const bar  = document.createElement('div'); bar.className  = 'pet-progress-bar';
  prog.appendChild(bar);

  const actions = document.createElement('div'); actions.className = 'pet-actions';
  const hintBtn = document.createElement('button');
  hintBtn.type = 'button'; hintBtn.className = 'btn btn-ghost';
  hintBtn.textContent = '¿Cómo? Mantenga presionado.';
  actions.appendChild(hintBtn);

  box.appendChild(title);
  box.appendChild(text);
  box.appendChild(dogArea);
  box.appendChild(prog);
  box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // Lógica de “acariciar”: mantener presionado hasta completar ~1.5s
  let progress = 0;
  let pressTimer = null;

  const startPress = ()=>{
    if (pressTimer) return;
    pressTimer = setInterval(()=>{
      progress = Math.min(100, progress + 4); // 100/4=25 ticks
      bar.style.width = progress + '%';
      if (progress >= 100){
        done();
      }
    }, 60); // 25*60ms = 1500ms aprox.
  };
  const stopPress = ()=>{
    clearInterval(pressTimer); pressTimer = null;
  };

  // Soporte mouse y touch
  dog.addEventListener('mousedown', startPress);
  dog.addEventListener('mouseup', stopPress);
  dog.addEventListener('mouseleave', stopPress);

  dog.addEventListener('touchstart', (e)=>{ e.preventDefault(); startPress(); }, {passive:false});
  dog.addEventListener('touchend',   (e)=>{ e.preventDefault(); stopPress(); }, {passive:false});
  dog.addEventListener('touchcancel',(e)=>{ e.preventDefault(); stopPress(); }, {passive:false});

  // No cerrar por clic fuera
  overlay.addEventListener('click',(e)=>{
    if (e.target === overlay){ e.stopPropagation(); /* no se cierra */ }
  }, true);

  function done(){
    stopPress();
    // Cerrar y reanudar la app
    document.removeEventListener('keydown', escBlocker, true);
    document.body.style.overflow = prevOverflow || '';
    overlay.remove();
    // Reiniciar el contador del minuto
    schedulePetCheck();
  }
}


function startCreatePersonWizard() {
  // Estado inicial
  createWizard = {
    step: 0,
    data: {
      name: "",
      birthDate: "",     // "dd-mm-aaaa"
      alive: true,       // true = vivo/a (sin fecha de muerte)
      deathDate: "",     // "dd-mm-aaaa" si alive = false
      birthPlace: "",
      gender: "male",    // "male" | "female" | "other"
      notes: ""
    }
  };

  const form = document.getElementById("person-form");
  // Limpiamos el contenido del formulario y dejamos un contenedor del wizard
  form.innerHTML = `<div id="wizard"></div>`;
  renderWizardStep();
}

function renderWizardStep() {
  const w = createWizard;
  const form = document.getElementById("person-form");
  const wiz = document.getElementById("wizard");
  if (!wiz) return;

  // Helpers de UI
  const nav = (hasBack, nextLabel, onNextId="wiz-next", onBackId="wiz-back") => `
    <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px;">
      ${hasBack ? `<button type="button" id="${onBackId}" class="btn btn-ghost">Anterior</button>` : ""}
      <button type="button" id="${onNextId}" class="btn">${nextLabel}</button>
    </div>
  `;

  // Paso actual
  if (w.step === 0) {
    wiz.innerHTML = `
      <h3 style="margin:0 0 8px;">Agregar Nueva Persona</h3>
      <label>Nombre completo</label>
      <input id="wiz-name" type="text" value="Ej: María Pérez Soto" style="width:100%; margin-top:6px;">
      ${nav(false, "Siguiente")}
    `;
    document.getElementById("wiz-next").onclick = () => {
      const v = document.getElementById("wiz-name").value.trim();
      if (!v) return alert("Ingrese el nombre completo, por favor.");
      w.data.name = v;
      w.step = 1; renderWizardStep();
    };
    return;
  }

  if (w.step === 1) {
    wiz.innerHTML = `
      <h3 style="margin:0 0 8px;">Fecha de nacimiento</h3>
      <small>Formato: dd-mm-aaaa</small>
      <input id="wiz-birth" type="text" value="dd-mm-aaaa" style="width:100%; margin-top:6px;">
      ${nav(true, "Siguiente")}
    `;
    document.getElementById("wiz-back").onclick = () => { w.step = 0; renderWizardStep(); };
    document.getElementById("wiz-next").onclick = () => {
      const v = document.getElementById("wiz-birth").value.trim();
      if (!isValidDMY(v)) return alert("Formato de fecha inválido. Use dd-mm-aaaa.");
      const d = parseDMY(v);
      const today = new Date(); today.setHours(0,0,0,0);
      if (d.getTime() > today.getTime()) {
        alert("No puede agregar personas que aún no han nacido. El proceso se reiniciará.");
        return resetCreateWizard();
      }
      w.data.birthDate = v;
      w.step = 2; renderWizardStep();
    };
    return;
  }

  if (w.step === 2) {
    wiz.innerHTML = `
      <h3 style="margin:0 0 8px;">Fecha de fallecimiento</h3>
      <small>Formato: dd-mm-aaaa</small>
      <div style="margin:8px 0;">
        <label style="display:flex; align-items:center; gap:8px;">
          <input id="wiz-alive" type="checkbox" checked> Vivo/a aún
        </label>
      </div>
      <input id="wiz-death" type="text" value="dd-mm-aaaa" style="width:100%; margin-top:6px;" disabled>
      ${nav(true, "Siguiente")}
    `;
    const aliveCb = document.getElementById("wiz-alive");
    const deathInput = document.getElementById("wiz-death");
    aliveCb.onchange = () => {
      deathInput.disabled = aliveCb.checked;
      if (aliveCb.checked && !deathInput.disabled) deathInput.value = "dd-mm-aaaa";
    };
    document.getElementById("wiz-back").onclick = () => { w.step = 1; renderWizardStep(); };
    document.getElementById("wiz-next").onclick = () => {
      const alive = document.getElementById("wiz-alive").checked;
      w.data.alive = alive;
      const birth = parseDMY(w.data.birthDate);
      if (!alive) {
        const dv = deathInput.value.trim();
        if (!isValidDMY(dv)) return alert("Ingrese fecha de fallecimiento válida (dd-mm-aaaa) o marque Vivo/a.");
        const death = parseDMY(dv);
        if (death.getTime() <= birth.getTime()) {
          alert("La fecha de fallecimiento es anterior o igual a la de nacimiento. El proceso se reiniciará.");
          return resetCreateWizard();
        }
        w.data.deathDate = dv;
      } else {
        w.data.deathDate = "";
      }
      w.step = 3; renderWizardStep();
    };
    return;
  }

  if (w.step === 3) {
    wiz.innerHTML = `
      <h3 style="margin:0 0 8px;">Lugar de nacimiento</h3>
      <input id="wiz-place" type="text" value="Ej: Santiago, Chile" style="width:100%; margin-top:6px;">
      ${nav(true, "Siguiente")}
    `;
    document.getElementById("wiz-back").onclick = () => { w.step = 2; renderWizardStep(); };
    document.getElementById("wiz-next").onclick = () => {
      const v = document.getElementById("wiz-place").value.trim();
      if (!v) return alert("Ingrese el lugar de nacimiento, por favor.");
      w.data.birthPlace = v;
      w.step = 4; renderWizardStep();
    };
    return;
  }

  if (w.step === 4) {
    wiz.innerHTML = `
      <h3 style="margin:0 0 8px;">Género</h3>
      <select id="wiz-gender" style="width:100%; margin-top:6px;">
        <option value="male" ${w.data.gender==="male"?"selected":""}>Masculino</option>
        <option value="female" ${w.data.gender==="female"?"selected":""}>Femenino</option>
        <option value="other" ${w.data.gender==="other"?"selected":""}>Otro</option>
      </select>
      ${nav(true, "Siguiente")}
    `;
    document.getElementById("wiz-back").onclick = () => { w.step = 3; renderWizardStep(); };
    document.getElementById("wiz-next").onclick = () => {
      w.data.gender = document.getElementById("wiz-gender").value;
      w.step = 5; renderWizardStep();
    };
    return;
  }

  if (w.step === 5) {
    wiz.innerHTML = `
      <h3 style="margin:0 0 8px;">Notas adicionales</h3>
      <textarea id="wiz-notes" rows="4" placeholder="(Opcional)" style="width:100%; margin-top:6px;"></textarea>
      ${nav(true, "Guardar", "wiz-save")}
    `;
    document.getElementById("wiz-back").onclick = () => { w.step = 4; renderWizardStep(); };

    document.getElementById("wiz-save").onclick = async () => {
      w.data.notes = document.getElementById("wiz-notes").value;

      // Triple confirmación con modal personalizado (botones que huyen)
      const n = w.data.name || "la persona";
      const c1 = await showRunawayConfirm({
        title: "Confirmación 1",
        text: `¿Desea guardar a ${n}?`,
        confirmText: "Sí",
        cancelText: "No"
      });
      if (!c1) return;

      const c2 = await showRunawayConfirm({
        title: "Confirmación 2",
        text: `¿Está totalmente seguro? Se creará el registro de ${n}.`,
        confirmText: "Adelante",
        cancelText: "Cancelar"
      });
      if (!c2) return;

      const c3 = await showRunawayConfirm({
        title: "Última advertencia",
        text: `Después de esto, ${n} formará parte de su historia familiar.`,
        confirmText: "Guardar ahora",
        cancelText: "Mejor no"
      });
      if (!c3) return;

      // Volcar en inputs ocultos compatibles con savePerson()
      ensureHiddenInput("person-name", w.data.name);
      ensureHiddenInput("person-birth-date", w.data.birthDate);
      ensureHiddenInput("person-death-date", w.data.alive ? "" : w.data.deathDate);
      ensureHiddenInput("person-birth-place", w.data.birthPlace);
      ensureHiddenInput("person-gender", w.data.gender);
      ensureHiddenInput("person-notes", w.data.notes);

      // Guardar
      savePerson(); // si hizo async savePerson(), puede usar: await savePerson();
    };
    return;
  }

}

function resetCreateWizard() {
  // Reinicia desde cero
  startCreatePersonWizard();
}

function ensureHiddenInput(id, value) {
  const form = document.getElementById("person-form");
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("input");
    el.type = "hidden";
    el.id = id;
    form.appendChild(el);
  }
  el.value = value;
}

// --- Fechas ---
function isValidDMY(str) {
  if (!/^\d{2}-\d{2}-\d{4}$/.test(str)) return false;
  const d = parseDMY(str);
  // Validar coherencia (mes 1-12, día válido en ese mes)
  const [dd, mm, yyyy] = str.split("-").map(Number);
  return d.getFullYear() === yyyy && (d.getMonth()+1) === mm && d.getDate() === dd;
}

function parseDMY(str) {
  const [dd, mm, yyyy] = str.split("-").map(Number);
  // Crear en mediodía para evitar problemas de zona
  const dt = new Date(yyyy, (mm-1), dd, 12, 0, 0, 0);
  dt.setHours(0,0,0,0);
  return dt;
}

// ===== Asistente de relaciones (un campo por vez + hold confirm en cada paso) =====
let relWizard = null;

function startRelationshipWizard(){
  relWizard = {
    step: 0,
    data: {
      treeId: "",
      type: "",           // "parent-child" | "spouse" | "sibling"
      person1Id: "",
      person2Id: "",
      person1Role: "",
      person2Role: ""
    }
  };
  renderRelWizardStep();
}

function roleOptionsFor(type){
  switch(type){
    case "parent-child": return { p1: ["padre","madre"], p2: ["hijo","hija"] };
    case "spouse":       return { p1: ["esposo","esposa"], p2: ["esposo","esposa"] };
    case "sibling":      return { p1: ["hermano","hermana"], p2: ["hermano","hermana"] };
    default:             return { p1: [], p2: [] };
  }
}

function relNav(hasBack, nextLabel, nextId="rel-next", backId="rel-back"){
  return `
    <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px;">
      ${hasBack ? `<button type="button" id="${backId}" class="btn btn-ghost">Anterior</button>` : ""}
      <button type="button" id="${nextId}" class="btn">${nextLabel}</button>
    </div>
  `;
}

async function holdStepConfirm(texto){
  const ok = await showHoldConfirm({
    title: "Confirmación",
    text: texto,
    confirmText: "Mantener para confirmar",
    cancelText: "Volver"
  });
  return ok;
}

function renderRelWizardStep(){
  const w = relWizard;
  const cont = document.getElementById("rel-wizard");
  if (!cont) return;

  // Paso 0: Árbol
  if (w.step === 0){
    const treeOptions = trees.map(t => `<option value="${t.id}">${t.name}</option>`).join("");
    cont.innerHTML = `
      <h3 style="margin:0 0 8px;">Árbol familiar</h3>
      <select id="relw-tree" style="width:100%; margin-top:6px;">
        <option value="">Seleccione un árbol…</option>
        ${treeOptions}
      </select>
      ${relNav(false,"Siguiente")}
    `;
    document.getElementById("rel-next").onclick = async ()=>{
      const val = document.getElementById("relw-tree").value;
      if (!val) return alert("Seleccione un árbol.");
      const ok = await holdStepConfirm("Confirmar árbol seleccionado.");
      if (!ok) return;
      w.data.treeId = val;
      w.step = 1; renderRelWizardStep();
    };
    return;
  }

  // Paso 1: Tipo de relación
  if (w.step === 1){
    cont.innerHTML = `
      <h3 style="margin:0 0 8px;">Tipo de relación</h3>
      <select id="relw-type" style="width:100%; margin-top:6px;">
        <option value="">Seleccione tipo…</option>
        <option value="parent-child">Padre/Madre — Hijo/Hija</option>
        <option value="spouse">Esposos</option>
        <option value="sibling">Hermanos</option>
      </select>
      ${relNav(true,"Siguiente")}
    `;
    document.getElementById("rel-back").onclick = ()=>{ w.step = 0; renderRelWizardStep(); };
    document.getElementById("rel-next").onclick = async ()=>{
      const val = document.getElementById("relw-type").value;
      if (!val) return alert("Seleccione un tipo de relación.");
      const ok = await holdStepConfirm("Confirmar tipo de relación.");
      if (!ok) return;
      w.data.type = val;
      w.step = 2; renderRelWizardStep();
    };
    return;
  }

  // Paso 2: Primera persona
  if (w.step === 2){
    const peopleOptions = allPeople.map(p=>`<option value="${p.id}">${p.name}</option>`).join("");
    cont.innerHTML = `
      <h3 style="margin:0 0 8px;">Primera persona</h3>
      <select id="relw-p1" style="width:100%; margin-top:6px;">
        <option value="">Seleccione…</option>
        ${peopleOptions}
      </select>
      ${relNav(true,"Siguiente")}
    `;
    document.getElementById("rel-back").onclick = ()=>{ w.step = 1; renderRelWizardStep(); };
    document.getElementById("rel-next").onclick = async ()=>{
      const val = document.getElementById("relw-p1").value;
      if (!val) return alert("Seleccione la primera persona.");
      const ok = await holdStepConfirm("Confirmar selección de la primera persona.");
      if (!ok) return;
      w.data.person1Id = val;
      w.step = 3; renderRelWizardStep();
    };
    return;
  }

  // Paso 3: Rol de la segunda persona
  if (w.step === 3){
    const roles = roleOptionsFor(w.data.type).p2;
    cont.innerHTML = `
      <h3 style="margin:0 0 8px;">Rol de la segunda persona</h3>
      <select id="relw-role2" style="width:100%; margin-top:6px;">
        <option value="">Seleccione rol…</option>
        ${roles.map(r=>`<option value="${r}">${r}</option>`).join("")}
      </select>
      ${relNav(true,"Siguiente")}
    `;
    document.getElementById("rel-back").onclick = ()=>{ w.step = 2; renderRelWizardStep(); };
    document.getElementById("rel-next").onclick = async ()=>{
      const val = document.getElementById("relw-role2").value;
      if (!val) return alert("Seleccione el rol de la segunda persona.");
      const ok = await holdStepConfirm("Confirmar rol de la segunda persona.");
      if (!ok) return;
      w.data.person2Role = val;
      w.step = 4; renderRelWizardStep();
    };
    return;
  }

  // Paso 4: Segunda persona
  if (w.step === 4){
    const peopleOptions = allPeople
      .filter(p=>p.id !== w.data.person1Id)
      .map(p=>`<option value="${p.id}">${p.name}</option>`).join("");
    cont.innerHTML = `
      <h3 style="margin:0 0 8px;">Segunda persona</h3>
      <select id="relw-p2" style="width:100%; margin-top:6px;">
        <option value="">Seleccione…</option>
        ${peopleOptions}
      </select>
      ${relNav(true,"Siguiente")}
    `;
    document.getElementById("rel-back").onclick = ()=>{ w.step = 3; renderRelWizardStep(); };
    document.getElementById("rel-next").onclick = async ()=>{
      const val = document.getElementById("relw-p2").value;
      if (!val) return alert("Seleccione la segunda persona.");
      const ok = await holdStepConfirm("Confirmar selección de la segunda persona.");
      if (!ok) return;
      w.data.person2Id = val;
      w.step = 5; renderRelWizardStep();
    };
    return;
  }

  // Paso 5: Rol de la primera persona
  if (w.step === 5){
    const roles = roleOptionsFor(w.data.type).p1;
    cont.innerHTML = `
      <h3 style="margin:0 0 8px;">Rol de la primera persona</h3>
      <select id="relw-role1" style="width:100%; margin-top:6px;">
        <option value="">Seleccione rol…</option>
        ${roles.map(r=>`<option value="${r}">${r}</option>`).join("")}
      </select>
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px;">
        <button type="button" id="rel-back" class="btn btn-ghost">Anterior</button>
        <button type="button" id="rel-save" class="btn">Guardar relación</button>
      </div>
    `;
    document.getElementById("rel-back").onclick = ()=>{ w.step = 4; renderRelWizardStep(); };
    document.getElementById("rel-save").onclick = async ()=>{
      const val = document.getElementById("relw-role1").value;
      if (!val) return alert("Seleccione el rol de la primera persona.");
      const ok = await holdStepConfirm("¿Guardar esta relación? Mantenga presionado para confirmar.");
      if (!ok) return;
      w.data.person1Role = val;

      // Volcar a inputs ocultos para reusar saveRelationship()
      ensureHiddenInput("rel-tree", w.data.treeId);
      ensureHiddenInput("rel-type", w.data.type);
      ensureHiddenInput("rel-person1", w.data.person1Id);
      ensureHiddenInput("rel-person2", w.data.person2Id);
      ensureHiddenInput("rel-person1-role", w.data.person1Role);
      ensureHiddenInput("rel-person2-role", w.data.person2Role);

      // Guardar con su función existente
      saveRelationship();

      // Cerrar
      closeRelationshipDialog();
    };
    return;
  }
}

// ===== Tutorial por vista (imposible de omitir) =====

// Animales de la naturaleza (emoji)
const TUTORIAL_ANIMALS = ["🦊","🦉","🦥","🦦","🦜","🦌","🦙","🐢","🦔","🦎"];
function pickAnimal(){ return TUTORIAL_ANIMALS[Math.floor(Math.random()*TUTORIAL_ANIMALS.length)]; }

// Contenido de tutorial por vista
const VIEW_TUTORIALS = {
  home: [
    "Bienvenido. En la página de inicio verá atajos y el estado general de sus árboles.",
    "Use la barra superior para ir a Personas, Árboles, Relaciones o la Vista del Árbol."
  ],
  people: [
    "Aquí gestiona Personas: puede crear, editar y eliminar.",
    "Use la búsqueda para filtrar por nombre o lugar de nacimiento.",
    "Al guardar, los datos quedan disponibles para crear relaciones y árboles."
  ],
  trees: [
    "En Árboles puede crear nuevos árboles genealógicos.",
    "Cada tarjeta muestra cuántas personas y relaciones contiene.",
    "Pulse “Ver Árbol” para abrir la visualización de ese árbol."
  ],
  relationships: [
    "En Relaciones crea vínculos: padre-hijo, hermanos y esposos.",
    "Seleccione el árbol, las dos personas y los roles según el tipo.",
    "Al guardar, la relación aparecerá también en la vista del árbol."
  ],
  "tree-view": [
    "Esta es la Visualización del Árbol.",
    "Los colores indican género; las líneas verdes son padre-hijo, rojas esposos y azules hermanos.",
    "Sitúe el cursor sobre un nodo para ver detalles; use la navegación para cambiar de vista."
  ]
};

// Bloquea la interacción tras navegar a una vista y guía paso a paso
function startTutorial(viewName){
  // Elija animal y pasos (si la vista no está en la tabla, use uno genérico)
  const steps = VIEW_TUTORIALS[viewName] || ["Sección informativa.", "Use la navegación superior para moverse por la aplicación."];
  const animal = pickAnimal();
  let idx = 0;

  // Crear overlay
  const overlay = document.createElement("div");
  overlay.className = "tutorial-overlay";
  overlay.setAttribute("role","dialog");
  overlay.setAttribute("aria-modal","true");
  overlay.setAttribute("aria-label","Tutorial");

  // Evitar cerrar con ESC
  const escBlocker = (e) => { if (e.key === "Escape") e.preventDefault(); };
  document.addEventListener("keydown", escBlocker, true);

  // Bloquear scroll de fondo
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  // Construir caja
  const box = document.createElement("div");
  box.className = "tutorial-box";

  // header
  const header = document.createElement("div");
  header.className = "tutorial-header";
  const icon = document.createElement("div");
  icon.className = "tutorial-animal";
  icon.textContent = animal;
  const title = document.createElement("div");
  title.className = "tutorial-title";
  title.textContent = tituloPorVista(viewName);
  header.appendChild(icon); header.appendChild(title);

  // texto
  const text = document.createElement("div");
  text.className = "tutorial-text";
  text.textContent = steps[idx];

  // dots
  const dots = document.createElement("div");
  dots.className = "tutorial-steps";
  const dotRefs = steps.map((_,i)=>{
    const d=document.createElement("div");
    d.className="tutorial-step-dot"+(i===0?" active":"");
    dots.appendChild(d); return d;
  });

  // acciones (solo “Siguiente” / “Finalizar”, no hay “Omitir”)
  const actions = document.createElement("div");
  actions.className = "tutorial-actions";
  const btnNext = document.createElement("button");
  btnNext.className = "btn btn-ghost";
  btnNext.textContent = steps.length === 1 ? "Entendido" : "Siguiente";
  actions.appendChild(btnNext);

  box.appendChild(header);
  box.appendChild(text);
  box.appendChild(dots);
  box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // Siguiente paso
  btnNext.addEventListener("click", () => {
    if (idx < steps.length - 1) {
      idx++;
      text.textContent = steps[idx];
      dotRefs.forEach((d,i)=>d.classList.toggle("active", i===idx));
      if (idx === steps.length - 1) btnNext.textContent = "Finalizar";
    } else {
      // Cerrar tutorial (completado)
      document.removeEventListener("keydown", escBlocker, true);
      document.body.style.overflow = prevOverflow || "";
      overlay.remove();
    }
  });

  // Evitar cierre por clic fuera
  overlay.addEventListener("click",(e)=>{
    if (e.target === overlay) {
      // Ignorar. No se permite cerrar haciendo clic fuera.
      e.stopPropagation();
    }
  }, true);
}

// Título visible por vista
function tituloPorVista(viewName){
  switch(viewName){
    case "home": return "Tutorial de Inicio";
    case "people": return "Tutorial de Personas";
    case "trees": return "Tutorial de Árboles";
    case "relationships": return "Tutorial de Relaciones";
    case "tree-view": return "Tutorial de Visualización";
    default: return "Tutorial";
  }
}


// Initialize app
document.addEventListener("DOMContentLoaded", () => {
  loadData()
  setupEventListeners()
  renderCurrentView()
  // <-- añada esta línea si quiere tutorial inicial:
  startTutorial("home")
  initDogCompanion()
})

// Data management
function loadData() {
  const savedTrees = localStorage.getItem("familyTrees")
  const savedPeople = localStorage.getItem("allPeople")

  if (savedTrees) {
    trees = JSON.parse(savedTrees)
  }

  if (savedPeople) {
    allPeople = JSON.parse(savedPeople)
  }
}

function saveData() {
  localStorage.setItem("familyTrees", JSON.stringify(trees))
  localStorage.setItem("allPeople", JSON.stringify(allPeople))
}

// Event listeners
function setupEventListeners() {
  // Search functionality
  document.getElementById("search-people").addEventListener("input", (e) => {
    renderPeople(e.target.value)
  })

  // Person form
  document.getElementById("person-form").addEventListener("submit", (e) => {
    e.preventDefault()
    savePerson()
  })

  // Relationship form
  document.getElementById("relationship-form").addEventListener("submit", (e) => {
    e.preventDefault()
    saveRelationship()
  })

  // Close modals on background click
  document.getElementById("person-dialog").addEventListener("click", function (e) {
    if (e.target === this) closePersonDialog()
  })

  document.getElementById("relationship-dialog").addEventListener("click", function (e) {
    if (e.target === this) closeRelationshipDialog()
  })
}

// View management
function showView(viewName) {
  // Ocultar todas
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.remove("active")
  })

  // Mostrar seleccionada
  document.getElementById(viewName + "-view").classList.add("active")

  // Navegación
  const navigation = document.getElementById("navigation")
  if (viewName === "home") {
    navigation.classList.add("hidden")
  } else {
    navigation.classList.remove("hidden")
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.classList.remove("active")
    })
    document.querySelector(`[onclick="showView('${viewName}')"]`)?.classList.add("active")
  }

  currentView = viewName
  renderCurrentView()

  // === Mostrar tutorial (imposible de omitir) en cada cambio de vista ===
  startTutorial(viewName)
}


function renderCurrentView() {
  switch (currentView) {
    case "people":
      renderPeople()
      break
    case "trees":
      renderTrees()
      break
    case "relationships":
      renderRelationships()
      break
    case "tree-view":
      renderTreeView()
      break
  }
}

// People management
function renderPeople(searchTerm = "") {
  const container = document.getElementById("people-grid")
  const filteredPeople = allPeople.filter(
    (person) =>
      person.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      person.birthPlace.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  container.innerHTML = filteredPeople
    .map(
      (person) => `
        <div class="card person-card">
            <div class="person-header">
                <div class="person-info">
                    <h3>${person.name}</h3>
                    <span class="person-badge">
                        ${person.gender === "male" ? "Masculino" : person.gender === "female" ? "Femenino" : "Otro"}
                    </span>
                </div>
                <div class="person-actions">
                    <button class="action-btn" onclick="editPerson('${person.id}')" title="Editar">✏️</button>
                    <button class="action-btn delete" onclick="deletePerson('${person.id}')" title="Eliminar">🗑️</button>
                </div>
            </div>
            <div class="person-details">
                <p><strong>Nacimiento:</strong> ${person.birthDate} en ${person.birthPlace}</p>
                ${person.deathDate ? `<p><strong>Fallecimiento:</strong> ${person.deathDate}</p>` : ""}
                ${person.notes ? `<p><strong>Notas:</strong> ${person.notes}</p>` : ""}
            </div>
        </div>
    `,
    )
    .join("")
}

function openPersonDialog(person = null) {
  editingPerson = person
  const dialog = document.getElementById("person-dialog")
  const title = document.getElementById("person-dialog-title")
  const form = document.getElementById("person-form")

  if (person) {
    // --- Modo edición: formulario clásico (como antes) ---
    title.textContent = "Editar Persona"

    form.innerHTML = `
      <div class="form-grid">
        <div class="form-field">
          <label>Nombre completo</label>
          <input id="person-name" type="text">
        </div>
        <div class="form-field">
          <label>Fecha de nacimiento</label>
          <input id="person-birth-date" type="text" placeholder="dd-mm-aaaa">
        </div>
        <div class="form-field">
          <label>Fecha de fallecimiento</label>
          <input id="person-death-date" type="text" placeholder="dd-mm-aaaa">
        </div>
        <div class="form-field">
          <label>Lugar de nacimiento</label>
          <input id="person-birth-place" type="text">
        </div>
        <div class="form-field">
          <label>Género</label>
          <select id="person-gender">
            <option value="male">Masculino</option>
            <option value="female">Femenino</option>
            <option value="other">Otro</option>
          </select>
        </div>
        <div class="form-field" style="grid-column:1/-1">
          <label>Notas adicionales</label>
          <textarea id="person-notes" rows="3"></textarea>
        </div>
        <div style="grid-column:1/-1; display:flex; justify-content:flex-end; gap:8px;">
          <button type="button" class="btn btn-ghost" onclick="closePersonDialog()">Cancelar</button>
          <button type="submit" class="btn">Guardar</button>
        </div>
      </div>
    `

    document.getElementById("person-name").value = person.name
    document.getElementById("person-birth-date").value = person.birthDate
    document.getElementById("person-death-date").value = person.deathDate || ""
    document.getElementById("person-birth-place").value = person.birthPlace
    document.getElementById("person-gender").value = person.gender
    document.getElementById("person-notes").value = person.notes
  } else {
    // --- Modo creación: asistente paso a paso ---
    title.textContent = "Agregar Nueva Persona"
    startCreatePersonWizard()
  }

  dialog.classList.add("active")
}

function closePersonDialog() {
  document.getElementById("person-dialog").classList.remove("active")
  editingPerson = null
}

async function savePerson() {
  // (solo si está editando)
  if (editingPerson) {
    const nameTry = document.getElementById("person-name")?.value || "la persona";
    const c1 = await showRunawayConfirm({ title:"Confirmación 1", text:`¿Guardar cambios de ${nameTry}?`, confirmText:"Sí", cancelText:"No" });
    if (!c1) return;
    const c2 = await showRunawayConfirm({ title:"Confirmación 2", text:`¿Seguro? Se actualizarán los datos de ${nameTry}.`, confirmText:"Adelante", cancelText:"Cancelar" });
    if (!c2) return;
    const c3 = await showRunawayConfirm({ title:"Última advertencia", text:`Los cambios de ${nameTry} serán permanentes (puede editarlos luego).`, confirmText:"Guardar ahora", cancelText:"Mejor no" });
    if (!c3) return;
  }

  const formData = {
    name: document.getElementById("person-name").value,
    birthDate: document.getElementById("person-birth-date").value,
    deathDate: document.getElementById("person-death-date").value,
    birthPlace: document.getElementById("person-birth-place").value,
    gender: document.getElementById("person-gender").value,
    notes: document.getElementById("person-notes").value,
  }

  // Validaciones duras también aquí por si viene de edición clásica
  if (!isValidDMY(formData.birthDate)) return alert("Fecha de nacimiento inválida (use dd-mm-aaaa).");
  const birth = parseDMY(formData.birthDate);
  const today = new Date(); today.setHours(0,0,0,0);
  if (birth.getTime() > today.getTime()) {
    alert("No puede agregar/editar con fecha de nacimiento en el futuro. Se canceló el guardado.");
    return;
  }
  if (formData.deathDate) {
    if (!isValidDMY(formData.deathDate)) return alert("Fecha de fallecimiento inválida (use dd-mm-aaaa).");
    const death = parseDMY(formData.deathDate);
    if (death.getTime() <= birth.getTime()) {
      alert("La fecha de fallecimiento no puede ser anterior o igual a la de nacimiento. Se canceló el guardado.");
      return;
    }
  }

  if (editingPerson) {
    const index = allPeople.findIndex((p) => p.id === editingPerson.id)
    allPeople[index] = { ...formData, id: editingPerson.id }
  } else {
    const newPerson = { ...formData, id: Date.now().toString() }
    allPeople.push(newPerson)
  }

  saveData()
  closePersonDialog()
  renderPeople()
}

function editPerson(personId) {
  const person = allPeople.find((p) => p.id === personId)
  openPersonDialog(person)
}

/* ===== Erase-to-delete: el usuario debe “borrar con goma” los datos ===== */
function showEraseToDelete(person){
  return new Promise((resolve)=>{
    // Overlay base, bloqueante (no ESC, no clic fuera)
    const overlay = document.createElement('div');
    overlay.className = 'erase-overlay';
    overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true');
    const escBlocker = (e)=>{ if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); } };
    document.addEventListener('keydown', escBlocker, true);
    overlay.addEventListener('click',(e)=>{ if (e.target===overlay){ e.stopPropagation(); } }, true);

    // Ventana
    const box = document.createElement('div');
    box.className = 'erase-window';

    const title = document.createElement('div');
    title.className = 'erase-title';
    title.textContent = 'Borrar datos para eliminar a la persona';

    const text = document.createElement('div');
    text.className = 'erase-text';
    text.textContent = 'Pase la goma sobre los datos hasta borrarlos por completo. Cuando el progreso llegue a 100%, se eliminará la persona.';

    // Datos a mostrar (texto)
    const lines = [
      `Nombre: ${person.name || '-'}`,
      `Nacimiento: ${person.birthDate || '-'}`,
      `Fallecimiento: ${person.deathDate || '(vivo/a)'}`,
      `Lugar: ${person.birthPlace || '-'}`,
      `Género: ${person.gender === 'male' ? 'Masculino' : person.gender === 'female' ? 'Femenino' : 'Otro'}`,
      `Notas: ${person.notes || '-'}`
    ];

    // Contenedor/canvas
    const wrap = document.createElement('div');
    wrap.className = 'erase-canvas-wrap';
    wrap.style.padding = '16px';

    // Creamos un canvas que contiene SOLO el texto a borrar
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    // Trazos
    const pad = 16;
    const lh = 26;
    const font = '16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    const width = Math.min(680, window.innerWidth - 64);
    const height = pad + lines.length * lh + pad;

    canvas.width = width;
    canvas.height = height;

    // Dibujar texto (top canvas): lo que el usuario “borra”
    ctx.clearRect(0,0,width,height);
    ctx.fillStyle = '#111827';
    ctx.font = font;
    ctx.textBaseline = 'top';
    lines.forEach((line, i)=>{
      ctx.fillText(line, pad, pad + i*lh);
    });

    // Medición base de “píxeles de texto” (alpha > 0)
    let initialOpaque = 0;
    (function measureInitial(){
      const img = ctx.getImageData(0,0,width,height).data;
      for (let i=3; i<img.length; i+=4){ if (img[i] > 0) initialOpaque++; }
    })();

    // Progreso
    const progressWrap = document.createElement('div');
    progressWrap.className = 'erase-progress';
    const progressBar = document.createElement('div');
    progressBar.className = 'erase-progress-bar';
    progressWrap.appendChild(progressBar);

    const hint = document.createElement('div');
    hint.className = 'erase-hint';
    hint.textContent = 'Sugerencia: mantenga presionado y mueva el cursor (o el dedo) para borrar.';

    // Añadir al DOM
    wrap.appendChild(canvas);
    box.appendChild(title);
    box.appendChild(text);
    box.appendChild(wrap);
    box.appendChild(progressWrap);
    box.appendChild(hint);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // Eraser logic (destination-out)
    const brush = 18; // radio de la “goma”
    let drawing = false;
    let lastX = 0, lastY = 0;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = brush*2;

    function eraseLine(x1,y1,x2,y2){
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.moveTo(x1,y1);
      ctx.lineTo(x2,y2);
      ctx.stroke();
      ctx.restore();
    }

    function pointerPos(evt){
      const rect = canvas.getBoundingClientRect();
      const clientX = evt.touches ? evt.touches[0].clientX : evt.clientX;
      const clientY = evt.touches ? evt.touches[0].clientY : evt.clientY;
      return { x: clientX - rect.left, y: clientY - rect.top };
    }

    function startDraw(e){
      e.preventDefault();
      drawing = true;
      const p = pointerPos(e);
      lastX = p.x; lastY = p.y;
      eraseLine(lastX,lastY,lastX,lastY);
      scheduleMeasure();
    }
    function moveDraw(e){
      if (!drawing) return;
      const p = pointerPos(e);
      eraseLine(lastX,lastY,p.x,p.y);
      lastX = p.x; lastY = p.y;
      scheduleMeasure();
    }
    function endDraw(){ drawing = false; }

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', moveDraw);
    window.addEventListener('mouseup', endDraw);

    canvas.addEventListener('touchstart', startDraw, {passive:false});
    canvas.addEventListener('touchmove',  moveDraw,  {passive:false});
    canvas.addEventListener('touchend',   endDraw,   {passive:false});
    canvas.addEventListener('touchcancel',endDraw,   {passive:false});

    // Medición (throttle)
    let measurePending = false;
    function scheduleMeasure(){
      if (measurePending) return;
      measurePending = true;
      requestAnimationFrame(measureProgress);
    }

    function measureProgress(){
      measurePending = false;
      // Contar píxeles opacos restantes (texto no borrado)
      const img = ctx.getImageData(0,0,width,height).data;
      let opaque = 0;
      for (let i=3; i<img.length; i+=4){ if (img[i] > 0) opaque++; }
      const erasedRatio = Math.min(1, Math.max(0, 1 - (opaque / initialOpaque || 1)));
      progressBar.style.width = (erasedRatio*100).toFixed(1) + '%';

      if (erasedRatio >= 0.99) {
        // Borrado suficiente → eliminar
        teardown(true);
      }
    }

    function teardown(ok){
      document.removeEventListener('keydown', escBlocker, true);
      overlay.remove();
      resolve(!!ok);
    }
  });
}


async function deletePerson(personId) {
  const person = allPeople.find(p => p.id === personId);
  const name = person ? person.name : getPersonName(personId);

  // 1) Confirmación con botones que huyen
  const ok = await showRunawayConfirm({
    title: "Eliminar persona",
    text: `¿Seguro desea eliminar a ${name}? Esta acción no se puede deshacer.`,
    confirmText: "Sí, eliminar",
    cancelText: "Cancelar"
  });
  if (!ok) return;

  // 2) Borrado con goma (bloqueante hasta completar)
  const fullyErased = await showEraseToDelete(person || { name: name });
  if (!fullyErased) return;

  // 3) Eliminar definitivamente
  allPeople = allPeople.filter((p) => p.id !== personId);

  // Quitar de árboles y relaciones
  trees = trees.map((tree) => ({
    ...tree,
    people: tree.people.filter((p) => p.id !== personId),
    relationships: tree.relationships.filter((r) => r.person1Id !== personId && r.person2Id !== personId),
  }));

  saveData();
  renderPeople();
}


// Trees management
function renderTrees() {
  const container = document.getElementById("trees-grid")

  container.innerHTML = trees
    .map(
      (tree) => `
        <div class="card tree-card">
            <div class="tree-info">
                <div class="tree-icon">🌳</div>
                <div class="tree-details">
                    <h3>${tree.name}</h3>
                    <div class="tree-stats">
                        ${tree.people.length} personas, ${tree.relationships.length} relaciones
                    </div>
                </div>
            </div>
            <button class="btn btn-ghost" onclick="viewTree('${tree.id}')">
                → Ver Árbol
            </button>
        </div>
    `,
    )
    .join("")
}

function createNewTree() {
  const nameInput = document.getElementById("new-tree-name")
  const name = nameInput.value.trim()

  if (!name) return

  const newTree = {
    id: Date.now().toString(),
    name: name,
    people: [],
    relationships: [],
  }

  trees.push(newTree)
  nameInput.value = ""
  saveData()
  renderTrees()
}

function viewTree(treeId) {
  currentTree = trees.find((t) => t.id === treeId)
  showView("tree-view")
}

// Relationships management
function renderRelationships() {
  const container = document.getElementById("relationships-content")

  container.innerHTML = trees
    .map(
      (tree) => `
        <div class="relationship-card">
            <div class="relationship-header">
                <span>🌳</span>
                <span>${tree.name}</span>
            </div>
            ${
              tree.relationships.length === 0
                ? '<p style="color: var(--text-muted);">No hay relaciones en este árbol</p>'
                : tree.relationships
                    .map(
                      (rel) => `
                    <div class="relationship-item">
                        <div class="relationship-details">
                            <span style="font-weight: 500;">${getPersonName(rel.person1Id)}</span>
                            <span class="role-badge">${rel.person1Role}</span>
                            <span style="color: var(--text-muted);">→</span>
                            <span class="role-badge">${rel.person2Role}</span>
                            <span style="font-weight: 500;">${getPersonName(rel.person2Id)}</span>
                        </div>
                    </div>
                `,
                    )
                    .join("")
            }
        </div>
    `,
    )
    .join("")
}

function openRelationshipDialog() {
  const dialog = document.getElementById("relationship-dialog");
  const form   = document.getElementById("relationship-form");
  document.getElementById("relationship-dialog").classList.add("active");

  // Render contenedor del asistente
  form.innerHTML = `<div id="rel-wizard"></div>`;
  startRelationshipWizard();
}

function closeRelationshipDialog() {
  document.getElementById("relationship-dialog").classList.remove("active")
  document.getElementById("relationship-form").reset()
}

function updateRoleOptions() {
  const relType = document.getElementById("rel-type").value
  const person1Role = document.getElementById("rel-person1-role")
  const person2Role = document.getElementById("rel-person2-role")

  let roleOptions = {}

  switch (relType) {
    case "parent-child":
      roleOptions = {
        person1: ["padre", "madre"],
        person2: ["hijo", "hija"],
      }
      break
    case "spouse":
      roleOptions = {
        person1: ["esposo", "esposa"],
        person2: ["esposo", "esposa"],
      }
      break
    case "sibling":
      roleOptions = {
        person1: ["hermano", "hermana"],
        person2: ["hermano", "hermana"],
      }
      break
  }

  person1Role.innerHTML =
    '<option value="">Rol</option>' +
    roleOptions.person1.map((role) => `<option value="${role}">${role}</option>`).join("")

  person2Role.innerHTML =
    '<option value="">Rol</option>' +
    roleOptions.person2.map((role) => `<option value="${role}">${role}</option>`).join("")
}

function saveRelationship() {
  const treeId = document.getElementById("rel-tree").value
  const person1Id = document.getElementById("rel-person1").value
  const person2Id = document.getElementById("rel-person2").value
  const relType = document.getElementById("rel-type").value
  const person1Role = document.getElementById("rel-person1-role").value
  const person2Role = document.getElementById("rel-person2-role").value

  if (!treeId || !person1Id || !person2Id || !person1Role || !person2Role) {
    alert("Por favor completa todos los campos")
    return
  }

  const relationship = {
    id: Date.now().toString(),
    person1Id,
    person2Id,
    type: relType,
    person1Role,
    person2Role,
  }

  // Add relationship to tree
  const treeIndex = trees.findIndex((t) => t.id === treeId)
  trees[treeIndex].relationships.push(relationship)

  // Add people to tree if not already there
  const tree = trees[treeIndex]
  if (!tree.people.find((p) => p.id === person1Id)) {
    const person1 = allPeople.find((p) => p.id === person1Id)
    if (person1) tree.people.push(person1)
  }

  if (!tree.people.find((p) => p.id === person2Id)) {
    const person2 = allPeople.find((p) => p.id === person2Id)
    if (person2) tree.people.push(person2)
  }

  saveData()
  closeRelationshipDialog()
  renderRelationships()
}

function getPersonName(personId) {
  const person = allPeople.find((p) => p.id === personId)
  return person ? person.name : "Persona desconocida"
}

// Tree visualization
function renderTreeView() {
  if (!currentTree) return

  document.getElementById("tree-title").textContent = currentTree.name
  const container = document.getElementById("tree-visualization")

  if (currentTree.relationships.length === 0) {
    container.innerHTML = `
            <div class="empty-tree">
                <div class="empty-tree-icon">❤️</div>
                <h3>No hay relaciones en este árbol</h3>
                <p>Agrega relaciones entre personas para ver el árbol genealógico</p>
            </div>
        `
    return
  }

  container.innerHTML = `
        <div class="tree-svg-container">
            <svg id="tree-svg" viewBox="0 0 1000 600">
                <!-- Background pattern -->
                <defs>
                    <pattern id="treeTexture" patternUnits="userSpaceOnUse" width="100" height="100">
                        <rect width="100" height="100" fill="#f0fdf4"/>
                        <circle cx="20" cy="30" r="2" fill="#dcfce7" opacity="0.5"/>
                        <circle cx="70" cy="60" r="1.5" fill="#bbf7d0" opacity="0.3"/>
                        <circle cx="40" cy="80" r="1" fill="#86efac" opacity="0.4"/>
                    </pattern>
                </defs>
                <rect width="1000" height="600" fill="url(#treeTexture)"/>
            </svg>
            <div class="legend">
                <div class="legend-title">Leyenda:</div>
                <div class="legend-item">
                    <div class="legend-line" style="background: #059669;"></div>
                    <span>Padre-Hijo</span>
                </div>
                <div class="legend-item">
                    <div class="legend-line" style="background: #dc2626;"></div>
                    <span>Esposos</span>
                </div>
                <div class="legend-item">
                    <div class="legend-line" style="background: #2563eb;"></div>
                    <span>Hermanos</span>
                </div>
                <div class="legend-item">
                    <div class="legend-shape" style="background: #22c55e; border-color: #16a34a;"></div>
                    <span>Hombres</span>
                </div>
                <div class="legend-item">
                    <div class="legend-shape legend-circle" style="background: #f97316; border-color: #ea580c;"></div>
                    <span>Mujeres</span>
                </div>
            </div>
        </div>
    `

  drawFamilyTree()
}

function drawFamilyTree() {
  const svg = document.getElementById("tree-svg")
  if (!svg || !currentTree) return

  // Create layout
  const layout = createTreeLayout()

  // Clear existing content except background
  const existingElements = svg.querySelectorAll("g, line, rect, circle")
  existingElements.forEach((el) => el.remove())

  // Draw relationships
  drawRelationships(svg, layout)

  // Draw people nodes
  drawPersonNodes(svg, layout)
}

function createTreeLayout() {
  const layout = {}
  const generations = {}

  // Group relationships by type
  const parentChildRels = currentTree.relationships.filter((r) => r.type === "parent-child")
  const spouseRels = currentTree.relationships.filter((r) => r.type === "spouse")

  // Find root generation (parents who are not children)
  const allChildren = new Set(
    parentChildRels.map((rel) =>
      rel.person1Role === "hijo" || rel.person1Role === "hija" ? rel.person1Id : rel.person2Id,
    ),
  )
  const allParents = new Set(
    parentChildRels.map((rel) =>
      rel.person1Role === "padre" || rel.person1Role === "madre" ? rel.person1Id : rel.person2Id,
    ),
  )

  // Generation 0: Parents who are not children
  const rootParents = Array.from(allParents).filter((p) => !allChildren.has(p))
  generations[0] = rootParents

  // Build generations downward
  let currentGen = 0
  while (generations[currentGen] && generations[currentGen].length > 0) {
    const nextGenChildren = new Set()

    generations[currentGen].forEach((parentId) => {
      parentChildRels.forEach((rel) => {
        const parent = rel.person1Role === "padre" || rel.person1Role === "madre" ? rel.person1Id : rel.person2Id
        const child = rel.person1Role === "hijo" || rel.person1Role === "hija" ? rel.person1Id : rel.person2Id

        if (parent === parentId) {
          nextGenChildren.add(child)
        }
      })
    })

    if (nextGenChildren.size > 0) {
      generations[currentGen + 1] = Array.from(nextGenChildren)
      currentGen++
    } else {
      break
    }
  }

  // Add remaining people to generation 0
  currentTree.people.forEach((person) => {
    let found = false
    Object.values(generations).forEach((gen) => {
      if (gen.includes(person.id)) found = true
    })
    if (!found) {
      if (!generations[0]) generations[0] = []
      generations[0].push(person.id)
    }
  })

  // Position people in generations
  Object.entries(generations).forEach(([gen, peopleIds]) => {
    const generation = Number.parseInt(gen)
    const y = 100 + generation * 120
    const totalWidth = Math.max(800, peopleIds.length * 120)
    const startX = (1000 - totalWidth) / 2 + 60

    peopleIds.forEach((personId, index) => {
      layout[personId] = {
        x: startX + index * 120,
        y: y,
        generation: generation,
      }
    })
  })

  // Adjust spouse positions
  spouseRels.forEach((rel) => {
    const person1 = layout[rel.person1Id]
    const person2 = layout[rel.person2Id]

    if (person1 && person2 && person1.generation === person2.generation) {
      const avgX = (person1.x + person2.x) / 2
      layout[rel.person1Id].x = avgX - 40
      layout[rel.person2Id].x = avgX + 40
    }
  })

  return layout
}

function drawRelationships(svg, layout) {
  const parentChildRels = currentTree.relationships.filter((r) => r.type === "parent-child")
  const spouseRels = currentTree.relationships.filter((r) => r.type === "spouse")
  const siblingRels = currentTree.relationships.filter((r) => r.type === "sibling")

  // Draw parent-child relationships
  parentChildRels.forEach((rel) => {
    const parentId = rel.person1Role === "padre" || rel.person1Role === "madre" ? rel.person1Id : rel.person2Id
    const childId = rel.person1Role === "hijo" || rel.person1Role === "hija" ? rel.person1Id : rel.person2Id
    const parent = layout[parentId]
    const child = layout[childId]

    if (!parent || !child) return

    const midY = parent.y + (child.y - parent.y) / 2

    // Vertical line from parent
    const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line")
    line1.setAttribute("x1", parent.x)
    line1.setAttribute("y1", parent.y + 20)
    line1.setAttribute("x2", parent.x)
    line1.setAttribute("y2", midY)
    line1.setAttribute("stroke", "#059669")
    line1.setAttribute("stroke-width", "3")
    line1.setAttribute("opacity", "0.8")
    svg.appendChild(line1)

    // Horizontal line
    const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line")
    line2.setAttribute("x1", parent.x)
    line2.setAttribute("y1", midY)
    line2.setAttribute("x2", child.x)
    line2.setAttribute("y2", midY)
    line2.setAttribute("stroke", "#059669")
    line2.setAttribute("stroke-width", "3")
    line2.setAttribute("opacity", "0.8")
    svg.appendChild(line2)

    // Vertical line to child
    const line3 = document.createElementNS("http://www.w3.org/2000/svg", "line")
    line3.setAttribute("x1", child.x)
    line3.setAttribute("y1", midY)
    line3.setAttribute("x2", child.x)
    line3.setAttribute("y2", child.y - 20)
    line3.setAttribute("stroke", "#059669")
    line3.setAttribute("stroke-width", "3")
    line3.setAttribute("opacity", "0.8")
    svg.appendChild(line3)
  })

  // Draw spouse relationships
  spouseRels.forEach((rel) => {
    const person1 = layout[rel.person1Id]
    const person2 = layout[rel.person2Id]

    if (!person1 || !person2) return

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line")
    line.setAttribute("x1", person1.x + 20)
    line.setAttribute("y1", person1.y)
    line.setAttribute("x2", person2.x - 20)
    line.setAttribute("y2", person2.y)
    line.setAttribute("stroke", "#dc2626")
    line.setAttribute("stroke-width", "4")
    line.setAttribute("opacity", "0.9")
    svg.appendChild(line)
  })

  // Draw sibling relationships
  siblingRels.forEach((rel) => {
    const person1 = layout[rel.person1Id]
    const person2 = layout[rel.person2Id]

    if (!person1 || !person2) return

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line")
    line.setAttribute("x1", person1.x + 20)
    line.setAttribute("y1", person1.y - 30)
    line.setAttribute("x2", person2.x - 20)
    line.setAttribute("y2", person2.y - 30)
    line.setAttribute("stroke", "#2563eb")
    line.setAttribute("stroke-width", "3")
    line.setAttribute("opacity", "0.8")
    svg.appendChild(line)
  })
}

function drawPersonNodes(svg, layout) {
  Object.entries(layout).forEach(([personId, pos]) => {
    const person = allPeople.find((p) => p.id === personId)
    if (!person) return

    const colors = {
      male: { fill: "#22c55e", stroke: "#16a34a" },
      female: { fill: "#f97316", stroke: "#ea580c" },
      other: { fill: "#8b5cf6", stroke: "#7c3aed" },
    }

    const color = colors[person.gender] || colors.other

    if (person.gender === "male") {
      // Square for males
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect")
      rect.setAttribute("x", pos.x - 18)
      rect.setAttribute("y", pos.y - 18)
      rect.setAttribute("width", "36")
      rect.setAttribute("height", "36")
      rect.setAttribute("rx", "8")
      rect.setAttribute("fill", color.fill)
      rect.setAttribute("stroke", color.stroke)
      rect.setAttribute("stroke-width", "3")
      rect.setAttribute("opacity", "0.9")
      rect.style.cursor = "pointer"

      rect.addEventListener("mouseenter", (e) => showTooltip(e, person))
      rect.addEventListener("mouseleave", hideTooltip)

      svg.appendChild(rect)
    } else {
      // Circle for females
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle")
      circle.setAttribute("cx", pos.x)
      circle.setAttribute("cy", pos.y)
      circle.setAttribute("r", "20")
      circle.setAttribute("fill", color.fill)
      circle.setAttribute("stroke", color.stroke)
      circle.setAttribute("stroke-width", "3")
      circle.setAttribute("opacity", "0.9")
      circle.style.cursor = "pointer"

      circle.addEventListener("mouseenter", (e) => showTooltip(e, person))
      circle.addEventListener("mouseleave", hideTooltip)

      svg.appendChild(circle)
    }

    // Add leaf vein detail
    const vein = document.createElementNS("http://www.w3.org/2000/svg", "line")
    vein.setAttribute("x1", pos.x)
    vein.setAttribute("y1", pos.y - 15)
    vein.setAttribute("x2", pos.x)
    vein.setAttribute("y2", pos.y + 15)
    vein.setAttribute("stroke", color.stroke)
    vein.setAttribute("stroke-width", "1")
    vein.setAttribute("opacity", "0.6")
    svg.appendChild(vein)
  })
}

// Tooltip functionality
function showTooltip(event, person) {
  const tooltip = document.getElementById("tooltip")
  const rect = event.target.getBoundingClientRect()

  tooltip.innerHTML = `
        <h4>${person.name}</h4>
        <p>${person.gender === "male" ? "Hombre" : person.gender === "female" ? "Mujer" : "Otro"}</p>
        ${person.birthDate ? `<p>Nacimiento: ${person.birthDate}</p>` : ""}
        ${person.birthPlace ? `<p>Lugar: ${person.birthPlace}</p>` : ""}
        ${person.notes ? `<p><em>${person.notes}</em></p>` : ""}
    `

  tooltip.style.left = rect.right + 10 + "px"
  tooltip.style.top = rect.top + "px"
  tooltip.classList.add("active")
}

function hideTooltip() {
  document.getElementById("tooltip").classList.remove("active")
}
