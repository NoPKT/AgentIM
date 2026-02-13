import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../stores/chat.js';

export default function ChatPage() {
  const { t } = useTranslation();
  const { roomId: routeRoomId } = useParams();
  const currentRoomId = useChatStore((state) => state.currentRoomId);
  const setCurrentRoom = useChatStore((state) => state.setCurrentRoom);

  // Sync route param → store
  useEffect(() => {
    if (routeRoomId && routeRoomId !== currentRoomId) {
      setCurrentRoom(routeRoomId);
    }
  }, [routeRoomId, currentRoomId, setCurrentRoom]);
  const rooms = useChatStore((state) => state.rooms);
  const messages = useChatStore((state) => state.messages);
  const streaming = useChatStore((state) => state.streaming);
  const hasMore = useChatStore((state) => state.hasMore);
  const loadMessages = useChatStore((state) => state.loadMessages);
  const sendMessage = useChatStore((state) => state.sendMessage);

  const currentRoom = rooms.find((r) => r.id === currentRoomId);
  const roomMessages = currentRoomId ? messages.get(currentRoomId) ?? [] : [];
  const roomHasMore = currentRoomId ? hasMore.get(currentRoomId) ?? false : false;

  useEffect(() => {
    if (currentRoomId && !messages.has(currentRoomId)) {
      loadMessages(currentRoomId);
    }
  }, [currentRoomId, messages, loadMessages]);

  const handleSendMessage = (content: string, mentions: string[]) => {
    if (currentRoomId && content.trim()) {
      sendMessage(currentRoomId, content, mentions);
    }
  };

  const handleLoadMore = () => {
    if (currentRoomId && roomHasMore && roomMessages.length > 0) {
      const oldestMessage = roomMessages[0];
      loadMessages(currentRoomId, oldestMessage.id);
    }
  };

  if (!currentRoomId) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <h3 className="mt-4 text-lg font-medium text-gray-900">
            {t('selectRoomToChat') || 'Select a room to start chatting'}
          </h3>
          <p className="mt-2 text-sm text-gray-600">
            {t('chooseRoomFromSidebar') || 'Choose a room from the sidebar or create a new one'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white">
      {/* Room Header */}
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-gray-900">{currentRoom?.name || 'Chat'}</h2>
        {currentRoom?.broadcastMode && (
          <p className="text-xs text-gray-500 mt-1">{t('broadcastMode')}</p>
        )}
      </div>

      {/* Messages List */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {roomHasMore && (
          <button
            onClick={handleLoadMore}
            className="w-full text-sm text-blue-600 hover:text-blue-700 font-medium py-2"
          >
            {t('loadMore')}
          </button>
        )}

        {roomMessages.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">{t('noMessages')}</p>
          </div>
        )}

        {roomMessages.map((msg) => (
          <div key={msg.id} className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-sm font-medium">
              {msg.senderName?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-medium text-gray-900">{msg.senderName}</span>
                <span className="text-xs text-gray-500">
                  {new Date(msg.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <div className="mt-1 text-gray-800 whitespace-pre-wrap break-words">
                {msg.content}
              </div>
            </div>
          </div>
        ))}

        {/* Streaming Messages */}
        {Array.from(streaming.entries()).map(([key, stream]) => {
          if (!key.startsWith(`${currentRoomId}:`)) return null;
          return (
            <div key={key} className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-teal-600 flex items-center justify-center text-white text-sm font-medium">
                {stream.agentName?.charAt(0).toUpperCase() || 'A'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-gray-900">{stream.agentName}</span>
                  <span className="text-xs text-gray-500">{t('typing') || 'typing...'}</span>
                </div>
                <div className="mt-1 text-gray-800 whitespace-pre-wrap break-words">
                  {stream.chunks.map((chunk, i) => (
                    <span key={i}>{chunk.content || ''}</span>
                  ))}
                  <span className="inline-block w-1.5 h-4 bg-blue-600 animate-pulse ml-0.5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Message Input */}
      <MessageInput onSend={handleSendMessage} />
    </div>
  );
}

// Simple message input component
function MessageInput({ onSend }: { onSend: (content: string, mentions: string[]) => void }) {
  const { t } = useTranslation();
  const [content, setContent] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (content.trim()) {
      // Extract @mentions (simple regex)
      const mentions = Array.from(content.matchAll(/@(\w+)/g)).map((m) => m[1]);
      onSend(content, mentions);
      setContent('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-gray-200 px-6 py-4">
      <div className="flex gap-3 items-end">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('sendMessage') || 'Send a message...'}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
          rows={1}
          style={{ minHeight: '40px', maxHeight: '120px' }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = 'auto';
            target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
          }}
        />
        <button
          type="submit"
          disabled={!content.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          {t('send')}
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-500">{t('sendWithCmd') || 'Cmd+Enter to send'}</p>
    </form>
  );
}
