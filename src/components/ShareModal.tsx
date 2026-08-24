import React, { useState } from 'react';
import { X, Share2, Copy, Check, Link as LinkIcon, Calendar } from 'lucide-react';
import { BASE_URL, type TraccarDevice } from '../lib/traccarApi';

interface ShareModalProps {
  device: TraccarDevice;
  onClose: () => void;
}

export function ShareModal({ device, onClose }: ShareModalProps) {
  const [expirationDays, setExpirationDays] = useState(7);
  const [shareLink, setShareLink] = useState('');
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      const expDate = new Date();
      expDate.setDate(expDate.getDate() + expirationDays);
      const expirationIso = expDate.toISOString();

      // 1. Crear un usuario temporal
      const randomStr = Math.random().toString(36).substring(2, 10);
      const tempUser = {
        name: `Share: ${device.name}`,
        email: `share_${randomStr}@tmp.com`,
        password: randomStr,
        readonly: true,
        disabled: false,
        expirationTime: expirationIso,
      };

      const userRes = await fetch(`${BASE_URL}/users`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tempUser),
      });

      if (!userRes.ok) throw new Error('Error al crear usuario temporal');
      const createdUser = await userRes.json();

      // 2. Vincular dispositivo al usuario temporal
      const permRes = await fetch(`${BASE_URL}/permissions`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: createdUser.id, deviceId: device.id }),
      });
      if (!permRes.ok) throw new Error('Error al asignar dispositivo');

      // 3. Generar token para este usuario (Traccar permite userId en la form)
      const tokenBody = new URLSearchParams();
      tokenBody.append('userId', createdUser.id.toString());
      tokenBody.append('expiration', expirationIso);

      const tokenRes = await fetch(`${BASE_URL}/session/token`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody.toString(),
      });

      if (!tokenRes.ok) throw new Error('Error al generar token');
      
      const token = await tokenRes.text();
      setShareLink(`${window.location.origin}/?token=${token}`);
      setCopied(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    if (!shareLink) return;
    navigator.clipboard.writeText(shareLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center">
              <Share2 size={18} className="text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Compartir Taxi</h2>
              <p className="text-xs text-gray-500">{device.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-200 rounded-lg transition">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">
            Genera un enlace público temporal para que otra persona pueda rastrear a <strong>{device.name}</strong> en vivo sin necesitar contraseña.
          </p>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-bold text-gray-700 mb-2">
              <Calendar size={14} /> Expira en:
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[1, 3, 7, 30].map(days => (
                <button
                  key={days}
                  onClick={() => { setExpirationDays(days); setShareLink(''); }}
                  className={`py-2 rounded-xl text-xs font-bold transition border ${
                    expirationDays === days
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {days} {days === 1 ? 'día' : 'días'}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded-lg">{error}</p>}

          {!shareLink ? (
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition mt-2 shadow-sm"
            >
              <LinkIcon size={16} />
              {generating ? 'Generando...' : 'Generar enlace de rastreo'}
            </button>
          ) : (
            <div className="mt-4 animate-fade-in space-y-3">
              <label className="block text-xs font-bold text-gray-700">Enlace generado:</label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareLink}
                  className="flex-1 border border-gray-200 bg-gray-50 rounded-xl px-3 py-2 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
                <button
                  onClick={handleCopy}
                  className={`flex items-center justify-center w-10 h-10 rounded-xl transition ${
                    copied ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                  }`}
                >
                  {copied ? <Check size={18} /> : <Copy size={18} />}
                </button>
              </div>
              <p className="text-[11px] text-orange-600 font-medium text-center bg-orange-50 py-1.5 rounded-lg border border-orange-100">
                ⚠️ Cualquier persona con este enlace podrá ver el taxi.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
