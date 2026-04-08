import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Card, Form, Select, Input, InputNumber, DatePicker, Button, Table, Tabs,
  Badge, notification, Tooltip, Space, Row, Col, Divider, Tag, Checkbox,
  Typography, Upload,
} from 'antd';
import {
  ReloadOutlined, DownloadOutlined, DeleteOutlined, PlayCircleOutlined,
  StopOutlined, DisconnectOutlined, ApiOutlined, InboxOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import { useLang } from '../../contexts/LangContext';
import { downloadReport, uploadTemplate, downloadReportFromTemplate } from '../../api/battery';

const { Title } = Typography;
const { Option } = Select;

const STATUS_COLORS = {
  'Waiting...': '#ffffff',
  'Testing...': '#00e5ff',
  'Done': '#69f0ae',
  'Remove': '#69f0ae',
  'Saving...': '#ffee58',
  'Stopped': '#9e9e9e',
  'Error': '#ef5350',
};

function getStatusColor(text) {
  if (!text) return '#ffffff';
  for (const [key, color] of Object.entries(STATUS_COLORS)) {
    if (text.includes(key)) return color;
  }
  return '#ffffff';
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export default function BatteryPage() {
  const { t } = useLang();

  // Connection state
  const [ports, setPorts] = useState([]);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Test state
  const [running, setRunning] = useState(false);

  // Form params
  const [port, setPort] = useState('');
  const [baudRate, setBaudRate] = useState(9600);
  const [simMode, setSimMode] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [testDate, setTestDate] = useState(dayjs());
  const [resistance, setResistance] = useState(0.1);
  const [ocvTime, setOcvTime] = useState(30);
  const [loadTime, setLoadTime] = useState(30);
  const [kCoeff, setKCoeff] = useState(1.0);

  // Display
  const [statusText, setStatusText] = useState('Waiting...');
  const [statusColor, setStatusColor] = useState('#ffffff');

  // Chart
  const [chartData, setChartData] = useState([]);
  const [autoScroll, setAutoScroll] = useState(true);

  // Results
  const [records, setRecords] = useState([]);

  // History tab
  const [activeTab, setActiveTab] = useState('results');

  // Excel report template
  const [templateName, setTemplateName] = useState(null);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);

  // WebSocket
  const wsRef = useRef(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef(null);
  const mountedRef = useRef(true);

  const buildParams = useCallback(() => ({
    order_id: orderId,
    date: testDate ? testDate.format('YYYY-MM') : dayjs().format('YYYY-MM'),
    resistance: parseFloat(resistance),
    ocv_time: parseFloat(ocvTime),
    load_time: parseFloat(loadTime),
    coeff: parseFloat(kCoeff),
  }), [orderId, testDate, resistance, ocvTime, loadTime, kCoeff]);

  const sendMsg = useCallback((msg) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const handleWsMessage = useCallback((event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'ports':
        setPorts(msg.ports || []);
        break;

      case 'connect_result':
        setConnecting(false);
        if (msg.ok) {
          setConnected(true);
          notification.success({ message: t('batteryConnectSuccess'), description: msg.message });
        } else {
          setConnected(false);
          notification.error({ message: t('batteryConnectFailed'), description: msg.message });
        }
        break;

      case 'disconnected':
        setConnected(false);
        setRunning(false);
        setStatusText('Waiting...');
        setStatusColor('#ffffff');
        break;

      case 'test_started':
        setRunning(true);
        setStatusText('Testing...');
        setStatusColor(getStatusColor('Testing...'));
        notification.info({ message: t('batteryTestStarted') });
        break;

      case 'test_stopped':
        setRunning(false);
        notification.info({ message: t('batteryTestStopped') });
        break;

      case 'reading':
        if (msg.time !== undefined && msg.voltage !== undefined) {
          setChartData((prev) => [...prev, [msg.time, msg.voltage]]);
        }
        break;

      case 'record':
        if (msg.data) {
          setRecords((prev) => {
            const idx = prev.findIndex((r) => r.id === msg.data.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = msg.data;
              return updated;
            }
            return [...prev, msg.data];
          });
        }
        break;

      case 'status':
        if (msg.data) {
          const text = msg.data.status_text || 'Waiting...';
          setStatusText(text);
          setStatusColor(getStatusColor(text));
          if (msg.data.records) setRecords(msg.data.records);
        }
        break;

      case 'session_cleared':
        setChartData([]);
        setRecords([]);
        notification.success({ message: t('batterySessionCleared') });
        break;

      case 'error':
        notification.error({ message: t('error'), description: msg.message });
        break;

      default:
        break;
    }
  }, [t]);

  const connectWs = useCallback(() => {
    if (!mountedRef.current) return;
    const token = localStorage.getItem('token') || '';
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${window.location.host}/ws/battery?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      retryCountRef.current = 0;
      // Request available ports immediately
      ws.send(JSON.stringify({ action: 'get_ports' }));
    };

    ws.onmessage = handleWsMessage;

    ws.onclose = (evt) => {
      if (!mountedRef.current) return;
      // If closed unexpectedly and we were connected/running, attempt reconnect
      if (evt.code !== 1000 && retryCountRef.current < MAX_RETRIES) {
        retryCountRef.current += 1;
        retryTimerRef.current = setTimeout(connectWs, RETRY_DELAY_MS);
      }
    };

    ws.onerror = () => {
      // error will be followed by close
    };
  }, [handleWsMessage]);

  useEffect(() => {
    mountedRef.current = true;
    connectWs();
    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close(1000, 'unmount');
      }
    };
  }, [connectWs]);

  // Refresh port list
  const handleRefreshPorts = () => {
    sendMsg({ action: 'get_ports' });
  };

  // Connect to device
  const handleConnect = () => {
    if (!simMode && !port) {
      notification.warning({ message: t('batterySelectPort') });
      return;
    }
    setConnecting(true);
    sendMsg({
      action: 'connect',
      payload: { port: simMode ? null : port, baud_rate: baudRate, simulation: simMode },
    });
  };

  // Disconnect
  const handleDisconnect = () => {
    sendMsg({ action: 'disconnect' });
  };

  // Start / stop test
  const handleStartStop = () => {
    if (running) {
      sendMsg({ action: 'stop' });
    } else {
      sendMsg({ action: 'start', payload: buildParams() });
    }
  };

  // Retest a specific record
  const handleRetest = (record) => {
    sendMsg({ action: 'start', payload: { ...buildParams(), retest_id: record.id } });
  };

  // Download Excel report
  const handleDownloadReport = async () => {
    notification.info({ message: t('batteryDownloading') });
    try {
      const response = await downloadReport();
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'battery_report.xlsx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      notification.success({ message: t('batteryDownloadSuccess') });
    } catch (e) {
      const status = e.response?.status;
      if (status === 404) {
        notification.warning({ message: t('batteryNoReport') });
      } else {
        notification.error({ message: t('batteryDownloadFailed'), description: e.message });
      }
    }
  };

  // Clear session
  const handleClearSession = () => {
    sendMsg({ action: 'clear_session' });
  };

  // Template upload handler
  const handleTemplateUpload = async ({ file, onSuccess, onError }) => {
    const formData = new FormData();
    formData.append('template', file);
    try {
      await uploadTemplate(formData);
      setTemplateName(file.name);
      notification.success({ message: t('batteryTemplateUploaded') });
      onSuccess();
    } catch (e) {
      notification.error({ message: t('batteryTemplateUploadFailed'), description: e.message });
      onError(e);
    }
  };

  // Download report from template
  const handleDownloadTemplateReport = async () => {
    setDownloadingTemplate(true);
    try {
      const response = await downloadReportFromTemplate(records);
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const date = testDate ? testDate.format('YYYY-MM') : dayjs().format('YYYY-MM');
      link.download = `battery_report_${orderId}_${date}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      notification.success({ message: t('batteryDownloadSuccess') });
    } catch (e) {
      const status = e.response?.status;
      if (status === 404) {
        notification.warning({ message: t('batteryTemplateNotFound') });
      } else {
        notification.error({ message: t('batteryDownloadFailed'), description: e.message });
      }
    } finally {
      setDownloadingTemplate(false);
    }
  };

  // ECharts option
  const chartOption = {
    animation: false,
    backgroundColor: 'transparent',
    grid: { top: 24, right: 24, bottom: 40, left: 56 },
    tooltip: { trigger: 'axis', formatter: (params) => params.map(p => `${p.marker}${p.seriesName}: ${p.value[1]?.toFixed(3)} V @ ${p.value[0]}s`).join('<br/>') },
    xAxis: {
      type: 'value',
      name: 's',
      nameLocation: 'end',
      axisLabel: { color: '#aaa' },
      axisLine: { lineStyle: { color: '#444' } },
      splitLine: { lineStyle: { color: '#2a2a2a' } },
    },
    yAxis: {
      type: 'value',
      name: 'V',
      nameLocation: 'end',
      axisLabel: { color: '#aaa' },
      axisLine: { lineStyle: { color: '#444' } },
      splitLine: { lineStyle: { color: '#2a2a2a' } },
    },
    dataZoom: autoScroll
      ? []
      : [{ type: 'inside' }, { type: 'slider', height: 20, bottom: 4 }],
    series: [
      {
        name: 'Voltage',
        type: 'line',
        data: chartData,
        symbol: 'none',
        lineStyle: { color: '#0091ea', width: 2 },
        areaStyle: { color: 'rgba(0,145,234,0.08)' },
        markArea: chartData.length > 0 && ocvTime > 0 ? {
          silent: true,
          data: [[
            { name: 'OCV', xAxis: 0, itemStyle: { color: 'rgba(255,238,88,0.08)' } },
            { xAxis: ocvTime },
          ], [
            { name: 'Load', xAxis: ocvTime, itemStyle: { color: 'rgba(0,229,255,0.06)' } },
            { xAxis: ocvTime + loadTime },
          ]],
        } : undefined,
      },
    ],
  };

  // Results table columns
  const columns = [
    { title: t('batteryId'), dataIndex: 'id', key: 'id', width: 60 },
    { title: t('batteryOcv'), dataIndex: 'ocv', key: 'ocv', width: 90, render: (v) => v != null ? v.toFixed(3) : '-' },
    { title: t('batteryCcv'), dataIndex: 'ccv', key: 'ccv', width: 90, render: (v) => v != null ? v.toFixed(3) : '-' },
    { title: t('batteryTime'), dataIndex: 'time', key: 'time', width: 80, render: (v) => v != null ? v.toFixed(1) : '-' },
    {
      title: t('actions'),
      key: 'actions',
      width: 100,
      render: (_, record) => (
        <Button size="small" onClick={() => handleRetest(record)} disabled={!connected || running}>
          {t('batteryRetest')}
        </Button>
      ),
    },
  ];

  const inputsDisabled = !connected;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <Title level={3} style={{ marginBottom: 4 }}>
          🔋 {t('batteryTest')}
        </Title>
      </div>

      {/* Connection + Parameters row */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {/* Connection Card */}
        <Col xs={24} md={12} lg={10}>
          <Card
            title={
              <Space>
                <ApiOutlined />
                {t('batteryConnection')}
                <Badge
                  status={connected ? 'success' : 'default'}
                  text={connected ? t('batteryConnected') : t('batteryNotConnected')}
                />
              </Space>
            }
            size="small"
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <Row gutter={8} align="middle">
                <Col flex="auto">
                  <Select
                    placeholder={t('batterySelectPort')}
                    value={port || undefined}
                    onChange={setPort}
                    style={{ width: '100%' }}
                    disabled={connected}
                  >
                    {ports.map((p) => (
                      <Option key={p} value={p}>{p}</Option>
                    ))}
                  </Select>
                </Col>
                <Col>
                  <Tooltip title={t('batteryRefreshPorts')}>
                    <Button icon={<ReloadOutlined />} onClick={handleRefreshPorts} disabled={connected} />
                  </Tooltip>
                </Col>
              </Row>

              <Row gutter={8}>
                <Col flex="auto">
                  <Select
                    value={baudRate}
                    onChange={setBaudRate}
                    style={{ width: '100%' }}
                    disabled={connected}
                  >
                    {[9600, 19200, 38400, 57600, 115200].map((b) => (
                      <Option key={b} value={b}>{b}</Option>
                    ))}
                  </Select>
                </Col>
                <Col>
                  <Checkbox
                    checked={simMode}
                    onChange={(e) => setSimMode(e.target.checked)}
                    disabled={connected}
                  >
                    {t('batterySimMode')}
                  </Checkbox>
                </Col>
              </Row>

              {!connected ? (
                <Button
                  type="primary"
                  icon={<ApiOutlined />}
                  onClick={handleConnect}
                  loading={connecting}
                  block
                >
                  {connecting ? t('batteryConnecting') : t('batteryConnect')}
                </Button>
              ) : (
                <Button
                  danger
                  icon={<DisconnectOutlined />}
                  onClick={handleDisconnect}
                  block
                >
                  {t('batteryDisconnect')}
                </Button>
              )}
            </Space>
          </Card>
        </Col>

        {/* Parameters Card */}
        <Col xs={24} md={12} lg={14}>
          <Card title={t('batteryParameters')} size="small">
            <Row gutter={[8, 8]}>
              <Col xs={24} sm={12}>
                <Form.Item label={t('batteryOrderId')} style={{ marginBottom: 0 }}>
                  <Input
                    value={orderId}
                    onChange={(e) => setOrderId(e.target.value)}
                    disabled={inputsDisabled}
                    placeholder="e.g. ORD-001"
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item label={t('batteryDate')} style={{ marginBottom: 0 }}>
                  <DatePicker
                    picker="month"
                    value={testDate}
                    onChange={setTestDate}
                    disabled={inputsDisabled}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
              <Col xs={12} sm={8}>
                <Form.Item label={t('batteryResistance')} style={{ marginBottom: 0 }}>
                  <InputNumber
                    value={resistance}
                    onChange={setResistance}
                    disabled={inputsDisabled}
                    min={0}
                    step={0.01}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
              <Col xs={12} sm={8}>
                <Form.Item label={t('batteryOcvTime')} style={{ marginBottom: 0 }}>
                  <InputNumber
                    value={ocvTime}
                    onChange={setOcvTime}
                    disabled={inputsDisabled}
                    min={1}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
              <Col xs={12} sm={8}>
                <Form.Item label={t('batteryLoadTime')} style={{ marginBottom: 0 }}>
                  <InputNumber
                    value={loadTime}
                    onChange={setLoadTime}
                    disabled={inputsDisabled}
                    min={1}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
              <Col xs={12} sm={8}>
                <Form.Item label={t('batteryKCoeff')} style={{ marginBottom: 0 }}>
                  <InputNumber
                    value={kCoeff}
                    onChange={setKCoeff}
                    disabled={inputsDisabled}
                    min={0}
                    step={0.01}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      {/* Status Bar */}
      <div
        style={{
          background: '#000',
          borderRadius: 8,
          padding: '12px 20px',
          marginBottom: 16,
          color: statusColor,
          fontSize: 18,
          fontWeight: 600,
          fontFamily: 'monospace',
          letterSpacing: 1,
          minHeight: 48,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <span>{t('batteryStatus')}:</span>
        <span>{statusText}</span>
      </div>

      {/* Excel Report Card */}
      <Card
        title={t('batteryExcelReport')}
        size="small"
        style={{ marginBottom: 16 }}
        collapsible
        defaultCollapsed
      >
        <Row gutter={16}>
          <Col xs={24} md={14}>
            <Upload.Dragger
              accept=".xlsx"
              showUploadList={false}
              customRequest={handleTemplateUpload}
              style={{ padding: '8px 16px' }}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">{t('batteryTemplateUpload')}</p>
              <p className="ant-upload-hint">{t('batteryTemplateUploadHint')}</p>
              {templateName && (
                <p style={{ color: '#52c41a', marginTop: 4 }}>
                  {t('batteryCurrentTemplate')}: <strong>{templateName}</strong>
                </p>
              )}
              {!templateName && (
                <p style={{ color: '#888', marginTop: 4 }}>{t('batteryNoTemplate')}</p>
              )}
            </Upload.Dragger>
          </Col>
          <Col xs={24} md={10} style={{ display: 'flex', alignItems: 'center' }}>
            <Button
              icon={<DownloadOutlined />}
              onClick={handleDownloadTemplateReport}
              disabled={records.length === 0}
              loading={downloadingTemplate}
              block
            >
              {t('batteryDownloadTemplateReport')}
            </Button>
          </Col>
        </Row>
      </Card>

      {/* Chart + Results */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {/* Chart */}
        <Col xs={24} lg={14}>
          <Card
            title={
              <Space>
                {t('batteryChart')}
                <Checkbox
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                >
                  {t('batteryAutoScroll')}
                </Checkbox>
              </Space>
            }
            size="small"
            bodyStyle={{ padding: 8, background: '#111', borderRadius: '0 0 8px 8px' }}
          >
            <ReactECharts
              option={chartOption}
              style={{ height: 280 }}
              notMerge={false}
              lazyUpdate={true}
              theme="dark"
            />
          </Card>
        </Col>

        {/* Results Table */}
        <Col xs={24} lg={10}>
          <Card size="small" style={{ height: '100%' }}>
            <Tabs
              activeKey={activeTab}
              onChange={setActiveTab}
              size="small"
              items={[
                {
                  key: 'results',
                  label: t('batteryResults'),
                  children: (
                    <Table
                      dataSource={records}
                      columns={columns}
                      rowKey="id"
                      size="small"
                      pagination={{ pageSize: 8, size: 'small' }}
                      locale={{ emptyText: t('batteryNoResults') }}
                      scroll={{ x: true }}
                    />
                  ),
                },
                {
                  key: 'history',
                  label: t('batteryHistory'),
                  children: (
                    <Table
                      dataSource={records}
                      columns={[
                        { title: t('batteryId'), dataIndex: 'id', key: 'id' },
                        { title: t('batteryOcv'), dataIndex: 'ocv', key: 'ocv', render: (v) => v != null ? v.toFixed(3) : '-' },
                        { title: t('batteryCcv'), dataIndex: 'ccv', key: 'ccv', render: (v) => v != null ? v.toFixed(3) : '-' },
                        {
                          title: t('status'),
                          dataIndex: 'status',
                          key: 'status',
                          render: (v) => v ? <Tag color="blue">{v}</Tag> : '-',
                        },
                      ]}
                      rowKey="id"
                      size="small"
                      pagination={{ pageSize: 8, size: 'small' }}
                      locale={{ emptyText: t('batteryNoResults') }}
                      scroll={{ x: true }}
                    />
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      {/* Action Buttons */}
      <Space wrap>
        <Button
          type="primary"
          size="large"
          icon={running ? <StopOutlined /> : <PlayCircleOutlined />}
          danger={running}
          disabled={!connected}
          onClick={handleStartStop}
        >
          {running ? t('batteryStop') : t('batteryStart')}
        </Button>

        <Divider type="vertical" />

        <Button
          icon={<DownloadOutlined />}
          onClick={handleDownloadReport}
          disabled={records.length === 0}
        >
          {t('batteryDownloadReport')}
        </Button>

        <Button
          icon={<DeleteOutlined />}
          onClick={handleClearSession}
          disabled={!connected || records.length === 0}
        >
          {t('batteryClearSession')}
        </Button>
      </Space>
    </div>
  );
}
