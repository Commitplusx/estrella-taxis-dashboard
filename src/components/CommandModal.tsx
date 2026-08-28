import React, { useState } from 'react';
import { BASE_URL, type TraccarDevice } from '../lib/traccarApi';
import { X, ShieldAlert, ZapOff, Zap, MapPin, Code } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';
import toast from 'react-hot-toast';

const COMMANDS = [
  { value: 'engineStop', label: 'Apagar Motor (Corte de corriente)', icon: <ZapOff size={16} /> },
  { value: 'engineResume', label: 'Reanudar Motor (Restaurar corriente)', icon: <Zap size={16} /> },
  { value: 'positionSingle', label: 'Solicitar ubicación actual', icon: <MapPin size={16} /> },
  { value: 'custom', label: 'Comando crudo (GPRS/SMS)', icon: <Code size={16} /> },
];

export function CommandModal({ device, onClose }: { device: TraccarDevice; onClose: () => void; }) {
  const [type, setType] = useState('engineStop');
  const [customData, setCustomData] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const executeSend = async () => {
    setSending(true);
    setSendError(null);
    try {
      const payload: any = { deviceId: device.id, type };
      if (type === 'custom') payload.attributes = { data: customData };
      
      const res = await fetch(`${BASE_URL}/commands/send`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        throw new Error(await res.text() || `Error HTTP: ${res.status}`);
      }
      
      toast.success('Comando enviado con éxito');
      onClose();
      
    } catch (e: any) {
      setSendError(e.message || 'Error desconocido al enviar el comando.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-[9999]">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm flex flex-col max-h-[90vh] animate-fade-in">
        
        {/* Header - Fijo */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-red-50/50 shrink-0 rounded-t-2xl">
          <h2 className="text-sm font-bold text-red-900 flex items-center gap-2">
            <ShieldAlert size={16} className="text-red-600" />
            Comandos Remotos
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:bg-white p-1.5 rounded-lg">
            <X size={16} />
          </button>
        </div>

        {/* Body - Scrolleable */}
        <div className="p-5 space-y-5 overflow-y-auto min-h-0 flex-1">
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">Taxi seleccionado:</label>
            <div className="text-sm font-semibold text-gray-900 bg-gray-50 px-3 py-2 rounded-lg border border-gray-100">
              {device.name}
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-2">Comando a ejecutar:</label>
            <div className="space-y-2">
              {COMMANDS.map(c => (
                <button key={c.value} onClick={() => setType(c.value)}
                  className={`w-full flex items-center gap-3 px-3 py-2 border rounded-xl text-left transition ${
                    type === c.value ? 'border-red-500 bg-red-50' : 'border-gray-200 hover:border-red-200 hover:bg-gray-50'
                  }`}>
                  {c.icon}
                  <span className={`text-sm font-semibold ${type === c.value ? 'text-red-700' : 'text-gray-700'}`}>{c.label}</span>
                </button>
              ))}
            </div>
          </div>
          {type === 'custom' && (
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">Texto del comando:</label>
              <input value={customData} onChange={e => setCustomData(e.target.value)} placeholder="Ej: set_apn..."
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
            </div>
          )}
          {sendError && (
            <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-xl border border-red-100">{sendError}</p>
          )}
        </div>

        {/* Footer - Fijo */}
        <div className="p-5 pt-4 border-t border-gray-100 flex gap-2 shrink-0">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={() => setConfirmOpen(true)} disabled={sending}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-bold disabled:opacity-50 shadow-sm shadow-red-600/20">
            {sending ? 'Enviando...' : 'Ejecutar'}
          </button>
        </div>
      </div>

      {/* Confirmación antes de mandar el comando */}
      {confirmOpen && (
        <ConfirmDialog
          title="¿Enviar comando remoto?"
          message={
            type === 'engineStop' 
            ? `Vas a CORTAR LA CORRIENTE al taxi "${device.name}". Si va en movimiento, puede causar un accidente.\n\nEscribe la palabra APAGAR para confirmar:` 
            : `Vas a enviar "${COMMANDS.find(c => c.value === type)?.label}" al taxi "${device.name}". Esta acción puede afectar la operación del vehículo.`
          }
          requireInput={type === 'engineStop' ? 'APAGAR' : undefined}
          confirmLabel="Sí, ejecutar"
          onConfirm={() => {
            setConfirmOpen(false);
            executeSend();
          }}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}
