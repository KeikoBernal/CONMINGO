import { useState } from 'react';

// Tarjetas apiladas para pantallas chicas: el dashboard oculta la tabla con
// hidden md:block y monta este componente al lado; cada tarjeta muestra los
// campos clave, un desplegable Ver detalle con el resto y las acciones de fila.
export default function TarjetasMovil({ filas = [], clave = 'id', campos = [], detalle = [], acciones = null }) {
  const [expandidas, setExpandidas] = useState(() => new Set());

  const alternarDetalle = (llave) => {
    setExpandidas((previo) => {
      const nuevas = new Set(previo);
      if (nuevas.has(llave)) nuevas.delete(llave);
      else nuevas.add(llave);
      return nuevas;
    });
  };

  return (
    <div className="md:hidden space-y-3">
      {filas.map((fila) => {
        const llave = fila[clave];
        const abierta = expandidas.has(llave);
        return (
          <div key={llave} className="bg-white border border-brand-gold/40 rounded-lg p-4 space-y-2">
            {campos.map((campo) => (
              <div key={campo.etiqueta} className="flex justify-between gap-3 text-sm">
                <span className="text-brand-brown/70">{campo.etiqueta}</span>
                <span className="font-semibold text-brand-brown text-right">{campo.valor(fila)}</span>
              </div>
            ))}
            {abierta && detalle.length > 0 && (
              <div className="border-t border-brand-gold/30 pt-2 space-y-1">
                {detalle.map((campo) => (
                  <div key={campo.etiqueta} className="flex justify-between gap-3 text-sm">
                    <span className="text-brand-brown/70">{campo.etiqueta}</span>
                    <span className="text-brand-brown text-right">{campo.valor(fila)}</span>
                  </div>
                ))}
              </div>
            )}
            {detalle.length > 0 && (
              <button
                type="button"
                onClick={() => alternarDetalle(llave)}
                className="bg-white border border-brand-gold/40 text-brand-brown hover:bg-brand-rust hover:text-white rounded-lg text-sm font-bold px-3 py-1.5 transition-colors"
              >
                {abierta ? 'Ver menos' : 'Ver detalle'}
              </button>
            )}
            {acciones && <div className="flex flex-wrap gap-2 pt-1">{acciones(fila)}</div>}
          </div>
        );
      })}
    </div>
  );
}
