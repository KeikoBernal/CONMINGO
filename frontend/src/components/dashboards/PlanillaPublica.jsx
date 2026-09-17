import React from 'react';
import PlanillaUniversal from './PlanillaUniversal';

export default function PlanillaPublica(props) {
  return (
    <PlanillaUniversal 
      {...props} 
      rol="espectador" 
    />
  );
}