// C2: teclado de accesibilidad para los dialogos de marca.
// Uso: <div role="dialog" ... onKeyDown={(evento) => tecladoModal(evento, alCerrar)}>
// Escape ejecuta alCerrar y Tab queda atrapado dentro del contenedor
// (event.currentTarget), de modo que el foco no se escapa al fondo.
export function tecladoModal(evento, alCerrar) {
  if (evento.key === 'Escape') {
    evento.preventDefault();
    alCerrar();
    return;
  }
  if (evento.key !== 'Tab') return;
  const enfocables = Array.from(
    evento.currentTarget.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
  );
  if (enfocables.length === 0) return;
  const primero = enfocables[0];
  const ultimo = enfocables[enfocables.length - 1];
  if (enfocables.length === 1 || (document.activeElement === ultimo && !evento.shiftKey)) {
    evento.preventDefault();
    primero.focus();
    return;
  }
  if (evento.shiftKey && (document.activeElement === primero || !evento.currentTarget.contains(document.activeElement))) {
    evento.preventDefault();
    ultimo.focus();
  }
}
