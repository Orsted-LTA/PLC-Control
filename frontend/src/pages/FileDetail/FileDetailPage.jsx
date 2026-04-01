import React, { useState, useEffect } from 'react';
import {
  Card, Typography, Tag, Button, Space, Modal, Upload, Form, Input,
  message, Popconfirm, Row, Col, Descriptions, Divider, Spin, Tabs,
  Tooltip, Badge, Alert,
} from 'antd';
import {
  ArrowLeftOutlined, UploadOutlined, DownloadOutlined, SwapOutlined,
  RollbackOutlined, InboxOutlined, TagOutlined, FolderOutlined,
  LockOutlined, UnlockOutlined, ExpandOutlined, ShrinkOutlined,
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import api from '../../api';
import { lockFile, unlockFile } from '../../api';
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
  const { canEdit, user, isAdmin } = useAuth();

  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedVersions, setSelectedVersions] = useState([]);
  const [diff, setDiff] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const [uploadModal, setUploadModal] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [fileList, setFileList] = useState([]);
  const [form] = Form.useForm();

  const [lockLoading, setLockLoading] = useState(false);
  const [lockModal, setLockModal] = useState(false);
  const [lockReason, setLockReason] = useState('');

  const [isDiffExpanded, setIsDiffExpanded] = useState(false);

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
        timeout: 0,
      });
      const disposition = res.headers['content-disposition'];
      let fileName = 'download';
      if (disposition) {
        const match = disposition.match(/filename\*?=(?:UTF-8'')?[\