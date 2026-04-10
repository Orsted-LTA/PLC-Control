import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Card, Form, Select, Input, InputNumber, DatePicker, Button, Table, Tabs,
  Badge, notification, Tooltip, Space, Row, Col, Divider, Tag, Checkbox,
  Typography, Upload, Collapse, Modal, Popover,
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
const OCV_TOLERANCE = 0.003;
const CCV_TOLERANCE = 0.010;

function parseStandard(str) {
  if (!str || !str.trim()) return null;
  const cleaned = str.replace(/\+\/-/g, '±').replace(/\s/g, '');
  const matchFull = cleaned.match(/^([0-9.]+)±([0-9.]+)$/);
  if (matchFull) {
    return { center: parseFloat(matchFull[1]), tolerance: parseFloat(matchFull[2]) };
  }
  const matchSimple = cleaned.match(/^([0-9.]+)$/);
  if (matchSimple) {
    return { center: parseFloat(matchSimple[1]), tolerance: 0 };
  }
  return null;
}

function getInitialSession() {
  try {
    return JSON.parse(localStorage.getItem('battery_session') || '{}');
  } catch {
    return {};
  }
}

function RowWithPopover({ record, readingsByBattery, buildMiniChartOption, ...rowProps }) {
  const hasReadings = record && readingsByBattery && (readingsByBattery[record.id] || []).length > 0;
  if (!hasReadings) {
    return <tr {...rowProps} />;
  }
  const popoverContent = (
    <div style={{ width: 900, background: '#1a1a1a', borderRadius: 6, padding: 4 }}>
      <ReactECharts
        option={buildMiniChartOption(record.id)}
        style={{ height: 450, width: 900 }}
        notMerge
        theme="dark"
      />
    </div>
  );
  return (
    <Popover
      content={popoverContent}
      overlayInnerStyle={{ background: '#1a1a1a', padding: 0 }}
      overlayStyle={{ maxWidth: 940 }}
      placement="left"
      mouseEnterDelay={0.3}
    >
      <tr {...rowProps} />
    </Popover>
  );
}

