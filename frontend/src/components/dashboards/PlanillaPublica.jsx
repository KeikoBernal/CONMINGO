import React from 'react';
import PlanillaUniversal from './PlanillaUniversal';

export default function PlanillaPublica(props) {
  return (
    <div className="w-full">
      <PlanillaUniversal 
        {...props} 
        rol="espectador" 
      />
    </div>
  );
}