import React, { useState } from 'react';
import { Layout, Menu, Avatar, Dropdown, Button, Space, Typography, Switch } from 'antd';
import {
  DashboardOutlined,
  FileOutlined,
  HistoryOutlined,
  TeamOutlined,
  UserOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  GlobalOutlined,
  FolderOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useLang } from '../../contexts/LangContext';

const { Header, Sider, Content } = Layout;

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const { user, logout, isAdmin } = useAuth();
  const { t, lang, switchLang } = useLang();
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: t('dashboard') },
    { key: '/files', icon: <FileOutlined />, label: t('files') },
    { key: '/history', icon: <HistoryOutlined />, label: t('history') },
    ...(isAdmin ? [
      { key: '/folders', icon: <FolderOutlined />, label: t('folders') },
      { key: '/users', icon: <TeamOutlined />, label: t('users') },
    ] : []),
  ];

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: t('profile'),
      onClick: () => navigate('/profile'),
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: t('logout'),
      danger: true,
      onClick: async () => {
        await logout();
        navigate('/login');
      },
    },
  ];

  const selectedKey = menuItems.find(item => {
    if (item.key === '/') return location.pathname === '/';
    return location.pathname.startsWith(item.key);
  })?.key || '/';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        trigger={null}
        width={220}
        style={{
          background: '#001529',
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
        }}
      >
        <div style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 16px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}>
          {collapsed ? (
            <Typography.Text style={{ color: '#fff', fontSize: 20, fontWeight: 700 }}>P</Typography.Text>
          ) : (
            <Space direction="vertical" size={0} style={{ textAlign: 'center' }}>
              <Typography.Text style={{ color: '#fff', fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>
                PLC Control
              </Typography.Text>
              <Typography.Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>
                Version Manager
              </Typography.Text>
            </Space>
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ marginTop: 8 }}
        />
      </Sider>

      <Layout style={{ marginLeft: collapsed ? 80 : 220, transition: 'margin 0.2s' }}>
        <Header style={{
          padding: '0 24px',
          background: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          position: 'sticky',
          top: 0,
          zIndex: 99,
        }}>
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            style={{ fontSize: 16 }}
          />

          <Space>
            <Space>
              <GlobalOutlined style={{ color: '#999' }} />
              <Switch
                checkedChildren="EN"
                unCheckedChildren="VI"
                checked={lang === 'en'}
                onChange={(checked) => switchLang(checked ? 'en' : 'vi')}
                size="small"
              />
            </Space>

            <Dropdown menu={{ items: userMenuItems }} trigger={['click']}>
              <Space style={{ cursor: 'pointer', padding: '0 8px' }}>
                <Avatar
                  src={user?.avatarUrl}
                  icon={!user?.avatarUrl && <UserOutlined />}
                  style={{ background: '#1677ff' }}
                />
                <span style={{ fontWeight: 500 }}>{user?.displayName}</span>
              </Space>
            </Dropdown>
          </Space>
        </Header>

        <Content style={{
          margin: '24px',
          minHeight: 'calc(100vh - 112px)',
        }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
