import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/auth.js';
import { api } from '../lib/api.js';
import {
  getNotificationPreference,
  setNotificationPreference,
  requestNotificationPermission,
} from '../lib/notifications.js';
import { toast } from '../stores/toast.js';

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [isSaving, setIsSaving] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(getNotificationPreference());

  const languages = [
    { code: 'en', label: 'English', flag: '🇺🇸' },
    { code: 'zh-CN', label: '中文', flag: '🇨🇳' },
    { code: 'ja', label: '日本語', flag: '🇯🇵' },
    { code: 'ko', label: '한국어', flag: '🇰🇷' },
  ];

  const handleSaveProfile = async () => {
    setIsSaving(true);
    try {
      const res = await api.put('/users/me', { displayName });
      if (res.ok) {
        toast.success(t('profileUpdated'));
      } else {
        toast.error(res.error || t('error'));
      }
    } catch {
      toast.error(t('error'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleLanguageChange = (langCode: string) => {
    i18n.changeLanguage(langCode);
    localStorage.setItem('aim_language', langCode);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 px-6 py-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{t('settings')}</h1>
          <p className="mt-1 text-sm text-gray-600">
            {t('manageSettings') || 'Manage your account settings and preferences'}
          </p>
        </div>

        <div className="space-y-6">
          {/* Profile Section */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">{t('profile')}</h2>
              <p className="mt-1 text-sm text-gray-600">
                {t('updateProfile') || 'Update your personal information'}
              </p>
            </div>
            <div className="px-6 py-5 space-y-5">
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('username')}
                </label>
                <input
                  id="username"
                  type="text"
                  value={user?.username || ''}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500 cursor-not-allowed"
                />
                <p className="mt-1 text-xs text-gray-500">
                  {t('usernameCannotBeChanged') || 'Username cannot be changed'}
                </p>
              </div>

              <div>
                <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-2">
                  {t('displayName')}
                </label>
                <input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  placeholder={t('enterDisplayName') || 'Enter your display name'}
                />
              </div>

              <div className="flex items-center justify-end pt-2">
                <button
                  onClick={handleSaveProfile}
                  disabled={isSaving}
                  className="ml-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  {isSaving ? (t('saving') || 'Saving...') : t('save')}
                </button>
              </div>
            </div>
          </div>

          {/* Language Section */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">{t('language')}</h2>
              <p className="mt-1 text-sm text-gray-600">
                {t('selectLanguage') || 'Select your preferred language'}
              </p>
            </div>
            <div className="px-6 py-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {languages.map((lang) => {
                  const isActive = i18n.language === lang.code;
                  return (
                    <button
                      key={lang.code}
                      onClick={() => handleLanguageChange(lang.code)}
                      className={`px-4 py-3 border-2 rounded-lg text-left transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                        isActive
                          ? 'border-blue-600 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{lang.flag}</span>
                        <div className="flex-1">
                          <div
                            className={`font-medium ${isActive ? 'text-blue-900' : 'text-gray-900'}`}
                          >
                            {lang.label}
                          </div>
                          <div
                            className={`text-xs ${isActive ? 'text-blue-600' : 'text-gray-500'}`}
                          >
                            {lang.code}
                          </div>
                        </div>
                        {isActive && (
                          <svg
                            className="w-5 h-5 text-blue-600"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Notifications Section */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">{t('notifications')}</h2>
              <p className="mt-1 text-sm text-gray-600">
                {t('notificationsDesc')}
              </p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{t('mentionNotifications')}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{t('mentionNotificationsDesc')}</p>
                </div>
                <button
                  onClick={async () => {
                    if (!notificationsEnabled) {
                      const granted = await requestNotificationPermission()
                      if (!granted) {
                        toast.error(t('notificationPermissionDenied'))
                        return
                      }
                    }
                    const next = !notificationsEnabled
                    setNotificationPreference(next)
                    setNotificationsEnabled(next)
                    toast.success(next ? t('notificationsEnabled') : t('notificationsDisabled'))
                  }}
                  className={`
                    relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                    ${notificationsEnabled ? 'bg-blue-600' : 'bg-gray-200'}
                  `}
                >
                  <span
                    className={`
                      inline-block h-4 w-4 rounded-full bg-white shadow-sm transform transition-transform
                      ${notificationsEnabled ? 'translate-x-6' : 'translate-x-1'}
                    `}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* About Section */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">{t('about')}</h2>
            </div>
            <div className="px-6 py-5 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-700">{t('version')}</span>
                <span className="text-sm text-gray-600">1.0.0</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-700">
                  {t('appName') || 'AgentIM'}
                </span>
                <span className="text-sm text-gray-600">
                  {t('aiAgentPlatform') || 'AI Agent Management Platform'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
