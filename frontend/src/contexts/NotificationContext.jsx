import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { notification as antNotification } from 'antd';
import { useAuth } from './AuthContext';
import { useLang } from './LangContext';

const NotificationContext = createContext(null);

const MAX_NOTIFICATIONS = 50;

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const { t } = useLang();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const eventSourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  const getNotificationMessage = useCallback((event) => {
    const name = event.fileName || '';
    const userName = event.userName || '';
    switch (event.type) {
      case 'file_added': return `${t('newFileUploaded')}: ${name} (${userName})`;
      case 'file_updated': return `${t('fileUpdated')}: ${name} (${userName})`;
      case 'file_deleted': return `${t('fileDeletedNotif')}: ${name} (${userName})`;
      case 'version_restored': return `${t('versionRestored')}: ${name} (${userName})`;
      case 'file_locked': return `${t('fileLockNotif')}: ${name} (${userName})`;
      case 'file_unlocked': return `${t('fileUnlockNotif')}: ${name} (${userName})`;
      default: return name;
    }
  }, [t]);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const token = localStorage.getItem('accessToken');
    if (!token) return;

    const es = new EventSource(`/api/notifications/stream?token=${encodeURIComponent(token)}`);
    eventSourceRef.current = es;

    es.onopen = () => {
      // SSE connection established successfully
    };

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        const msg = getNotificationMessage(event);

        // Show Ant Design notification popup
        antNotification.info({
          message: t('notifications'),
          description: msg,
          placement: 'topRight',
          duration: 5,
        });

        // Add to notifications list
        setNotifications(prev => {
          const newItem = {
            id: `${Date.now()}-${Math.random()}`,
            message: msg,
            type: event.type,
            fileId: event.fileId,
            timestamp: event.timestamp || new Date().toISOString(),
            read: false,
          };
          return [newItem, ...prev].slice(0, MAX_NOTIFICATIONS);
        });
        setUnreadCount(prev => prev + 1);
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      // Only reconnect if the user still has a valid token
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(() => {
        const currentToken = localStorage.getItem('accessToken');
        if (currentToken) connectSSE();
      }, 10000);
    };
  }, [getNotificationMessage, t]);

  useEffect(() => {
    const userId = user?.id;
    if (userId) {
      connectSSE();
    } else {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    }
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [user?.id, connectSSE]);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    setUnreadCount(0);
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
    setUnreadCount(0);
  }, []);

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, markAllRead, clearNotifications }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}