export default function BatteryPage() {
  const { t, lang } = useLang();

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
  const [orderId, setOrderId] = useState(() => getInitialSession().orderId || '');
  const [testDate, setTestDate] = useState(() => {
    const saved = getInitialSession();
    return saved.testDate ? dayjs(saved.testDate) : dayjs();
  });
  const [resistance, setResistance] = useState(0.1);
  const [ocvTime, setOcvTime] = useState(30);
  const [loadTime, setLoadTime] = useState(30);
  const [kCoeff, setKCoeff] = useState(1.0);
  const [batteryType, setBatteryType] = useState(() => getInitialSession().batteryType || 'LR6');
  const [productLine, setProductLine] = useState(() => getInitialSession().productLine || 'UD+');
  const [ocvCenter, setOcvCenter] = useState(() => getInitialSession().ocvCenter ?? null);
  const [ccvCenter, setCcvCenter] = useState(() => getInitialSession().ccvCenter ?? null);

  // Display
  const [statusText, setStatusText] = useState('Waiting...');
  const [statusColor, setStatusColor] = useState('#ffffff');

  // Chart
  const [chartData, setChartData] = useState(() => getInitialSession().chartData || []);
  const [chartDataOCV, setChartDataOCV] = useState(() => getInitialSession().chartDataOCV || []);
  const [chartDataCCV, setChartDataCCV] = useState(() => getInitialSession().chartDataCCV || []);
  const [autoScroll, setAutoScroll] = useState(true);

  // Results
  const [records, setRecords] = useState(() => getInitialSession().records || []);

  // Readings grouped by battery id for mini chart popover
  const [readingsByBattery, setReadingsByBattery] = useState({});

  // History tab — persistent across reloads via localStorage
  const [historyRecords, setHistoryRecords] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('battery_history') || '[]');
    } catch {
      return [];
    }
  });
  const [activeTab, setActiveTab] = useState('results');

  // Resume session modal
  const [resumeModalVisible, setResumeModalVisible] = useState(false);
  const [savedSessionInfo, setSavedSessionInfo] = useState(null);

  // Excel report template
  const [templateName, setTemplateName] = useState(null);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);

  // WebSocket
  const wsRef = useRef(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef(null);
  const mountedRef = useRef(true);
  const pendingNewSessionRef = useRef(false);
  const orderIdRef = useRef(orderId);
  useEffect(() => { orderIdRef.current = orderId; }, [orderId]);

  const buildParams = useCallback(() => ({
    order_id: orderId,
    date: testDate ? testDate.format('YYYY-MM') : dayjs().format('YYYY-MM'),
    resistance: parseFloat(resistance),
    ocv_time: parseFloat(ocvTime),
    load_time: parseFloat(loadTime),
    coeff: parseFloat(kCoeff),
    battery_type: batteryType,
    product_line: productLine,
    ocv_standard: ocvCenter,
    ccv_standard: ccvCenter,
  }), [orderId, testDate, resistance, ocvTime, loadTime, kCoeff, batteryType, productLine, ocvCenter, ccvCenter]);

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
        setStatusText('Stopped');
        setStatusColor(getStatusColor('Stopped'));
        notification.info({ message: t('batteryTestStopped') });
        break;

      case 'reading':
        if (msg.elapsed !== undefined && msg.voltage !== undefined) {
          setChartData((prev) => [...prev, [msg.elapsed, msg.voltage]]);
          if (msg.phase === 'ocv') {
            setChartDataOCV((prev) => [...prev, [msg.elapsed, msg.voltage]]);
          } else if (msg.phase === 'ccv') {
            setChartDataCCV((prev) => [...prev, [msg.elapsed, msg.voltage]]);
          }
          if (msg.battery_id !== undefined) {
            setReadingsByBattery((prev) => {
              const id = msg.battery_id;
              const list = prev[id] || [];
              return { ...prev, [id]: [...list, { t: msg.elapsed, v: msg.voltage, phase: msg.phase }] };
            });
          }
        }
        break;

      case 'record':
        if (msg.record) {
          setRecords((prev) => {
            const idx = prev.findIndex((r) => r.id === msg.record.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = msg.record;
              return updated;
            }
            return [...prev, msg.record];
          });
          setHistoryRecords((prev) => {
            const localeMap = { vi: 'vi-VN', en: 'en-US', zh: 'zh-CN' };
            const dateLocale = localeMap[lang] || lang;
            const entry = { ...msg.record, _session: new Date().toLocaleDateString(dateLocale), _orderId: orderIdRef.current };
            const next = [...prev, entry];
            try { localStorage.setItem('battery_history', JSON.stringify(next.slice(-500))); } catch {}
            return next.slice(-500);
          });
        }
        break;

      case 'status':
        if (msg.text) {
          setStatusText(msg.text);
          setStatusColor(getStatusColor(msg.text));
        } else if (msg.data) {
          const text = msg.data.status_text || 'Waiting...';
          setStatusText(text);
          setStatusColor(getStatusColor(text));
          if (msg.data.records) setRecords(msg.data.records);
        }
        break;

      case 'session_cleared':
        setChartData([]);
        setChartDataOCV([]);
        setChartDataCCV([]);
        setRecords([]);
        setReadingsByBattery({});
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
    const token = localStorage.getItem('accessToken') || '';
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${window.location.host}/ws/battery?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      retryCountRef.current = 0;
      // Request available ports immediately
      ws.send(JSON.stringify({ action: 'get_ports' }));
      if (pendingNewSessionRef.current) {
        try {
          ws.send(JSON.stringify({ action: 'clear_session' }));
          pendingNewSessionRef.current = false;
        } catch {
          // flag remains true; will retry on next connection
        }
      }
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
    localStorage.removeItem('battery_session');
    setReadingsByBattery({});
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
        let errMsg = e.message;
        if (e.response?.data instanceof Blob) {
          try {
            const text = await e.response.data.text();
            const parsed = JSON.parse(text);
            errMsg = parsed.error || parsed.detail || errMsg;
          } catch (_parseErr) { /* blob is not JSON, keep original message */ }
        }
        notification.error({ message: t('batteryDownloadFailed'), description: errMsg });
      }
    } finally {
      setDownloadingTemplate(false);
    }
  };

  // ECharts option
  const chartOption = {
    animation: false,
    backgroundColor: 'transparent',
    grid: { top: 36, right: 24, bottom: 40, left: 56 },
    legend: {
      top: 4,
      textStyle: { color: '#aaa', fontSize: 12 },
    },
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
      scale: true,
    },
    dataZoom: autoScroll
      ? [{ type: 'inside', filterMode: 'none' }]
      : [{ type: 'inside' }, { type: 'slider', height: 20, bottom: 4 }],
    series: [
      {
        name: 'OCV',
        type: 'line',
        data: chartDataOCV,
        symbol: 'none',
        lineStyle: { color: '#ffee58', width: 2 },
        markArea: (chartDataOCV.length > 0 || chartDataCCV.length > 0) && ocvTime > 0 ? {
          silent: true,
          data: [[
            { name: 'OCV', xAxis: 0, itemStyle: { color: 'rgba(255,238,88,0.08)' } },
            { xAxis: ocvTime },
          ]],
        } : undefined,
      },
      {
        name: 'CCV',
        type: 'line',
        data: chartDataOCV.length > 0 && chartDataCCV.length > 0
          ? [chartDataOCV[chartDataOCV.length - 1], ...chartDataCCV]
          : chartDataCCV,
        symbol: 'none',
        lineStyle: { color: '#0091ea', width: 2 },
        areaStyle: { color: 'rgba(0,145,234,0.08)' },
        markArea: (chartDataOCV.length > 0 || chartDataCCV.length > 0) && ocvTime > 0 ? {
          silent: true,
          data: [[
            { name: 'Load', xAxis: ocvTime, itemStyle: { color: 'rgba(0,229,255,0.06)' } },
            { xAxis: ocvTime + loadTime },
          ]],
        } : undefined,
      },
    ],
  };

  // Results table columns
  const columns = [
    {
      title: t('batteryId'),
      dataIndex: 'id',
      key: 'id',
      width: 60,
      render: (id) => <span>{id}</span>,
    },
    {
      title: t('batteryOcv'), dataIndex: 'ocv', key: 'ocv', width: 90,
      render: (v) => {
        const bad = ocvSpec && v != null && Math.abs(v - ocvSpec.center) > ocvSpec.tolerance;
        return <span style={{ color: bad ? '#ff4d4f' : undefined, fontWeight: bad ? 700 : undefined }}>{v != null ? v.toFixed(3) : '-'}</span>;
      },
    },
    {
      title: t('batteryCcv'), dataIndex: 'ccv', key: 'ccv', width: 90,
      render: (v) => {
        const bad = ccvSpec && v != null && Math.abs(v - ccvSpec.center) > ccvSpec.tolerance;
        return <span style={{ color: bad ? '#ff4d4f' : undefined, fontWeight: bad ? 700 : undefined }}>{v != null ? v.toFixed(3) : '-'}</span>;
      },
    },
    { title: t('batteryTime'), dataIndex: 'time', key: 'time', width: 80, render: (v) => v != null ? String(v) : '-' },
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

  const ocvSpec = React.useMemo(() => {
    const v = parseFloat(ocvCenter);
    return isNaN(v) ? null : { center: v, tolerance: OCV_TOLERANCE };
  }, [ocvCenter]);
  const ccvSpec = React.useMemo(() => {
    const v = parseFloat(ccvCenter);
    return isNaN(v) ? null : { center: v, tolerance: CCV_TOLERANCE };
  }, [ccvCenter]);

  const recordsMap = React.useMemo(() => {
    const map = {};
    records.forEach((r) => { map[String(r.id)] = r; });
    return map;
  }, [records]);

  const buildMiniChartOption = React.useCallback((batteryId) => {
    const readings = readingsByBattery[batteryId] || [];
    const ocvData = readings.filter(r => r.phase === 'ocv').map(r => [r.t, r.v]);
    const ccvData = readings.filter(r => r.phase === 'ccv').map(r => [r.t, r.v]);
    const ccvDataConnected = ocvData.length > 0 && ccvData.length > 0
      ? [ocvData[ocvData.length - 1], ...ccvData]
      : ccvData;
    return {
      backgroundColor: 'transparent',
      grid: { top: 20, right: 16, bottom: 24, left: 48 },
      tooltip: { trigger: 'axis', formatter: (params) => params.map(p => `${p.marker}${p.seriesName}: ${p.value[1]?.toFixed(3)}V @ ${p.value[0]}s`).join('<br/>') },
      xAxis: {
        type: 'value',
        name: 's',
        axisLabel: { color: '#aaa', fontSize: 10 },
        splitLine: { lineStyle: { color: '#2a2a2a' } },
      },
      yAxis: {
        type: 'value',
        name: 'V',
        scale: true,
        axisLabel: { color: '#aaa', fontSize: 10 },
        splitLine: { lineStyle: { color: '#2a2a2a' } },
      },
      series: [
        { name: 'OCV', type: 'line', data: ocvData, symbol: 'none', lineStyle: { color: '#ffee58', width: 1.5 } },
        { name: 'CCV', type: 'line', data: ccvDataConnected, symbol: 'none', lineStyle: { color: '#0091ea', width: 1.5 } },
      ],
    };
  }, [readingsByBattery]);

  const prevRecordsLenRef = useRef(records.length);
  useEffect(() => {
    if (records.length <= prevRecordsLenRef.current) return;
    prevRecordsLenRef.current = records.length;
    const latest = records[records.length - 1];
    if (!latest) return;
    const ocvBad = ocvSpec && latest.ocv != null && Math.abs(latest.ocv - ocvSpec.center) > ocvSpec.tolerance;
    const ccvBad = ccvSpec && latest.ccv != null && Math.abs(latest.ccv - ccvSpec.center) > ccvSpec.tolerance;
    if (ocvBad || ccvBad) {
      const parts = [];
      if (ocvBad) parts.push(`OCV ${latest.ocv.toFixed(3)}V (spec: ${ocvSpec.center}±${OCV_TOLERANCE})`);
      if (ccvBad) parts.push(`CCV ${latest.ccv.toFixed(3)}V (spec: ${ccvSpec.center}±${CCV_TOLERANCE})`);
      notification.error({
        message: `⚠️ Pin #${latest.id} ${t('batteryOutOfSpec')}`,
        description: `${parts.join(', ')} — ${t('batteryRetestRequired')}`,
        duration: 0,
      });
    }
  }, [records, ocvSpec, ccvSpec, t]);

  useEffect(() => {
    try {
      const sessionData = {
        records,
        chartData,
        chartDataOCV,
        chartDataCCV,
        orderId,
        testDate: testDate ? testDate.format('YYYY-MM') : null,
        batteryType,
        productLine,
        ocvCenter,
        ccvCenter,
      };
      localStorage.setItem('battery_session', JSON.stringify(sessionData));
    } catch {}
  }, [records, chartData, chartDataOCV, chartDataCCV, orderId, testDate, batteryType, productLine, ocvCenter, ccvCenter]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('battery_session') || '{}');
      if (parsed?.records?.length > 0) {
        setSavedSessionInfo(parsed);
        setResumeModalVisible(true);
      }
    } catch {}
  }, []);

  const inputsDisabled = !connected;
  const canStart = connected && !running && orderId.trim() !== '' && testDate !== null && ocvCenter != null && ccvCenter != null;

  return (
    <div>
      <style>{`.battery-row-bad td { background: rgba(255,77,79,0.12) !important; }`}</style>
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
                    min={0.01}
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
                    min={0.1}
                    step={0.1}
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
                    min={0.1}
                    step={0.1}
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
              <Col xs={12} sm={8}>
                <Form.Item label={t('batteryType')} style={{ marginBottom: 0 }}>
                  <Select
                    value={batteryType}
                    onChange={setBatteryType}
                    disabled={inputsDisabled}
                    style={{ width: '100%' }}
                  >
                    <Option value="LR6">LR6</Option>
                    <Option value="LR03">LR03</Option>
                  </Select>
                </Form.Item>
              </Col>
              <Col xs={12} sm={8}>
                <Form.Item label={t('batteryProductLine')} style={{ marginBottom: 0 }}>
                  <Select
                    value={productLine}
                    onChange={setProductLine}
                    disabled={inputsDisabled}
                    style={{ width: '100%' }}
                  >
                    <Option value="UD+">UD+</Option>
                    <Option value="UD">UD</Option>
                    <Option value="HP">HP</Option>
                  </Select>
                </Form.Item>
              </Col>
              <Col xs={12} sm={12}>
                <Form.Item label={t('batteryOcvStandard')} style={{ marginBottom: 0 }} required>
                  <InputNumber
                    value={ocvCenter}
                    onChange={setOcvCenter}
                    disabled={inputsDisabled}
                    min={0}
                    step={0.001}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
              <Col xs={12} sm={12}>
                <Form.Item label={t('batteryCcvStandard')} style={{ marginBottom: 0 }} required>
                  <InputNumber
                    value={ccvCenter}
                    onChange={setCcvCenter}
                    disabled={inputsDisabled}
                    min={0}
                    step={0.001}
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
      <Collapse
        style={{ marginBottom: 16 }}
        items={[{
          key: 'excel-report',
          label: t('batteryExcelReport'),
          children: (
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
          ),
        }]}
      />

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
              notMerge={true}
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
                      pagination={false}
                      locale={{ emptyText: t('batteryNoResults') }}
                      scroll={{ x: true, y: 240 }}
                      rowClassName={(record) => {
                        const ocvBad = ocvSpec && record.ocv != null && Math.abs(record.ocv - ocvSpec.center) > ocvSpec.tolerance;
                        const ccvBad = ccvSpec && record.ccv != null && Math.abs(record.ccv - ccvSpec.center) > ccvSpec.tolerance;
                        return (ocvBad || ccvBad) ? 'battery-row-bad' : '';
                      }}
                      components={{
                        body: {
                          row: (rowProps) => {
                            const record = recordsMap[String(rowProps['data-row-key'])];
                            return <RowWithPopover record={record} readingsByBattery={readingsByBattery} buildMiniChartOption={buildMiniChartOption} {...rowProps} />;
                          },
                        },
                      }}
                    />
                  ),
                },
                {
                  key: 'history',
                  label: t('batteryHistory'),
                  children: (
                    <>
                      <div style={{ marginBottom: 8, textAlign: 'right' }}>
                        <Button
                          size="small"
                          icon={<DeleteOutlined />}
                          danger
                          onClick={() => {
                            Modal.confirm({
                              title: t('batteryClearHistoryConfirmTitle'),
                              content: t('batteryClearHistoryConfirmContent'),
                              okText: t('confirm'),
                              cancelText: t('cancel'),
                              okButtonProps: { danger: true },
                              onOk: () => {
                                setHistoryRecords([]);
                                localStorage.removeItem('battery_history');
                              },
                            });
                          }}
                        >
                          {t('batteryClearHistory')}
                        </Button>
                      </div>
                      <Table
                        dataSource={historyRecords}
                        columns={[
                          { title: t('batteryDate'), dataIndex: '_session', key: '_session' },
                          { title: t('batteryOrderId'), dataIndex: '_orderId', key: '_orderId', render: (v) => v || '-' },
                          { title: t('batteryId'), dataIndex: 'id', key: 'id' },
                          { title: t('batteryOcv'), dataIndex: 'ocv', key: 'ocv', render: (v) => v != null ? v.toFixed(3) : '-' },
                          { title: t('batteryCcv'), dataIndex: 'ccv', key: 'ccv', render: (v) => v != null ? v.toFixed(3) : '-' },
                          { title: t('batteryTime'), dataIndex: 'time', key: 'time', render: (v) => v != null ? String(v) : '-' },
                          {
                            title: t('status'),
                            dataIndex: 'status',
                            key: 'status',
                            render: (v) => v ? <Tag color="blue">{v}</Tag> : '-',
                          },
                        ]}
                        rowKey={(r, i) => `${r._session}_${r.id}_${i}`}
                        size="small"
                        pagination={false}
                        locale={{ emptyText: t('batteryNoResults') }}
                        scroll={{ x: true, y: 240 }}
                      />
                    </>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      {/* Action Buttons */}
      <Space wrap>
        <Tooltip title={!canStart && !running ? t('batteryFillRequiredFields') : undefined}>
          <Button
            type="primary"
            size="large"
            icon={running ? <StopOutlined /> : <PlayCircleOutlined />}
            danger={running}
            disabled={running ? false : !canStart}
            onClick={handleStartStop}
          >
            {running ? t('batteryStop') : t('batteryStart')}
          </Button>
        </Tooltip>

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
          onClick={() => {
            Modal.confirm({
              title: t('batteryClearSessionConfirmTitle'),
              content: t('batteryClearSessionConfirmContent'),
              okText: t('confirm'),
              cancelText: t('cancel'),
              okButtonProps: { danger: true },
              onOk: handleClearSession,
            });
          }}
          disabled={!connected || records.length === 0}
        >
          {t('batteryClearSession')}
        </Button>
      </Space>
      <Modal
        open={resumeModalVisible}
        title={t('batteryResumeTitle')}
        closable={false}
        maskClosable={false}
        keyboard={false}
        footer={[
          <Button key="new" danger onClick={() => {
            localStorage.removeItem('battery_session');
            setRecords([]);
            setChartData([]);
            setChartDataOCV([]);
            setChartDataCCV([]);
            setReadingsByBattery({});
            setOrderId('');
            setTestDate(dayjs());
            setBatteryType('LR6');
            setProductLine('UD+');
            setOcvCenter(null);
            setCcvCenter(null);
            setResumeModalVisible(false);
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ action: 'clear_session' }));
            } else {
              pendingNewSessionRef.current = true;
            }
          }}>{t('batteryNewSession')}</Button>,
          <Button key="continue" type="primary" onClick={() => {
            setResumeModalVisible(false);
          }}>{t('batteryContinueSession')}</Button>,
        ]}
      >
        <p>{t('batteryResumeDesc')}</p>
        {savedSessionInfo && (
          <ul>
            <li><strong>{t('batteryOrderId')}:</strong> {savedSessionInfo.orderId || '-'}</li>
            <li><strong>{t('batteryType')}:</strong> {savedSessionInfo.batteryType || '-'}</li>
            <li><strong>{t('batteryProductLine')}:</strong> {savedSessionInfo.productLine || '-'}</li>
            <li><strong>{t('batteryDate')}:</strong> {savedSessionInfo.testDate || '-'}</li>
            <li><strong>{t('batteryResults')}:</strong> {savedSessionInfo.records?.length || 0} {t('batteryId')}</li>
          </ul>
        )}
      </Modal>
    </div>
  );
}
