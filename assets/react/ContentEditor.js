// APC Inventario V16 · React 18. Todos los tipos permitidos en cualquier recipiente.
// React se carga mediante importmap en index.html (sin pasos de npm/build).
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

const h = React.createElement;
const PRESETS = [
  { id: 'tapers', label: 'Solo tápers', keys: ['taper_rey', 'taper_gyg'] },
  { id: 'tapas', label: 'Solo tapas', keys: ['tapas_rey', 'tapas_gyg'] },
  { id: 'tapers_tapas', label: 'Tápers y tapas', keys: ['taper_rey', 'taper_gyg', 'tapas_rey', 'tapas_gyg'] },
  { id: 'tenedores', label: 'Solo tenedores', keys: ['tenedores'] },
  { id: 'all', label: 'Todos los suministros', keys: ['taper_rey', 'taper_gyg', 'tapas_rey', 'tapas_gyg', 'tenedores'] }
];

function ProductRow({ item, selected, busy, onToggle }) {
  return h('article', { className: `content-product-row ${selected ? 'content-product-selected' : 'content-product-add'}`, 'data-product-key': item.key },
    h('img', { src: item.image, alt: item.alt || item.label, loading: 'lazy', referrerPolicy: 'no-referrer' }),
    h('div', { className: 'content-product-copy' },
      h('strong', null, item.label),
      h('small', null, selected
        ? `Registrado: ${Number(item.quantity || 0).toLocaleString('es-PE')} unidades`
        : 'Disponible para agregar a este recipiente')),
    h('button', {
      type: 'button',
      className: `content-product-button ${selected ? 'remove' : 'add'}`,
      disabled: busy,
      onClick: onToggle,
      'aria-label': `${selected ? 'Quitar' : 'Agregar'} ${item.label}`
    }, selected ? 'Quitar' : '+ Agregar'));
}

function ContentEditor({ name, items, allowed, selectedKeys, busy, onClose, onSave, onSelectionChange }) {
  const [selected, setSelected] = useState(() => [...selectedKeys]);
  const allowedSet = new Set(allowed);
  const set = (keys) => {
    const next = [...new Set(keys)].filter(key => allowedSet.has(key));
    setSelected(next);
    onSelectionChange?.(next);
  };
  const included = items.filter(item => selected.includes(item.key));
  const available = items.filter(item => !selected.includes(item.key));
  const toggle = (key) => set(selected.includes(key) ? selected.filter(value => value !== key) : [...selected, key]);

  return h('section', { className: 'content-change-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Editar suministros de ${name}` },
    h('header', { className: 'content-modal-header' },
      h('div', { className: 'content-modal-title' },
        h('span', { className: 'eyebrow' }, 'CONFIGURAR RECIPIENTE'),
        h('h2', null, 'Agregar o quitar suministros'),
        h('p', null, 'En ', h('strong', null, name), ' puedes combinar tápers, tapas y tenedores.')),
      h('button', { type: 'button', className: 'content-close', onClick: onClose, 'aria-label': 'Cerrar', disabled: busy }, '×')),

    h('div', { className: 'content-change-body' },
      h('div', { className: 'content-simple-tip' },
        h('strong', null, '¿Necesitas poner tenedores?'),
        h('span', null, 'Busca «Tenedores» y pulsa «+ Agregar». No tienes que quitar los tápers que ya guardaste.')),

      h('section', { className: 'content-products-section' },
        h('div', { className: 'content-section-head' },
          h('h3', null, 'Suministros que ya contiene'),
          h('span', { className: 'content-counter' }, String(included.length))),
        included.length
          ? h('div', { className: 'content-products-list' }, included.map(item =>
              h(ProductRow, { key: item.key, item, selected: true, busy, onToggle: () => toggle(item.key) })))
          : h('p', { className: 'content-empty-msg' }, 'Aún no hay suministros seleccionados. Agrega al menos uno de la lista de abajo.')),

      h('section', { className: 'content-products-section' },
        h('div', { className: 'content-section-head' },
          h('h3', null, 'Agregar otro suministro'),
          h('span', { className: 'content-counter' }, String(available.length))),
        available.length
          ? h('div', { className: 'content-products-list' }, available.map(item =>
              h(ProductRow, { key: item.key, item, selected: false, busy, onToggle: () => toggle(item.key) })))
          : h('p', { className: 'content-empty-msg' }, 'Ya tienes disponibles todos los suministros.')),

      h('details', { className: 'content-preset-details' },
        h('summary', null, 'Opciones rápidas para reemplazar la selección'),
        h('p', null, 'Úsalas solo si quieres cambiar todos los tipos que almacena este recipiente.'),
        h('div', { className: 'content-preset-buttons' }, PRESETS.filter(preset => preset.keys.every(key => allowedSet.has(key))).map(preset =>
          h('button', { key: preset.id, type: 'button', className: 'content-preset-mini', disabled: busy, onClick: () => set(preset.keys) }, preset.label)))),

      h('div', { className: 'content-keep-note' },
        h('strong', null, 'Tu stock se mantiene. '),
        'Agregar un producto no elimina lo que ya tienes. Si quitas un producto que tiene unidades registradas, la web te pedirá confirmación antes de ponerlo en cero. El QR no cambia.')),

    h('footer', { className: 'content-modal-footer' },
      h('button', { type: 'button', className: 'button secondary', disabled: busy, onClick: onClose }, 'Cancelar'),
      h('button', { type: 'button', className: 'button primary', disabled: busy || !selected.length, onClick: () => onSave(selected) },
        busy ? 'Guardando…' : '✓ Guardar cambios')));
}

export function mountContentEditor(node, props) {
  const root = createRoot(node);
  root.render(h(ContentEditor, props));
  return () => root.unmount();
}
