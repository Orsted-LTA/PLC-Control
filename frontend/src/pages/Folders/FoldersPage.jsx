import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Button, Typography, Space, Row, Col, List, Tag,
  Modal, Form, Input, message, Popconfirm, Tooltip, Empty,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, FolderOutlined,
  DesktopOutlined,
} from '@ant-design/icons';
import { useLang } from '../../contexts/LangContext';
import { getFolders, createFolder, updateFolder, deleteFolder } from '../../api';

const { Title, Text } = Typography;

export default function FoldersPage() {
  const { t } = useLang();
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLine, setSelectedLine] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState(null); // 'line' | 'machine' | 'editLine' | 'editMachine'
  const [editTarget, setEditTarget] = useState(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const fetchFolders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getFolders();
      setLines(res.data.lines);
      if (selectedLine) {
        const updated = res.data.lines.find(l => l.id === selectedLine.id);
        setSelectedLine(updated || null);
      }
    } catch {
      message.error(t('error'));
    } finally {
      setLoading(false);
    }
  }, [selectedLine?.id]);

  useEffect(() => { fetchFolders(); }, []);

  const openAddLine = () => {
    setModalType('line');
    setEditTarget(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openAddMachine = () => {
    setModalType('machine');
    setEditTarget(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (folder, type) => {
    setModalType(type === 'line' ? 'editLine' : 'editMachine');
    setEditTarget(folder);
    form.setFieldsValue({ name: folder.name, description: folder.description });
    setModalOpen(true);
  };

  const handleSave = async (values) => {
    setSaving(true);
    try {
      if (modalType === 'line') {
        await createFolder({ name: values.name, type: 'line', description: values.description });
        message.success(t('folderCreated'));
      } else if (modalType === 'machine') {
        await createFolder({ name: values.name, type: 'machine', parentId: selectedLine.id, description: values.description });
        message.success(t('folderCreated'));
      } else if (modalType === 'editLine' || modalType === 'editMachine') {
        await updateFolder(editTarget.id, { name: values.name, description: values.description });
        message.success(t('folderUpdated'));
      }
      setModalOpen(false);
      form.resetFields();
      await fetchFolders();
    } catch (err) {
      message.error(err.response?.data?.message || t('error'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (folder) => {
    try {
      await deleteFolder(folder.id);
      message.success(t('folderDeleted'));
      if (selectedLine?.id === folder.id) setSelectedLine(null);
      await fetchFolders();
    } catch (err) {
      message.error(err.response?.data?.message || t('folderHasFiles'));
    }
  };

  const modalTitle = {
    line: t('addLine'),
    machine: t('addMachine'),
    editLine: t('edit') + ' ' + t('line'),
    editMachine: t('edit') + ' ' + t('machine'),
  }[modalType];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 24 }}>{t('folders')}</Title>
      <Row gutter={16}>
        {/* Lines column */}
        <Col xs={24} md={10}>
          <Card
            title={
              <Space>
                <FolderOutlined />
                <span>{t('lines')}</span>
              </Space>
            }
            extra={
              <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openAddLine}>
                {t('addLine')}
              </Button>
            }
            loading={loading}
          >
            {lines.length === 0 ? (
              <Empty description={t('noFiles')} />
            ) : (
              <List
                dataSource={lines}
                renderItem={(line) => (
                  <List.Item
                    key={line.id}
                    style={{
                      cursor: 'pointer',
                      background: selectedLine?.id === line.id ? '#e6f4ff' : undefined,
                      borderRadius: 6,
                      padding: '8px 12px',
                    }}
                    onClick={() => setSelectedLine(line)}
                    actions={[
                      <Tooltip title={t('edit')} key="edit">
                        <Button
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          onClick={(e) => { e.stopPropagation(); openEdit(line, 'line'); }}
                        />
                      </Tooltip>,
                      <Popconfirm
                        key="delete"
                        title={t('deleteFileConfirm')}
                        onConfirm={(e) => { e?.stopPropagation(); handleDelete(line); }}
                        okText={t('yes')}
                        cancelText={t('no')}
                      >
                        <Tooltip title={t('delete')}>
                          <Button
                            type="text"
                            size="small"
                            icon={<DeleteOutlined />}
                            danger
                            onClick={(e) => e.stopPropagation()}
                          />
                        </Tooltip>
                      </Popconfirm>,
                    ]}
                  >
                    <List.Item.Meta
                      title={<Text strong>{line.name}</Text>}
                      description={
                        <Space size={4}>
                          <Tag color="blue">{line.machines?.length || 0} {t('machines')}</Tag>
                          <Tag color="cyan">{line.fileCount} files</Tag>
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        {/* Machines column */}
        <Col xs={24} md={14}>
          <Card
            title={
              <Space>
                <DesktopOutlined />
                <span>
                  {selectedLine ? `${t('machines')} — ${selectedLine.name}` : t('machines')}
                </span>
              </Space>
            }
            extra={
              selectedLine && (
                <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openAddMachine}>
                  {t('addMachine')}
                </Button>
              )
            }
          >
            {!selectedLine ? (
              <Empty description={t('selectLine')} />
            ) : (selectedLine.machines || []).length === 0 ? (
              <Empty description={t('none')} />
            ) : (
              <List
                dataSource={selectedLine.machines}
                renderItem={(machine) => (
                  <List.Item
                    key={machine.id}
                    actions={[
                      <Tooltip title={t('edit')} key="edit">
                        <Button
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => openEdit(machine, 'machine')}
                        />
                      </Tooltip>,
                      <Popconfirm
                        key="delete"
                        title={t('deleteFileConfirm')}
                        onConfirm={() => handleDelete(machine)}
                        okText={t('yes')}
                        cancelText={t('no')}
                      >
                        <Tooltip title={t('delete')}>
                          <Button type="text" size="small" icon={<DeleteOutlined />} danger />
                        </Tooltip>
                      </Popconfirm>,
                    ]}
                  >
                    <List.Item.Meta
                      title={<Text>{machine.name}</Text>}
                      description={
                        <Space size={4}>
                          <Tag color="cyan">{machine.fileCount} files</Tag>
                          {machine.description && <Text type="secondary">{machine.description}</Text>}
                        </Space>
                      }
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
      </Row>

      {/* Add/Edit Modal */}
      <Modal
        title={modalTitle}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); form.resetFields(); }}
        footer={null}
        width={400}
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            name="name"
            label={t('folderName')}
            rules={[{ required: true, message: t('folderName') + ' ' + t('error') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="description" label={`${t('description')} ${t('optional')}`}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => { setModalOpen(false); form.resetFields(); }}>{t('cancel')}</Button>
            <Button type="primary" htmlType="submit" loading={saving}>{t('save')}</Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
