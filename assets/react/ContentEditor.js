// APC Inventario V15 · Editor React de contenidos por recipiente.
// React 18 se importa por importmap desde index.html; no requiere npm ni compilar.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

const h = React.createElement;
const GROUPS = [
  { id: 'tapers', name: 'Solo tápers', keys: ['taper_rey','taper_gyg'], icon: '▣' },
  { id: 'tapas', name: 'Solo tapas', keys: ['tapas_rey','tapas_gyg'], icon: '▰' },
  { id: 'tapers_tapas', name: 'Tápers + tapas', keys: ['taper_rey','taper_gyg','tapas_rey','tapas_gyg'], icon: '▣' },
  { id: 'tenedores', name: 'Solo tenedores', keys: ['tenedores'], icon: '⑂' }
];

function ContentEditor({ name, items, allowed, selectedKeys, busy, onClose, onSave, onSelectionChange }) {
  const [selected, setSelected] = useState(() => [...selectedKeys]);
  const allowedSet = new Set(allowed);
  const set = (next) => {
    const cleaned = [...new Set(next)].filter(key => allowedSet.has(key));
    setSelected(cleaned);
    onSelectionChange(cleaned);
  };
  const presets = GROUPS.filter(preset => preset.keys.every(key => allowedSet.has(key)));
  const selectedPreset = presets.find(preset => preset.keys.length === selected.length && preset.keys.every(key => selected.includes(key)))?.id || '';
  const heading = h('header', { className: 'content-modal-header' },
    h('div', { className: 'content-modal-title' },
      h('span', { className: 'eyebrow' }, 'CONFIGURAR RECIPIENTE'),
      h('h2', null, 'Cambiar contenido'),
      h('p', null, 'Elige qué vas a guardar en ', h('strong', null, name), '.')),
    h('button', { type:'button', className: 'content-close', onClick:onClose, 'aria-label': 'Cerrar', disabled:busy }, '×'));
  const presetsBlock = h('div', { className:'content-presets', role:'group', 'aria-label':'Selección rápida de suministros' },
    h('div', { className:'content-title-line' }, 'Selecciona una opción rápida'),
    h('div', { className:'content-presets-grid' }, presets.map(preset =>
      h('button', {
        key:preset.id, type:'button', disabled:busy,
        'aria-pressed':selectedPreset === preset.id,
        className: `content-preset ${selectedPreset===preset.id ? 'active' : ''}`,
        onClick:()=>set(preset.keys)
      }, h('span', { className:'content-preset-icon' }, preset.icon), h('span',null,preset.name), h('span',{className:'preset-check'}, selectedPreset===preset.id ? '✓' : '')))));
  const choices = h('div',{className:'content-choices'},
    h('div',{className:'content-title-line'}, 'O personaliza por marca'),
    h('p',{className:'content-subtitle'},'Marca o desmarca cada tipo. Puedes combinar varios.'),
    h('div',{className:'content-grid'}, items.map(item =>
      h('label', { key:item.key, className:`content-choice ${selected.includes(item.key) ? 'is-active' : ''}` },
        h('input',{type:'checkbox', checked:selected.includes(item.key), disabled:busy,
          onChange:e => set(e.target.checked ? [...selected,item.key] : selected.filter(key=>key!==item.key))}),
        h('img',{ src:item.image, alt:item.alt, loading:'lazy', referrerPolicy:'no-referrer' }),
        h('span',{className:'content-choice-desc'}, h('strong',null,item.label),
          h('small',null,'Registrado: ',Number(item.quantity).toLocaleString('es-PE'))),
        h('span',{className:'content-choice-check','aria-hidden':'true'},selected.includes(item.key)?'✓':'+')))));
  return h('section',{className:'content-change-modal',role:'dialog','aria-modal':'true','aria-label':'Cambiar contenido del recipiente'},
    heading,
    h('div',{className:'content-change-body'},
      presetsBlock, choices,
      h('div',{className:'content-keep-note'},
        h('strong',null,'Importante: '),
        'Los productos que mantengas conservarán su cantidad. Los que quites pasarán a 0 y quedará registrado en el historial. Los que agregues comenzarán en 0. No se modifica tu QR.')),
    h('footer',{className:'content-modal-footer'},
      h('button',{type:'button',className:'button secondary',disabled:busy,onClick:onClose},'Cancelar'),
      h('button',{type:'button',className:'button primary',disabled:busy||!selected.length,onClick:()=>onSave(selected)}, busy?'Guardando…':'✓ Guardar contenido')));
}

/** Monta el componente React de verdad y devuelve una función para desmontarlo. */
export function mountContentEditor(node, props) {
  const root=createRoot(node);
  root.render(h(ContentEditor, props));
  return ()=>root.unmount();
}
