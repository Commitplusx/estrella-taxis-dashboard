import React from 'react';
import { useFeature, type Feature } from '../hooks/useFeature';

interface RequireFeatureProps {
  feature: Feature;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Componente Guardián que destruye o envuelve contenido si el usuario no tiene acceso.
 * Evita la renderización de secciones Pro para planes básicos.
 */
export function RequireFeature({ feature, children, fallback = null }: RequireFeatureProps) {
  const hasAccess = useFeature(feature);

  if (!hasAccess) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
