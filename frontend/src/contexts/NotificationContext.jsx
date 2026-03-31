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

  const getNotificationMessage = useCallback((event) => {
    const name = event.fileName || '';
    const user = event.userName || '';
    switch (event.type) {
      case 'file_added': return `${t('newFileUploaded')}: ${name} (${user})`;
      case 'file_updated': return `${t('fileUpdated')}: ${name} (${user})`;
      case 'file_deleted': return `${t('fileDeletedNotif')}: ${name} (${user})`;
      case 'version_restored': return `${t('versionRestored')}: ${name} (${user})`;
      case 'file_locked': return `${t('fileLockNotif')}: ${name} (${user})`;
      case 'file_unlocked': return `${t('fileUnlockNotif')}: ${name} (${user})`;
      default: return name;
    }
  }, [t]);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const token = localStorage.getItem('accessToken');
    if (!token) return;

    const es = new EventSource(`/api/notifications/stream?token=${encodeURIComponent(token)}`);
    eventSourceRef.current = es;

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
      // Reconnect after 10 seconds
      setTimeout(() => {
        if (user) connectSSE();
      }, 10000);
    };
  }, [user, getNotificationMessage, t]);

  useEffect(() => {
    if (user) {
      connectSSE();
    } else {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    }
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [user, connectSSE]);

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
