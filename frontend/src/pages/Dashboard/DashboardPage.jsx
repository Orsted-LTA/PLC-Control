import React, { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Table, Tag, Typography, Spin, Space, Avatar } from 'antd';
import {
  FileOutlined, HistoryOutlined, TeamOutlined,
  DatabaseOutlined, UserOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import api from '../../api';
import { useLang } from '../../contexts/LangContext';

const { Title, Text } = Typography;

const ACTION_COLORS = {
  add_file: 'success',
  update_file: 'processing',
  delete_file: 'error',
  restore_version: 'warning',
  create_user: 'success',
  login: 'default',
  logout: 'default',
};

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const { t } = useLang();
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/files/stats')
      .then(res => setData(res.data))
      .finally(() => setLoading(false));
  }, []);

  const actionLabel = (action) => {
    const map = {
      add_file: t('actionAddFile'),
      update_file: t('actionUpdateFile'),
      delete_file: t('actionDeleteFile'),
      restore_version: t('actionRestoreVersion'),
      create_user: t('actionCreateUser'),
      update_user: t('actionUpdateUser'),
      login: t('actionLogin'),
      logout: t('actionLogout'),
    };
    return map[action] || action;
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  const statCards = [
    {
      title: t('totalFiles'),
      value: data?.stats?.totalFiles || 0,
      icon: <FileOutlined />,
      color: '#1677ff',
      onClick: () => navigate('/files'),
    },
    {
      title: t('totalVersions'),
      value: data?.stats?.totalVersions || 0,
      icon: <HistoryOutlined />,
      color: '#52c41a',
    },
    {
      title: t('totalUsers'),
      value: data?.stats?.totalUsers || 0,
      icon: <TeamOutlined />,
      color: '#fa8c16',
      onClick: () => navigate('/users'),
    },
    {
      title: t('totalStorage'),
      value: formatBytes(data?.stats?.totalSize),
      icon: <DatabaseOutlined />,
      color: '#722ed1',
      isString: true,
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 24 }}>{t('dashboard')}</Title>

      {/* Stat cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {statCards.map((card) => (
          <Col key={card.title} xs={24} sm={12} xl={6}>
            <Card
              hoverable={!!card.onClick}
              onClick={card.onClick}
              style={{ cursor: card.onClick ? 'pointer' : 'default' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: `${card.color}1a`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 22,
                  color: card.color,
                }}>
                  {card.icon}
                </div>
                <div>
                  <Text type="secondary" style={{ fontSize: 13 }}>{card.title}</Text>
                  <div style={{ fontSize: 24, fontWeight: 700, color: card.color, lineHeight: 1.2 }}>
                    {card.isString ? card.value : card.value.toLocaleString()}
                  </div>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Recent Activity */}
      <Card title={t('recentActivity')}>
        <Table
          dataSource={data?.recentActivity || []}
          rowKey="id"
          pagination={false}
          size="small"
          columns={[
            {
              title: t('user'),
              dataIndex: 'userName',
              render: (name) => (
                <Space>
                  <Avatar size={24} icon={<UserOutlined />} style={{ background: '#1677ff' }} />
                  <Text>{name}</Text>
                </Space>
              ),
            },
            {
              title: t('action'),
              dataIndex: 'action',
              render: (action) => (
                <Tag color={ACTION_COLORS[action] || 'default'}>
                  {actionLabel(action)}
                </Tag>
              ),
            },
            {
              title: t('entity'),
              dataIndex: 'entityName',
            },
            {
              title: t('timestamp'),
              dataIndex: 'createdAt',
              render: (v) => dayjs(v).format('YYYY-MM-DD HH:mm'),
            },
          ]}
        />
      </Card>
    </div>
  );
}
