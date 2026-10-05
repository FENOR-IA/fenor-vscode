/** CSS e JS do painel de sistemas. Todo dado vai para o DOM via textContent/value (sem innerHTML com dados). */

export const SYSTEMS_STYLES = `
:root {
  --accent: #e0702e;
  --accent-soft: color-mix(in srgb, var(--accent) 14%, transparent);
  --line: var(--vscode-panel-border, rgba(128,128,128,.25));
  --surface: var(--vscode-sideBar-background, rgba(128,128,128,.06));
  --muted: var(--vscode-descriptionForeground);
  --danger: var(--vscode-errorForeground, #f14c4c);
}
* { box-sizing: border-box; }
body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
.layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); min-height: 100vh; }
@media (max-width: 760px) { .layout { grid-template-columns: 1fr; } }
aside { border-right: 1px solid var(--line); background: var(--surface); padding: 22px 14px; display: flex; flex-direction: column; gap: 6px; }
.eyebrow { margin: 0 0 2px; letter-spacing: .18em; text-transform: uppercase; font-size: 11px; color: var(--accent); font-weight: 700; padding: 0 8px; }
aside h1 { margin: 0 0 14px; font-size: 20px; font-weight: 600; padding: 0 8px; }
.sys { text-align: left; border: 0; background: transparent; color: inherit; font: inherit; padding: 9px 10px; border-radius: 3px; cursor: pointer; display: flex; justify-content: space-between; gap: 8px; border-left: 3px solid transparent; }
.sys:hover { background: var(--accent-soft); }
.sys.active { background: var(--accent-soft); border-left-color: var(--accent); font-weight: 600; }
.sys small { color: var(--muted); font-weight: 400; }
.side-actions { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
main { padding: 28px 34px 60px; max-width: 980px; }
label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); font-weight: 600; margin: 18px 0 6px; }
input, select, textarea { width: 100%; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--line)); border-radius: 3px; padding: 7px 9px; }
input:focus, select:focus, textarea:focus, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
textarea { min-height: 64px; resize: vertical; }
.name { font-size: 24px; font-weight: 600; padding: 8px 10px; }
.row { display: flex; gap: 8px; align-items: center; }
button { font: inherit; padding: 6px 14px; border-radius: 3px; border: 1px solid var(--line); background: transparent; color: inherit; cursor: pointer; transition: border-color .15s, background .15s; white-space: nowrap; }
button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.ghost { border-color: transparent; color: var(--muted); }
button.ghost:hover { color: var(--danger); border-color: transparent; }
table { width: 100%; border-collapse: collapse; margin-top: 4px; }
th { text-align: left; font-size: 11px; color: var(--muted); font-weight: 600; padding: 6px 6px; border-bottom: 1px solid var(--line); }
td { padding: 6px; border-bottom: 1px solid var(--line); vertical-align: middle; }
td.role { width: 170px; }
td.del { width: 40px; text-align: right; }
.stack { font-size: 11px; color: var(--muted); margin-top: 3px; }
.free { margin-top: 26px; padding: 14px 16px; border: 1px dashed var(--line); border-radius: 4px; }
.free h3 { margin: 0 0 10px; font-size: 12px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font-size: 12px; padding: 4px 10px; border-radius: 12px; }
.footer { position: sticky; bottom: 0; margin-top: 28px; padding: 14px 0; background: var(--vscode-editor-background); border-top: 1px solid var(--line); display: flex; gap: 8px; justify-content: space-between; align-items: center; }
.muted { color: var(--muted); font-size: 12px; }
.mt { margin-top: 10px; }
.dirty { color: var(--accent); font-size: 12px; font-weight: 600; }
.empty { padding: 60px 0; color: var(--muted); }
`;

