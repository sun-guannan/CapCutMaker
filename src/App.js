import React, { useState, useEffect } from 'react';
import { Layout, Typography, Input, Switch, Button, Progress, message, ConfigProvider, Dropdown, Menu, Modal } from 'antd';
import { CloudDownloadOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import './App.css';
import logo from './logo.png';
import translateIcon from '../public/translate.png';
import updateIcon from '../public/update.png'; // 导入更新图标
import settingsIcon from '../public/settings.png'; // 导入设置图标
import { useTranslation } from 'react-i18next';
import './i18n'; // 导入i18n配置

const { Header, Content } = Layout;
const { Title, Text } = Typography;

// 引入electron的ipcRenderer模块
const { ipcRenderer } = window.require('electron');

const App = () => {
  const { t, i18n } = useTranslation(); // 使用useTranslation hook
  const [draftId, setDraftId] = useState('');
  const [draftFolder, setDraftFolder] = useState('');
  const [isCapcut, setIsCapcut] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [locale, setLocale] = useState(zhCN);
  const [language, setLanguage] = useState('zh');
  const [updateAvailable, setUpdateAvailable] = useState(false); // 添加更新状态
  const [updateMessage, setUpdateMessage] = useState(''); // 添加更新消息
  const [settingsVisible, setSettingsVisible] = useState(false); // 添加设置对话框可见性状态
  const [tempDraftFolder, setTempDraftFolder] = useState(''); // 临时存储设置对话框中的草稿文件夹路径
  const [tempIsCapcut, setTempIsCapcut] = useState(true); // 临时存储设置对话框中的应用类型

  // 修改useEffect部分，确保正确处理返回的设置对象并自动弹出设置对话框
  useEffect(() => {
    // 从主进程获取保存的设置值
    ipcRenderer.invoke('get-draft-folder').then(settings => {
      let draftFolderValue = '';
      
      if (typeof settings === 'string') {
        // 兼容旧版本，直接返回draftFolder字符串的情况
        draftFolderValue = settings || '';
        setDraftFolder(draftFolderValue);
      } else if (settings && typeof settings === 'object') {
        // 新版本返回对象的情况
        draftFolderValue = settings.draftFolder || '';
        setDraftFolder(draftFolderValue);
        if (settings.isCapcut !== undefined) {
          setIsCapcut(settings.isCapcut);
        }
      }
      
      // 如果draftFolder为空，自动弹出设置对话框
      if (!draftFolderValue) {
        openSettings();
      }
    });

    // 监听来自主进程的协议URL消息
    ipcRenderer.on('protocol-url', (event, url) => {
      console.log('Received protocol URL:', url);
      const parsedData = parseUrlParams(url);
      
      // 如果URL中包含draft_id和is_capcut参数，自动填充到表单中
      if (parsedData.params && parsedData.params.draft_id) {
        setDraftId(parsedData.params.draft_id);
      }
      
      if (parsedData.params && parsedData.params.is_capcut !== undefined) {
        setIsCapcut(parsedData.params.is_capcut === '1');
      }
    });

    // 监听下载进度
    ipcRenderer.on('download-progress', (event, { progress, text }) => {
      setProgress(progress);
      setProgressText(text);
    });

    // 监听下载状态
    ipcRenderer.on('download-status', (event, data) => {
      if (data.status === 'completed') {
        setDownloading(false);
        setProgress(100);
        setProgressText(t('download_complete'));
        setTimeout(() => {
          setProgress(0);
          setProgressText('');
        }, 3000);
      }
    });

    // 监听下载完成
    ipcRenderer.on('download-complete', () => {
      setDownloading(false);
      setProgress(100);
      setProgressText(t('download_complete'));
      setTimeout(() => {
        setProgress(0);
        setProgressText('');
      }, 3000);
    });

    // 监听下载错误
    ipcRenderer.on('download-error', (event, error) => {
      setDownloading(false);
      setErrorMessage(`${t('error_prefix')}${error}`);
    });

    // 监听更新消息
    ipcRenderer.on('update-message', (event, message) => {
      setUpdateMessage(message);
      if (message.includes('发现新版本') || message.includes('更新已下载')) {
        setUpdateAvailable(true);
      }
    });
    
    // 组件卸载时清理事件监听器
    return () => {
      ipcRenderer.removeAllListeners('protocol-url');
      ipcRenderer.removeAllListeners('download-progress');
      ipcRenderer.removeAllListeners('download-status'); // 添加这一行
      ipcRenderer.removeAllListeners('download-complete');
      ipcRenderer.removeAllListeners('download-error');
      ipcRenderer.removeAllListeners('update-message');
    };
  }, [t]); // 添加t作为依赖，确保翻译更新时重新运行

  // 切换语言
  const toggleLanguage = (newLang) => {
    const newLanguage = newLang || (language === 'zh' ? 'en' : 'zh');
    setLanguage(newLanguage);
    setLocale(newLanguage === 'zh' ? zhCN : enUS);
    i18n.changeLanguage(newLanguage); // 使用i18next切换语言
  };

  // 检查更新
  const checkForUpdates = () => {
    ipcRenderer.send('check-for-updates');
    message.info(t('check_update'));
  };

  // 重启并安装更新
  const restartAndUpdate = () => {
    ipcRenderer.send('restart-and-update');
  };

  // 打开设置对话框
  const openSettings = () => {
    setTempDraftFolder(draftFolder || ''); // 确保是空字符串而不是undefined
    setTempIsCapcut(isCapcut);
    setSettingsVisible(true);
  };

  // 保存设置
  const saveSettings = () => {
    setDraftFolder(tempDraftFolder);
    setIsCapcut(tempIsCapcut);
    // 保存设置到主进程
    ipcRenderer.send('save-settings', {
      draftFolder: tempDraftFolder,
      isCapcut: tempIsCapcut
    });
    setSettingsVisible(false);
    message.success(t('settings_saved'));
  };

  // 取消设置
  const cancelSettings = () => {
    // 如果是首次启动且没有设置draftFolder，不允许关闭设置对话框
    if (!draftFolder) {
      message.warning(t('draft_folder_required'));
      return;
    }
    setSettingsVisible(false);
  };

  // 处理下载
  const handleDownload = () => {
    if (!draftId) {
      message.error(t('input_required'));
      return;
    }

    // 如果draftFolder为空，提示用户设置
    if (!draftFolder) {
      message.error(t('draft_folder_required'));
      openSettings();
      return;
    }

    setDownloading(true);
    setProgress(0);
    setProgressText(t('preparing'));
    setErrorMessage('');

    const params = {
      draft_id:draftId,
      draft_folder: draftFolder || '',
      is_capcut: isCapcut
    };

    debugger;
    // 发送到主进程
    ipcRenderer.send('process-parameters', params);
  };

  return (
    <ConfigProvider locale={locale}>
      <Layout className="app-container">
        <Header className="app-header">
          <div className="app-title">
            <img src={logo} alt="CapCutMaker Logo" className="app-logo" />
            <Title level={3} style={{ margin: 0 }}>{t('title')}</Title>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Dropdown
              overlay={
                <Menu>
                  <Menu.Item key="zh" onClick={() => toggleLanguage('zh')}>
                    中文
                  </Menu.Item>
                  <Menu.Item key="en" onClick={() => toggleLanguage('en')}>
                    English
                  </Menu.Item>
                </Menu>
              }
              placement="bottomRight"
            >
              <Button 
                icon={<img src={translateIcon} alt="translate" className="translate-icon" />}
                type="text"
                className="header-button"
              >
              </Button>
            </Dropdown>
            {updateAvailable ? (
              <Button 
                icon={<img src={updateIcon} alt="update" className="update-icon" />}
                type="primary"
                onClick={restartAndUpdate}
                className="update-button"
                title={updateMessage}
              >
                {language === 'zh' ? '重启更新版本' : 'Restart to update'}
              </Button>
            ) : (
              <Button 
                icon={<img src={updateIcon} alt="update" className="update-icon" />}
                type="text"
                onClick={checkForUpdates}
                title={t('check_update')}
                className="header-button"
              />
            )}
            <Button 
              icon={<img src={settingsIcon} alt="settings" className="settings-icon" />}
              type="text"
              onClick={openSettings}
              title={t('settings')}
              className="header-button"
            />
          </div>
        </Header>
        
        <Content className="app-content">
          <div className="form-container">
            <div className="form-item">
              <Text strong>{t('draft_id_label')}</Text>
              <Input 
                value={draftId}
                onChange={(e) => setDraftId(e.target.value)}
                placeholder={t('draft_id_placeholder')}
              />
            </div>
            
            {/* 移除了Draft Folder和App Type输入框 */}
            
            <div className="form-item">
              <Button 
                type="primary" 
                onClick={handleDownload}
                loading={downloading}
                block
              >
                {t('download_button')}
              </Button>
            </div>
            
            {progress > 0 && (
              <div className="form-item">
                <Progress percent={progress} status="active" />
                <div className="progress-text">{progressText}</div>
              </div>
            )}
            
            {errorMessage && (
              <div className="form-item error-message">
                {errorMessage}
              </div>
            )}
          </div>
        </Content>

        {/* 设置对话框 */}
        <Modal
          title={t('settings')}
          open={settingsVisible}
          onOk={saveSettings}
          onCancel={cancelSettings}
          okText={t('save')}
          okButtonProps={{ disabled: !tempDraftFolder }} // 如果tempDraftFolder为空，禁用保存按钮
          styles={{ body: { marginTop: '50px', marginBottom: '50px' } }}
          cancelText={t('cancel')}
          closable={!!draftFolder} // 如果draftFolder为空，不允许通过X关闭对话框
          maskClosable={!!draftFolder} // 如果draftFolder为空，不允许通过点击遮罩关闭对话框
        >
          <div className="settings-form-item">
            <Text strong>{t('draft_folder_label')}</Text>
            <Input 
              className="settings-input"
              value={tempDraftFolder}
              onChange={(e) => setTempDraftFolder(e.target.value)}
              placeholder={t('draft_folder_placeholder')}
            />
          </div>
          <div className="settings-form-item">
            <Text strong>{t('app_type_label')}</Text>
            <div className="switch-container">
              <span className={!tempIsCapcut ? 'active-text' : ''}>{t('jianying')}</span>
              <Switch 
                checked={tempIsCapcut}
                onChange={setTempIsCapcut}
                className="app-switch"
              />
              <span className={tempIsCapcut ? 'active-text' : ''}>{t('capcut')}</span>
            </div>
          </div>
        </Modal>
      </Layout>
    </ConfigProvider>
  );
};

export default App;