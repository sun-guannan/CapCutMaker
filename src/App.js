import React, { useState, useEffect } from 'react';
import { Segmented, Layout, Typography, Input, Switch, Button, Progress, message, ConfigProvider, Dropdown, Menu, Modal } from 'antd';
import { CloudDownloadOutlined } from '@ant-design/icons';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import './App.css';
import logo from './icon.png';
import translateIcon from '../public/translate.png';
import updateIcon from '../public/update.png'; // 导入更新图标
import settingsIcon from '../public/settings.png'; // 导入设置图标
import { useTranslation } from 'react-i18next';
import './i18n'; // 导入i18n配置

const { Header, Content } = Layout;
const { Title, Text } = Typography;

// 引入electron的ipcRenderer模块
const { ipcRenderer } = window.require('electron');

// 解析URL参数的函数
function parseUrlParams(protocolUrl) {
  try {
    // 移除协议前缀
    const urlWithoutProtocol = protocolUrl.replace('capcutmaker://', '');
    
    // 分离路径和查询参数
    const [path, queryString] = urlWithoutProtocol.split('?');
    
    const result = {
      path: path,
      params: {}
    };
    
    // 解析查询参数
    if (queryString) {
      const params = new URLSearchParams(queryString);
      params.forEach((value, key) => {
        result.params[key] = value;
      });
    }
    
    return result;
  } catch (error) {
    return { error: error.message };
  }
}

