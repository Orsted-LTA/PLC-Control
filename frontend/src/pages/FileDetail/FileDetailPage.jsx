import React, { useState, useEffect } from 'react';
import {
  Card, Typography, Tag, Button, Space, Modal, Upload, Form, Input,
  message, Popconfirm, Row, Col, Descriptions, Divider, Spin, Tabs,
  Tooltip, Badge,
} from 'antd';
import {
  ArrowLeftOutlined, UploadOutlined, DownloadOutlined, SwapOutlined,
  RollbackOutlined, InboxOutlined, TagOutlined, FolderOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import api from '../../api';
import { useLang } from '../../contexts/LangContext';
import { useAuth } from '../../contexts/AuthContext';
import CommitGraph from '../../components/CommitGraph/CommitGraph';
import FileDiff from '../../components/FileDiff/FileDiff';

const { Title, Text } = Typography;
const { Dragger } = Upload;

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '-';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default function FileDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useLang();
  const { canEdit } = useAuth();

  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedVersions, setSelectedVersions] = useState([]);
  const [diff, setDiff] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const [uploadModal, setUploadModal] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [fileList, setFileList] = useState([]);
  const [form] = Form.useForm();

  const fetchFile = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/files/${id}`);
      setFile(res.data);
    } catch {
      message.error(t('error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchFile(); }, [id]);

  const handleSelectVersion = (version) => {
    setSelectedVersions(prev => {
      if (prev.find(v => v.id === version.id)) {
        return prev.filter(v => v.id !== version.id);
      }
      if (prev.length >= 2) {
        return [prev[1], version];
      }
      return [...prev, version];
    });
  };

  const handleDiff = async () => {
    if (selectedVersions.length < 2) {
      message.warning(t('selectVersionsToCompare'));
      return;
    }
    const [from, to] = selectedVersions.sort((a, b) => a.versionNumber - b.versionNumber);
    setDiffLoading(true);
    setDiff(null);
    try {
      const res = await api.get('/versions/diff', {
        params: { fromId: from.id, toId: to.id },
      });
      setDiff(res.data);
    } catch {
      message.error(t('error'));
    } finally {
      setDiffLoading(false);
    }
  };

  const handleDownload = async (versionId) => {
    try {
      const res = await api.get(`/versions/${versionId}/download`, {
        responseType: 'blob',
      });
      const disposition = res.headers['content-disposition'];
      let fileName = 'download';
      if (disposition) {
        const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)/i);
        if (match) fileName = decodeURIComponent(match[1]);
      }
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      message.error(err.response?.data?.message || t('error'));
    }
  };

  const handleRestore = async (versionId, versionNumber) => {
    try {
      await api.post(`/versions/${versionId}/restore`);
      message.success(t('restoreSuccess'));
      fetchFile();
    } catch (err) {
      message.error(err.response?.data?.message || t('error'));
    }
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
      if (file.folderId) {
        formData.append('folderId', file.folderId);
      } else {
        formData.append('filePath', file.path);
      }

      await api.post('/files', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      message.success(t('fileUploaded'));
      setUploadModal(false);
      form.resetFields();
      setFileList([]);
      fetchFile();
    } catch (err) {
      message.error(err.response?.data?.message || t('error'));
    } finally {
      setUploadLoading(false);
    }
  };

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 100 }}><Spin size="large" /></div>;
  }

  if (!file) return null;

  const latestVersion = file.versions[0];

  const tabItems = [
    {
      key: 'graph',
      label: t('versionHistory'),
      children: (
        <div style={{ maxHeight: 500, overflow: 'auto' }}>
          <CommitGraph
            versions={file.versions}
            onSelectVersion={handleSelectVersion}
            selectedVersionIds={selectedVersions.map(v => v.id)}
          />
        </div>
      ),
    },
    {
      key: 'diff',
      label: (
        <span>
          {t('diffView')}
          {selectedVersions.length === 2 && <Badge count={2} size="small" style={{ marginLeft: 6 }} />}
        </span>
      ),
      children: (
        <div>
          {selectedVersions.length < 2 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#8c8c8c' }}>
              <SwapOutlined style={{ fontSize: 32, marginBottom: 8, display: 'block' }} />
              {t('selectVersionsToCompare')}
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
                <Text>
                  Comparing:
                  {' '}
                  <Tag color="blue">v{Math.min(...selectedVersions.map(v => v.versionNumber))}</Tag>
                  →
                  <Tag color="green">v{Math.max(...selectedVersions.map(v => v.versionNumber))}</Tag>
                </Text>
                <Button
                  type="primary"
                  size="small"
                  icon={<SwapOutlined />}
                  loading={diffLoading}
                  onClick={handleDiff}
                >
                  {t('compare')}
                </Button>
              </div>
              {diff && (
                <FileDiff
                  diff={diff.diff}
                  isBinary={diff.isBinary}
                  isOfficeExtracted={diff.isOfficeExtracted}
                  fromVersion={diff.from}
                  toVersion={diff.to}
                />
              )}
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/files')}>
          {t('back')}
        </Button>
      </div>

      {/* File info */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <Title level={3} style={{ margin: 0 }}>{file.name}</Title>
            {file.folderPath ? (
              <Text type="secondary">
                <FolderOutlined style={{ marginRight: 4 }} />
                {file.folderPath} / {file.name}
              </Text>
            ) : (
              <Text type="secondary">{file.path}</Text>
            )}
            {file.description && (
              <div style={{ marginTop: 8 }}>
                <Text>{file.description}</Text>
              </div>
            )}
          </div>
          {canEdit && (
            <Button
              type="primary"
              icon={<UploadOutlined />}
              onClick={() => setUploadModal(true)}
            >
              {t('uploadNewVersion')}
            </Button>
          )}
        </div>

        <Divider style={{ margin: '16px 0' }} />

        <Row gutter={16}>
          <Col span={6}>
            <Text type="secondary">{t('versions')}</Text>
            <div><Tag color="blue" icon={<TagOutlined />}>{file.versions.length} versions</Tag></div>
          </Col>
          <Col span={6}>
            <Text type="secondary">{t('fileSize')}</Text>
            <div><Text strong>{formatBytes(latestVersion?.size)}</Text></div>
          </Col>
          <Col span={6}>
            <Text type="secondary">{t('createdBy')}</Text>
            <div><Text>{file.createdBy}</Text></div>
          </Col>
          <Col span={6}>
            <Text type="secondary">{t('updatedAt')}</Text>
            <div><Text>{dayjs(file.updatedAt).format('YYYY-MM-DD HH:mm')}</Text></div>
          </Col>
        </Row>

        {latestVersion && (
          <>
            <Divider style={{ margin: '16px 0' }} />
            <Row gutter={16}>
              <Col span={24}>
                <Text type="secondary">{t('checksum')}</Text>
                <div>
                  <Text code style={{ fontSize: 12 }}>{latestVersion.checksum}</Text>
                </div>
              </Col>
            </Row>
          </>
        )}
      </Card>

      {/* Version tabs */}
      <Row gutter={16}>
        <Col xs={24} lg={14}>
          <Card>
            <Tabs items={tabItems} />
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title={t('versionHistory')} style={{ maxHeight: 600, overflow: 'auto' }}>
            {file.versions.map((v) => (
              <div
                key={v.id}
                style={{
                  padding: '12px 0',
                  borderBottom: '1px solid #f0f0f0',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Space>
                    <Tag color="blue">v{v.versionNumber}</Tag>
                    <Tag color={v.isBinary ? 'orange' : 'cyan'}>
                      {v.isBinary ? t('binary') : t('text')}
                    </Tag>
                  </Space>
                  <Space size={4}>
                    <Tooltip title={t('download')}>
                      <Button
                        size="small"
                        type="text"
                        icon={<DownloadOutlined />}
                        onClick={() => handleDownload(v.id)}
                      />
                    </Tooltip>
                    {canEdit && v.versionNumber !== file.versions[0]?.versionNumber && (
                      <Popconfirm
                        title={t('restoreConfirm', { version: v.versionNumber })}
                        onConfirm={() => handleRestore(v.id, v.versionNumber)}
                        okText={t('yes')}
                        cancelText={t('no')}
                      >
                        <Tooltip title={t('restoreVersion')}>
                          <Button size="small" type="text" icon={<RollbackOutlined />} />
                        </Tooltip>
                      </Popconfirm>
                    )}
                  </Space>
                </div>
                <div style={{ marginTop: 4 }}>
                  <Text style={{ fontSize: 13 }}>
                    {v.commitMessage || `Version ${v.versionNumber}`}
                  </Text>
                </div>
                <div style={{ marginTop: 4, display: 'flex', gap: 16 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{v.uploadedBy}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {dayjs(v.createdAt).format('YYYY-MM-DD HH:mm')}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{formatBytes(v.size)}</Text>
                </div>
              </div>
            ))}
          </Card>
        </Col>
      </Row>

      {/* Upload new version modal */}
      <Modal
        title={t('uploadNewVersion')}
        open={uploadModal}
        onCancel={() => { setUploadModal(false); form.resetFields(); setFileList([]); }}
        footer={null}
        width={520}
      >
        <Form form={form} layout="vertical" onFinish={handleUpload}>
          <Form.Item label={t('selectFile')} required>
            <Dragger
              fileList={fileList}
              beforeUpload={() => false}
              onChange={({ fileList: fl }) => setFileList(fl.slice(-1))}
              maxCount={1}
            >
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">{t('uploadHint')}</p>
            </Dragger>
          </Form.Item>

          <Form.Item name="commitMessage" label={`${t('commitMessage')} ${t('optional')}`}>
            <Input.TextArea rows={3} placeholder={t('commitMessagePlaceholder')} />
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