export const SYSTEMS_SCRIPT = `
const vscode = acquireVsCodeApi();
let systems = [], projects = [], roles = [], selected = 0, dirty = false, confirmingDelete = false;
const app = document.getElementById('app');

function el(tag, props, ...children) {
  const n = document.createElement(tag);
  Object.entries(props || {}).forEach(([k, v]) => {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else if (v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
  });
  children.flat().forEach((c) => n.append(c instanceof Node ? c : document.createTextNode(String(c ?? ''))));
  return n;
}
function touch() { dirty = true; confirmingDelete = false; render(); }
function used() { return new Set(systems.flatMap((s) => s.components.map((c) => c.project))); }
function projectOf(rel) { return projects.find((p) => p.relPath === rel); }
function slug(t) { return t.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function addSystem() {
  const name = 'Novo sistema ' + (systems.length + 1);
  systems.push({ id: slug(name), name, description: '', vault: slug(name) + '-vault', components: [] });
  selected = systems.length - 1; touch();
}

function render() {
  const s = systems[selected];
  app.replaceChildren(el('div', { class: 'layout' }, sidebar(), s ? editor(s) : el('main', {}, el('p', { class: 'empty' }, 'Nenhum sistema ainda. Crie um ou peça uma sugestão automática.'))));
}

function sidebar() {
  return el('aside', {},
    el('p', { class: 'eyebrow' }, 'Fenor'), el('h1', {}, 'Sistemas'),
    systems.map((s, i) => el('button', { class: 'sys' + (i === selected ? ' active' : ''), onclick: () => { selected = i; render(); } },
      el('span', {}, s.name), el('small', {}, String(s.components.length)))),
    el('div', { class: 'side-actions' },
      el('button', { onclick: addSystem }, '+ Novo sistema'),
      el('button', { onclick: () => vscode.postMessage({ type: 'suggest', systems }) , title: 'Agrupa os projetos ainda sem sistema pela pasta e pelo nome' }, 'Sugerir automaticamente')));
}

function editor(s) {
  const taken = used();
  const free = projects.filter((p) => !taken.has(p.relPath));
  return el('main', {},
    el('label', { for: 'nome' }, 'Nome do sistema'),
    el('input', { id: 'nome', class: 'name', value: s.name, oninput: (e) => { s.name = e.target.value; dirty = true; } , onchange: render }),
    el('label', { for: 'desc' }, 'Descrição'),
    el('textarea', { id: 'desc', value: s.description || '', placeholder: 'Para quem é, o que resolve, principais fluxos', oninput: (e) => { s.description = e.target.value; dirty = true; } }),
    el('label', { for: 'vault' }, 'Vault (repositório próprio do sistema)'),
    el('div', { class: 'row' },
      el('input', { id: 'vault', value: s.vault || '', placeholder: s.id + '-vault', oninput: (e) => { s.vault = e.target.value; dirty = true; } }),
      el('button', { onclick: () => vscode.postMessage({ type: 'pickVault', index: selected }) }, 'Escolher…')),
    el('p', { class: 'muted' }, 'Relativo à pasta aberta no VS Code, ou caminho absoluto. O Fenor cria a pasta e o repositório git se não existirem.'),
    el('label', {}, 'Componentes'),
    s.components.length ? el('table', {},
      el('thead', {}, el('tr', {}, el('th', {}, 'Projeto'), el('th', {}, 'Papel'), el('th', {}, 'Observação'), el('th', {}, ''))),
      el('tbody', {}, s.components.map((c, i) => componentRow(s, c, i, taken)))) : el('p', { class: 'muted' }, 'Nenhum componente. Adicione abaixo.'),
    el('div', { class: 'row mt' },
      el('button', { onclick: () => { const p = free[0]; s.components.push({ project: p ? p.relPath : '', role: p ? p.role : 'back' }); touch(); }, disabled: !free.length }, '+ Adicionar componente')),
    free.length ? el('div', { class: 'free' }, el('h3', {}, 'Projetos sem sistema — clique para adicionar a ' + s.name),
      el('div', { class: 'chips' }, free.map((p) => el('button', { class: 'chip', title: p.relPath, onclick: () => { s.components.push({ project: p.relPath, role: p.role }); touch(); } }, '+ ' + p.name)))) : '',
    el('div', { class: 'footer' },
      el('div', { class: 'row' },
        el('button', { class: 'primary', onclick: () => { dirty = false; vscode.postMessage({ type: 'save', systems }); } }, 'Salvar'),
        el('button', { onclick: () => { dirty = false; vscode.postMessage({ type: 'generate', systems, id: s.id }); } }, 'Salvar e gerar vault'),
        dirty ? el('span', { class: 'dirty' }, 'alterações não salvas') : ''),
      el('button', { class: 'ghost', onclick: () => {
        // Webviews não têm confirm(): segundo clique confirma. Projetos e vault nunca são apagados.
        if (!confirmingDelete && s.components.length) { confirmingDelete = true; render(); return; }
        confirmingDelete = false; systems.splice(selected, 1); selected = Math.max(0, selected - 1); touch();
      } }, confirmingDelete ? 'Clique de novo para excluir (projetos e vault ficam)' : 'Excluir sistema')));
}

function componentRow(s, c, i, taken) {
  const p = projectOf(c.project);
  const options = projects.filter((x) => x.relPath === c.project || !taken.has(x.relPath));
  return el('tr', {},
    el('td', {},
      el('select', { 'aria-label': 'Projeto', onchange: (e) => { c.project = e.target.value; const np = projectOf(c.project); if (np) c.role = np.role; touch(); } },
        (p ? [] : [el('option', { value: c.project, selected: true }, c.project || '(escolha)')]),
        options.map((x) => el('option', { value: x.relPath, selected: x.relPath === c.project }, x.name + ' — ' + x.relPath))),
      el('div', { class: 'stack' }, p ? [p.stack, p.framework].filter(Boolean).join(' · ') : 'projeto não encontrado nesta pasta')),
    el('td', { class: 'role' },
      el('select', { 'aria-label': 'Papel', onchange: (e) => { c.role = e.target.value; dirty = true; } },
        roles.map((r) => el('option', { value: r.id, selected: r.id === c.role }, r.label)))),
    el('td', {}, el('input', { value: c.note || '', placeholder: 'ex.: API de cobrança', oninput: (e) => { c.note = e.target.value; dirty = true; } })),
    el('td', { class: 'del' }, el('button', { class: 'ghost', title: 'Remover do sistema', 'aria-label': 'Remover', onclick: () => { s.components.splice(i, 1); touch(); } }, '✕')));
}

window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'init') {
    const keep = systems[selected] && systems[selected].id;
    systems = m.systems.sistemas; projects = m.projects; roles = m.roles;
    selected = Math.max(0, systems.findIndex((s) => s.id === keep));
    dirty = false; render();
  } else if (m.type === 'suggested') {
    systems = m.systems.sistemas; touch();
  } else if (m.type === 'vaultPicked' && systems[m.index]) {
    systems[m.index].vault = m.path; touch();
  }
});
vscode.postMessage({ type: 'ready' });
`;