const App = () => {
  const { t, i18n } = useTranslation(); // 使用useTranslation hook
  const [draftUrl, setDraftUrl] = useState('');
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
  const [tempApiKey, setTempApiKey] = useState(''); // 临时存储设置对话框中的API_KEY
  const [apiKey, setApiKey] = useState(''); // 存储API_KEY
  const [downloadComplete, setDownloadComplete] = useState(false);
  const [completedDraftId, setCompletedDraftId] = useState('');

  // 修改useEffect部分，移除对旧版本的兼容处理
  useEffect(() => {
    // 从主进程获取保存的设置值
    ipcRenderer.invoke('get-draft-folder').then(settings => {
      // 新版本返回对象的情况
      const draftFolderValue = settings.draftFolder || '';
      setDraftFolder(draftFolderValue);
      if (settings.isCapcut !== undefined) {
        setIsCapcut(settings.isCapcut);
      }
      if (settings.apiKey !== undefined) {
        setApiKey(settings.apiKey);
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
      
      // 如果URL中包含draft_id参数，自动填充到表单中并触发下载
      if (parsedData.params && parsedData.params.draft_id) {
        setDraftId(parsedData.params.draft_id);
        
        // 如果是从协议URL跳转而来，自动触发下载
        // 确保draftFolder已设置
        if (draftFolder) {
          // 延迟一点执行下载，确保状态已更新
          setTimeout(() => {
            handleDownload(parsedData.params.draft_id);
          }, 100);
        }
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
        console.log('download-status completed')
        console.log(data)
        setDownloading(false);
        setProgress(0);
        setDownloadComplete(true);
        setCompletedDraftId(data.draft_id);
        
        // 使用 Ant Design 的 message 组件显示成功消息
        message.success({
          content: t('view_draft', { draft_id: data.draft_id }),
          duration: 5,
        });
      }
    });

    // 监听下载完成
    ipcRenderer.on('download-complete', () => {
      setDownloading(false);
      setDownloadComplete(true);
      setCompletedDraftId(draftId);

      console.log('download-complete')
      
      // 使用 Ant Design 的 message 组件显示成功消息
      message.success({
        content: t('view_draft', { draft_id: draftId }),
        duration: 5,
      });
    });

    // 监听下载错误
    ipcRenderer.on('download-error', (event, error) => {
      setDownloading(false);
      setProgress(0); // 隐藏进度条
      setProgressText('');
      
      // 使用 Ant Design 的 message 组件显示错误消息
      message.error({
        content: `${t('error_prefix')}${error}`,
        duration: 5,
      });
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
      ipcRenderer.removeAllListeners('download-status');
      ipcRenderer.removeAllListeners('download-complete');
      ipcRenderer.removeAllListeners('download-error');
      ipcRenderer.removeAllListeners('update-message');
    };
  }, [t, draftFolder]); // 添加draftFolder作为依赖，确保draftFolder更新时重新运行

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
    setTempApiKey(apiKey || ''); // 设置临时API_KEY
    setSettingsVisible(true);
  };

  // 保存设置
  const saveSettings = () => {
    setDraftFolder(tempDraftFolder);
    setIsCapcut(tempIsCapcut);
    setApiKey(tempApiKey); // 保存API_KEY
    // 保存设置到主进程
    ipcRenderer.send('save-settings', {
      draftFolder: tempDraftFolder,
      isCapcut: tempIsCapcut,
      apiKey: tempApiKey // 添加API_KEY
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
  const handleDownload = (draftIdParam) => {
    // 使用传入的参数或状态中的值
    let currentDraftId = draftIdParam || draftId;
    let apiKeyHash = null;
    
    // 如果没有draftId，尝试从draftUrl中提取
    if (!currentDraftId && draftUrl) {
      // 尝试解析URL中的参数
      try {
        const urlObj = new URL(draftUrl);
        const params = new URLSearchParams(urlObj.search);
        
        currentDraftId = params.get('draft_id');
        apiKeyHash = params.get('api_key_hash');
      } catch (error) {
        console.error('解析URL失败:', error);
      }
    }
    
    if (!currentDraftId) {
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
      draft_id: currentDraftId,
      draft_folder: draftFolder,
      is_capcut: isCapcut
    };
    
    // 如果有apiKeyHash，添加到参数中
    if (apiKeyHash) {
      params.api_key_hash = apiKeyHash;
    }

    // 发送到主进程
    ipcRenderer.send('process-parameters', params);
  };

  return (
    <ConfigProvider locale={locale}>
      <Layout className="app-container">
        <Header className="app-header">
          <div className="app-title" onClick={() => window.open('https://www.capcutapi.top', '_blank', 'width=1200,height=900')}>
            <img src={logo} alt="CapCutAPI Logo" className="app-logo" />
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
              <Text strong>{t('draft_url_label')}</Text>
              <Input 
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                placeholder={t('draft_url_placeholder')}
              />
            </div>
            
            <div className="form-item">
              <Button 
                type="primary" 
                onClick={() => handleDownload()}
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
            
            {downloadComplete && (
              <div className="form-item success-message" style={{ color: '#52c41a', marginTop: '10px', textAlign: 'center' }}>
                <CloudDownloadOutlined style={{ marginRight: '8px' }} />
                {t('view_draft', { draft_id: completedDraftId })}
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
          okButtonProps={{ disabled: !tempDraftFolder || !tempApiKey }} // 如果tempDraftFolder为空，禁用保存按钮
          styles={{ body: { marginTop: '50px', marginBottom: '50px' } }}
          cancelText={t('cancel')}
          closable={!!draftFolder} // 如果draftFolder为空，不允许通过X关闭对话框
          maskClosable={!!draftFolder} // 如果draftFolder为空，不允许通过点击遮罩关闭对话框
        >
          <div className="settings-form-item">
            <Text strong>{t('api_key_label')}</Text>
            <Input 
              className="settings-input"
              value={tempApiKey}
              onChange={(e) => setTempApiKey(e.target.value)}
              placeholder={t('api_key_placeholder')}
            />
          </div>
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
              <Segmented
                options={[
                  { value: 'jianying', label: t('jianying') },
                  { value: 'capcut', label: t('capcut') }
                ]}
                value={tempIsCapcut ? 'capcut' : 'jianying'}
                onChange={(value) => setTempIsCapcut(value === 'capcut')}
                className="app-segmented"
              />
            </div>
          </div>
        </Modal>
      </Layout>
    </ConfigProvider>
  );
};

export default App;