import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/chat.js';

interface CreateRoomDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CreateRoomDialog({ isOpen, onClose }: CreateRoomDialogProps) {
  const { t } = useTranslation();
  const createRoom = useChatStore((state) => state.createRoom);

  const [name, setName] = useState('');
  const [type, setType] = useState<'private' | 'group'>('private');
  const [broadcastMode, setBroadcastMode] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError(t('pleaseEnterRoomName') || 'Please enter a room name');
      return;
    }

    setIsCreating(true);
    try {
      await createRoom(name, type, broadcastMode);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedToCreateRoom') || 'Failed to create room');
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    setName('');
    setType('private');
    setBroadcastMode(false);
    setError('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">{t('newRoom')}</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
              {error}
            </div>
          )}

          {/* Room Name */}
          <div>
            <label htmlFor="roomName" className="block text-sm font-medium text-gray-700 mb-2">
              {t('roomName')}
            </label>
            <input
              id="roomName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              placeholder={t('enterRoomName') || 'Enter room name'}
              autoFocus
              required
            />
          </div>

          {/* Room Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('roomType')}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setType('private')}
                className={`px-4 py-3 border-2 rounded-lg text-left transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  type === 'private'
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <svg
                    className={`w-5 h-5 ${type === 'private' ? 'text-blue-600' : 'text-gray-500'}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                  <span
                    className={`font-medium ${type === 'private' ? 'text-blue-900' : 'text-gray-900'}`}
                  >
                    {t('privateRoom')}
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setType('group')}
                className={`px-4 py-3 border-2 rounded-lg text-left transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  type === 'group'
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <svg
                    className={`w-5 h-5 ${type === 'group' ? 'text-blue-600' : 'text-gray-500'}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                  </svg>
                  <span
                    className={`font-medium ${type === 'group' ? 'text-blue-900' : 'text-gray-900'}`}
                  >
                    {t('groupRoom')}
                  </span>
                </div>
              </button>
            </div>
          </div>

          {/* Broadcast Mode */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={broadcastMode}
                onChange={(e) => setBroadcastMode(e.target.checked)}
                className="mt-1 w-4 h-4 text-blue-600 bg-white border-gray-300 rounded focus:ring-blue-500 focus:ring-2"
              />
              <div className="flex-1">
                <div className="font-medium text-gray-900 text-sm">{t('broadcastMode')}</div>
                <div className="text-xs text-gray-600 mt-1">{t('broadcastModeDesc')}</div>
              </div>
            </label>
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={isCreating}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              {isCreating ? (t('creating') || 'Creating...') : t('create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
