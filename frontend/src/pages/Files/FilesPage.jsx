import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Space, Input, Typography, Tag, Tooltip,
  Modal, Form, Upload, Select, message, Popconfirm, Card, Breadcrumb,
} from 'antd';
import {
  UploadOutlined, PlusOutlined, SearchOutlined,
  DeleteOutlined, EyeOutlined, InboxOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import api from '../../api';
import { useLang } from '../../contexts/LangContext';
import { useAuth } from '../../contexts/AuthContext';

const { Title, Text } = Typography;
const { Dragger } = Upload;

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '-';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default function FilesPage() {
  const [files, setFiles] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [uploadModal, setUploadModal] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [form] = Form.useForm();
  const [fileList, setFileList] = useState([]);

  const { t } = useLang();
  const { canEdit, isAdmin } = useAuth();
  const navigate = useNavigate();

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20 };
      if (search) params.search = search;
      const res = await api.get('/files', { params });
      setFiles(res.data.data);
      setTotal(res.data.total);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const handleSearch = (value) => {
    setSearch(value);
    setPage(1);
  };

  const handleUpload = async (values) => {
    if (!fileList.length) {
      message.error(t('selectFile'));
      return;
    }
    setUploadLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', fileList[0].originFileObj);
      if (values.commitMessage) formData.append('commitMessage', values.commitMessage);
      if (values.description) formData.append('description', values.description);
      if (values.filePath) formData.append('filePath', values.filePath);

      await api.post('/files', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      message.success(t('fileUploaded'));
      setUploadModal(false);
      form.resetFields();
      setFileList([]);
      fetchFiles();
    } catch (err) {
      message.error(err.response?.data?.message || t('error'));
    } finally {
      setUploadLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/files/${id}`);
      message.success(t('fileDeleted'));
      fetchFiles();
    } catch (err) {
      message.error(err.response?.data?.message || t('error'));
    }
  };

  const columns = [
    {
      title: t('fileName'),
      dataIndex: 'name',
      render: (name, record) => (
        <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/files/${record.id}`)}>
          {name}
        </Button>
      ),
    },
    {
      title: t('filePath'),
      dataIndex: 'path',
      render: (p) => <Text type="secondary">{p}</Text>,
    },
    {
      title: t('versions'),
      dataIndex: 'versionCount',
      width: 90,
      render: (v) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: t('fileSize'),
      dataIndex: 'currentSize',
      width: 100,
      render: formatBytes,
    },
    {
      title: t('updatedAt'),
      dataIndex: 'lastModified',
      width: 160,
      render: (v) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: t('createdBy'),
      dataIndex: 'createdBy',
      width: 120,
    },
    {
      title: t('actions'),
      width: 100,
      render: (_, record) => (
        <Space>
          <Tooltip title={t('viewDetails')}>
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              onClick={() => navigate(`/files/${record.id}`)}
            />
          </Tooltip>
          {(canEdit || isAdmin) && (
            <Popconfirm
              title={t('deleteFileConfirm')}
              onConfirm={() => handleDelete(record.id)}
              okText={t('yes')}
              cancelText={t('no')}
            >
              <Tooltip title={t('deleteFile')}>
                <Button type="text" size="small" icon={<DeleteOutlined />} danger />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>{t('fileList')}</Title>
        {canEdit && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setUploadModal(true)}
          >
            {t('uploadFile')}
          </Button>
        )}
      </div>

      <Card>
        <div style={{ marginBottom: 16 }}>
          <Input.Search
            placeholder={t('search')}
            allowClear
            onSearch={handleSearch}
            style={{ maxWidth: 400 }}
            prefix={<SearchOutlined />}
          />
        </div>

        <Table
          columns={columns}
          dataSource={files}
          rowKey="id"
          loading={loading}
          pagination={{
            current: page,
            total,
            pageSize: 20,
            onChange: (p) => setPage(p),
            showTotal: (t) => `${t} files`,
          }}
          size="middle"
        />
      </Card>

      {/* Upload Modal */}
      <Modal
        title={t('uploadFile')}
        open={uploadModal}
        onCancel={() => { setUploadModal(false); form.resetFields(); setFileList([]); }}
        footer={null}
        width={560}
      >
        <Form form={form} layout="vertical" onFinish={handleUpload}>
          <Form.Item label={t('selectFile')} required>
            <Dragger
              fileList={fileList}
              beforeUpload={() => false}
              onChange={({ fileList: fl }) => setFileList(fl.slice(-1))}
              maxCount={1}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">{t('uploadHint')}</p>
              <p className="ant-upload-hint">{t('uploadHint2')}</p>
            </Dragger>
          </Form.Item>

          <Form.Item name="filePath" label={t('filePath')}>
            <Input placeholder={t('filePathPlaceholder')} />
          </Form.Item>

          <Form.Item name="description" label={`${t('description')} ${t('optional')}`}>
            <Input.TextArea rows={2} placeholder={t('descriptionPlaceholder')} />
          </Form.Item>

          <Form.Item name="commitMessage" label={`${t('commitMessage')} ${t('optional')}`}>
            <Input.TextArea rows={2} placeholder={t('commitMessagePlaceholder')} />
          </Form.Item>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => { setUploadModal(false); form.resetFields(); setFileList([]); }}>
              {t('cancel')}
            </Button>
            <Button type="primary" htmlType="submit" loading={uploadLoading} icon={<UploadOutlined />}>
              {t('upload')}
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
