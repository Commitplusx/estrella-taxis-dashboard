import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  confirmClass?: string;
  requireInput?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal de confirmación estilizado — reemplaza al confirm() nativo del navegador.
 * Es no-bloqueante y va con el diseño del dashboard.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirmar',
  confirmClass = 'bg-red-600 hover:bg-red-700 text-white',
  requireInput,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [inputVal, setInputVal] = useState('');
  
  const disabled = requireInput ? inputVal !== requireInput : false;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-amber-50/30">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-500" />
            <h2 className="text-sm font-bold text-gray-900">{title}</h2>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:bg-gray-100 p-1.5 rounded-lg transition">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{message}</p>
          {requireInput && (
            <input 
              type="text" 
              placeholder={`Escribe ${requireInput}`}
              value={inputVal}
              onChange={e => setInputVal(e.target.value.toUpperCase())}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 font-mono text-center font-bold tracking-widest"
            />
          )}
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-gray-200 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={disabled}
            className={`flex-1 px-4 py-2 rounded-xl text-sm font-bold transition disabled:opacity-50 disabled:cursor-not-allowed ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
