'use client';

import { apiBaseUrl } from '@/lib/api';
import Link from 'next/link';
import {
  AiPurpose,
  AiProviderCapability,
  LocalAiProvider,
  LocalAiRoute,
  deleteLocalAiProvider,
  ensureDefaultAiRoutes,
  loadLocalAiProviders,
  loadLocalAiRoutes,
  saveLocalAiRoutes,
  setLocalAiRoute,
  upsertLocalAiProvider,
} from '@/lib/local-settings';
import { useEffect, useMemo, useState } from 'react';

function newId(): string {
  return `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

type PurposeDefinition = {
  key: AiPurpose;
  label: string;
  capability: AiProviderCapability;
  group: string;
  description: string;
  required?: boolean;
  builtIn?: boolean;
};

const BUILT_IN_PURPOSES: PurposeDefinition[] = [
  {
    key: 'title',
    label: '标题生成',
    capability: 'text',
    group: '核心文本链路',
    description: '生成商品标题，前端本地文本运行时的首选路由，至少配一个。',
    required: true,
    builtIn: true,
  },
  {
    key: 'product_info',
    label: '商品理解 / 截图理解',
    capability: 'text',
    group: '提示词与解析',
    description: '对应 product_info_from_screenshot 这类理解步骤。',
    required: true,
    builtIn: true,
  },
  {
    key: 'title_package_lite',
    label: '轻量标题包',
    capability: 'text',
    group: '核心文本链路',
    description: '模式 2 使用的轻量标题链路，只生成标题和类目检索字段。',
    builtIn: true,
  },
  {
    key: 'title_package',
    label: '标题包生成',
    capability: 'text',
    group: '核心文本链路',
    description: '适合把标题、卖点、翻译统一交给一个文本模型。',
    builtIn: true,
  },
  {
    key: 'dimension_extract',
    label: '尺寸识别 / 尺寸图解析',
    capability: 'text',
    group: '提示词与解析',
    description: '用于尺寸图识别、尺寸字段抽取或补全。',
    builtIn: true,
  },
  {
    key: 'image_generate',
    label: '通用生图',
    capability: 'image',
    group: '图片执行',
    description: '主图、预览图、普通单图生成。',
    required: true,
    builtIn: true,
  },
  {
    key: 'image_4grid',
    label: '4 宫格生图',
    capability: 'image',
    group: '图片执行',
    description: '四宫格母图或轮播图专用生图模型。',
    required: true,
    builtIn: true,
  },
];

const BUILT_IN_PURPOSE_MAP = new Map(BUILT_IN_PURPOSES.map((item) => [item.key, item]));

type TestResult = { ok: boolean; detail?: string; models?: string[] };

type ProviderPreset = {
  name: string;
  baseUrl: string;
  capabilities: AiProviderCapability[];
  models: string[];
  keyUrl: string;
};

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    name: '豆包（文案）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    capabilities: ['text'],
    models: ['doubao-seed-1-6-flash', 'doubao-seed-1-6'],
    keyUrl: 'https://console.volcengine.com/ark',
  },
  {
    name: 'DeepSeek（文案）',
    baseUrl: 'https://api.deepseek.com/v1',
    capabilities: ['text'],
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    name: '通义千问（文案）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    capabilities: ['text'],
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo'],
    keyUrl: 'https://bailian.console.aliyun.com/',
  },
  {
    name: 'OpenAI（文案+生图）',
    baseUrl: 'https://api.openai.com/v1',
    capabilities: ['text', 'image'],
    models: ['gpt-5', 'gpt-4.1-mini', 'gpt-image-1'],
    keyUrl: 'https://platform.openai.com/api-keys',
  },
];

function dedupeStrings(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function getPurposeMeta(route: LocalAiRoute): PurposeDefinition {
  const builtIn = BUILT_IN_PURPOSE_MAP.get(route.purpose);
  if (builtIn) return builtIn;
  const label = typeof route.params?.label === 'string' && route.params.label.trim() ? route.params.label.trim() : route.purpose;
  const capability = route.params?.capability === 'image' ? 'image' : 'text';
  return {
    key: route.purpose,
    label,
    capability,
    group: '扩展用途',
    description: '自定义扩展用途。当前主要用于预留未来链路或临时实验。',
    builtIn: false,
  };
}

type WizardStep = 'providers' | 'edit' | 'purposes';

// 用途组图标映射
const GROUP_ICONS: Record<string, string> = {
  '核心文本链路': '📝',
  '提示词与解析': '🎨',
  '图片执行': '🖼️',
  '扩展用途': '⚙️',
};

export default function AiSettingsWizardPage() {
  const [mounted, setMounted] = useState(false);
  const [providers, setProviders] = useState<LocalAiProvider[]>([]);
  const [routes, setRoutes] = useState<LocalAiRoute[]>([]);
  const [currentStep, setCurrentStep] = useState<WizardStep>('providers');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => providers.find((p) => p.id === selectedId) || null, [providers, selectedId]);

  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [modelFilter, setModelFilter] = useState('');
  const [showAllTestModels, setShowAllTestModels] = useState(false);
  const [customPurposeKey, setCustomPurposeKey] = useState('');
  const [customPurposeLabel, setCustomPurposeLabel] = useState('');
  const [customPurposeCapability, setCustomPurposeCapability] = useState<AiProviderCapability>('text');
  const selectedKeyPreset =
    (selected
      ? PROVIDER_PRESETS.find(
          (preset) =>
            selected.baseUrl === preset.baseUrl || selected.name.includes(preset.name.split('（')[0]),
        )
      : null) || null;

  useEffect(() => {
    setMounted(true);
    ensureDefaultAiRoutes();
    const items = loadLocalAiProviders();
    setProviders(items);
    setRoutes(loadLocalAiRoutes());
    if (!selectedId && items[0]?.id) setSelectedId(items[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const customRoutes = useMemo(
    () => routes.filter((route) => !BUILT_IN_PURPOSE_MAP.has(route.purpose)),
    [routes],
  );

  const purposeGroups = useMemo(() => {
    const definitions = [...BUILT_IN_PURPOSES, ...customRoutes.map(getPurposeMeta)];
    const groups = new Map<string, PurposeDefinition[]>();
    for (const definition of definitions) {
      const items = groups.get(definition.group) || [];
      items.push(definition);
      groups.set(definition.group, items);
    }
    return Array.from(groups.entries()).map(([title, purposes]) => ({ title, purposes }));
  }, [customRoutes]);

  const filteredTestModels = useMemo(() => {
    const models = dedupeStrings(testResult?.models || []);
    if (!modelFilter.trim()) return models;
    const keyword = modelFilter.trim().toLowerCase();
    return models.filter((model) => model.toLowerCase().includes(keyword));
  }, [modelFilter, testResult?.models]);

  const visibleTestModels = useMemo(() => {
    if (showAllTestModels || modelFilter.trim()) return filteredTestModels;
    return filteredTestModels.slice(0, 36);
  }, [filteredTestModels, modelFilter, showAllTestModels]);

  // 计算哪些用途已配置
  const configuredPurposeCount = useMemo(() => {
    return routes.filter((r) => r.providerId && r.model).length;
  }, [routes]);

  function refresh(): void {
    const items = loadLocalAiProviders();
    setProviders(items);
    setRoutes(loadLocalAiRoutes());
  }

  function startAdd(): void {
    const id = newId();
    const created: LocalAiProvider = {
      id,
      name: '新建接口（OpenAI 兼容）',
      type: 'openai_compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      capabilities: ['text'],
      models: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    upsertLocalAiProvider(created);
    refresh();
    setSelectedId(id);
    setTestResult(null);
    setModelFilter('');
    setShowAllTestModels(false);
  }

  function addFromPreset(preset: ProviderPreset): void {
    const id = newId();
    const created: LocalAiProvider = {
      id,
      name: preset.name,
      type: 'openai_compatible',
      baseUrl: preset.baseUrl,
      apiKey: '',
      capabilities: preset.capabilities,
      models: preset.models,
      testStatus: 'unknown',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    upsertLocalAiProvider(created);
    refresh();
    setSelectedId(id);
    setTestResult(null);
    setModelFilter('');
    setShowAllTestModels(false);
  }

  async function testConnection(p: LocalAiProvider): Promise<void> {
    setTestResult(null);
    setTesting(true);
    setModelFilter('');
    setShowAllTestModels(false);
    try {
      const res = await fetch(`${apiBaseUrl}/api/ai/test-openai-compatible`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ base_url: p.baseUrl, api_key: p.apiKey }),
      });
      const json = (await res.json()) as { ok?: boolean; detail?: string; models?: string[] };
      if (!res.ok || !json?.ok) {
        upsertLocalAiProvider({
          ...p,
          testStatus: 'failed',
          testedAt: new Date().toISOString(),
          testDetail: json?.detail || `HTTP ${res.status}`,
        });
        refresh();
        setTestResult({ ok: false, detail: json?.detail || `HTTP ${res.status}` });
        return;
      }
      const discoveredModels = dedupeStrings(Array.isArray(json.models) ? json.models : []);
      upsertLocalAiProvider({
        ...p,
        models: dedupeStrings([...(p.models || []), ...discoveredModels]),
        testStatus: 'success',
        testedAt: new Date().toISOString(),
        testDetail: '',
      });
      refresh();
      setTestResult({ ok: true, models: discoveredModels });
    } catch (err) {
      upsertLocalAiProvider({
        ...p,
        testStatus: 'failed',
        testedAt: new Date().toISOString(),
        testDetail: err instanceof Error ? err.message : '测试失败',
      });
      refresh();
      setTestResult({ ok: false, detail: err instanceof Error ? err.message : '测试失败' });
    } finally {
      setTesting(false);
    }
  }

  function updateSelected(patch: Partial<LocalAiProvider>): void {
    if (!selected) return;
    const baseChanged = typeof patch.baseUrl === 'string' && patch.baseUrl !== selected.baseUrl;
    const keyChanged = typeof patch.apiKey === 'string' && patch.apiKey !== selected.apiKey;
    upsertLocalAiProvider({
      ...selected,
      ...patch,
      ...(baseChanged || keyChanged
        ? { testStatus: 'unknown', testedAt: undefined, testDetail: '接口地址或密钥已修改，请重新测试连接' }
        : {}),
    });
    refresh();
    setTestResult(null);
  }

  function addCustomPurpose(): void {
    const purpose = customPurposeKey.trim();
    const label = customPurposeLabel.trim();
    if (!purpose) return;
    if (routes.some((route) => route.purpose === purpose) || BUILT_IN_PURPOSE_MAP.has(purpose)) {
      window.alert(`用途标识已存在：${purpose}`);
      return;
    }
    setLocalAiRoute({
      purpose,
      providerId: '',
      model: '',
      params: { label: label || purpose, capability: customPurposeCapability, built_in: false },
    });
    refresh();
    setCustomPurposeKey('');
    setCustomPurposeLabel('');
    setCustomPurposeCapability('text');
  }

  function removeCustomPurpose(purpose: AiPurpose): void {
    const next = loadLocalAiRoutes().filter((route) => route.purpose !== purpose);
    saveLocalAiRoutes(next);
    refresh();
  }

  // 选择接口后进入编辑
  function selectProvider(id: string): void {
    setSelectedId(id);
    setTestResult(null);
    setModelFilter('');
    setShowAllTestModels(false);
    setCurrentStep('edit');
  }

  if (!mounted) {
    return (
      <div className='flex items-center justify-center min-h-[400px]'>
        <div className='text-slate-600'>加载中...</div>
      </div>
    );
  }

  return (
    <div className='flex flex-col h-full'>
      {/* 顶部标题栏 */}
      <header className='shrink-0 border-b border-slate-200 bg-white px-5 py-3'>
        <div className='flex items-center justify-between'>
          <div>
            <div className='text-xs text-slate-500'>运营可读 · 三步搞定</div>
            <h1 className='text-lg font-semibold text-slate-900'>AI 配置向导</h1>
          </div>
          <Link
            href='/settings/ai/guide'
            className='inline-flex h-9 items-center rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-700 hover:bg-slate-50'
          >
            查看详细教程
          </Link>
        </div>

        {/* 步骤指示器 */}
        <div className='mt-3 flex items-center gap-2'>
          <StepIndicator
            num={1}
            label='接口管理'
            active={currentStep === 'providers'}
            completed={currentStep !== 'providers'}
            onClick={() => setCurrentStep('providers')}
          />
          <div className='h-5 w-5 border-l-2 border-slate-300'></div>
          <StepIndicator
            num={2}
            label='编辑接口'
            active={currentStep === 'edit'}
            completed={currentStep === 'purposes'}
            disabled={currentStep === 'providers'}
            onClick={() => currentStep !== 'providers' && setCurrentStep('edit')}
          />
          <div className='h-5 w-5 border-l-2 border-slate-300'></div>
          <StepIndicator
            num={3}
            label={`用途分配${configuredPurposeCount > 0 ? ` (${configuredPurposeCount})` : ''}`}
            active={currentStep === 'purposes'}
            disabled={currentStep === 'providers'}
            onClick={() => setCurrentStep('purposes')}
          />
        </div>
      </header>

      {/* 主体内容区 */}
      <div className='flex flex-1 overflow-hidden'>
        {/* 左侧：接口管理 */}
        <aside className='w-72 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-4'>
          <div className='space-y-3'>
            {/* 新增接口 */}
            <button
              type='button'
              onClick={startAdd}
              className='flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800'
            >
              <span>+</span>
              <span>新增接口</span>
            </button>

            {/* 模板快速添加 */}
            <div className='rounded-xl border border-slate-100 bg-slate-50 p-3'>
              <div className='text-xs font-semibold text-slate-600 mb-2'>快速添加</div>
              <div className='flex flex-wrap gap-1.5'>
                {PROVIDER_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type='button'
                    onClick={() => addFromPreset(preset)}
                    className='rounded-full border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100'
                  >
                    + {preset.name.split('（')[0]}
                  </button>
                ))}
              </div>
            </div>

            {/* 接口列表 */}
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <div className='text-xs font-semibold text-slate-600'>已配置接口</div>
                <div className='text-xs text-slate-400'>{providers.length} 个</div>
              </div>
              {providers.map((p) => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  selected={selectedId === p.id}
                  onClick={() => selectProvider(p.id)}
                />
              ))}
              {!providers.length ? (
                <div className='rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center'>
                  <div className='text-xs text-slate-500'>暂无接口</div>
                </div>
              ) : null}
            </div>
          </div>
        </aside>

        {/* 右侧：编辑和用途分配 */}
        <main className='flex flex-1 flex-col overflow-hidden'>
          {/* 内容区域 */}
          <div className='flex flex-1 overflow-y-auto'>
            <div className='w-full p-6'>
              {/* 第一步：接口管理提示 */}
              {currentStep === 'providers' && (
                <div className='flex items-center justify-center min-h-[400px]'>
                  <div className='text-center max-w-sm'>
                    <div className='text-5xl mb-3'>🖥️</div>
                    <div className='text-lg font-medium text-slate-900'>选择或添加接口</div>
                    <div className='mt-2 text-sm text-slate-600'>
                      从左侧选择一个接口，或点击按钮添加
                    </div>
                  </div>
                </div>
              )}

              {/* 第二步：编辑接口 */}
              {currentStep === 'edit' && selected && (
                <ProviderEditor
                    provider={selected}
                    testResult={testResult}
                    testing={testing}
                    modelFilter={modelFilter}
                    showAllTestModels={showAllTestModels}
                    visibleTestModels={visibleTestModels}
                    filteredTestModels={filteredTestModels}
                    selectedKeyPreset={selectedKeyPreset}
                    onUpdate={updateSelected}
                    onTest={() => void testConnection(selected)}
                    onDelete={() => {
                      if (!confirm(`确认删除接口：${selected.name}？`)) return;
                      deleteLocalAiProvider(selected.id);
                      refresh();
                      setSelectedId(loadLocalAiProviders()[0]?.id || null);
                      setTestResult(null);
                      if (loadLocalAiProviders().length === 0) {
                        setCurrentStep('providers');
                      }
                    }}
                    onModelFilterChange={setModelFilter}
                    onShowAllTestModels={() => setShowAllTestModels(true)}
                    onAddModel={(m) => {
                      const next = dedupeStrings([m, ...selected.models]);
                      updateSelected({ models: next });
                    }}
                    onNextStep={() => setCurrentStep('purposes')}
                  />
              )}

              {/* 第三步：用途分配 */}
              {currentStep === 'purposes' && (
                <PurposeAllocation
                    providers={providers}
                    routes={routes}
                    purposeGroups={purposeGroups}
                    customPurposeKey={customPurposeKey}
                    customPurposeLabel={customPurposeLabel}
                    customPurposeCapability={customPurposeCapability}
                    testResult={testResult}
                    selected={selected}
                    onRouteChange={(purpose, providerId, model) => {
                      setLocalAiRoute({
                        purpose,
                        providerId,
                        model,
                      });
                      refresh();
                    }}
                    onCustomPurposeKeyChange={setCustomPurposeKey}
                    onCustomPurposeLabelChange={setCustomPurposeLabel}
                    onCustomPurposeCapabilityChange={setCustomPurposeCapability}
                    onAddCustomPurpose={addCustomPurpose}
                    onRemoveCustomPurpose={removeCustomPurpose}
                  />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

// 步骤指示器组件
function StepIndicator({
  num,
  label,
  active,
  completed,
  disabled,
  onClick,
}: {
  num: number;
  label: string;
  active: boolean;
  completed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const baseClass = 'flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors';
  const activeClass = 'bg-slate-900 text-white';
  const completedClass = 'bg-emerald-50 text-emerald-700 border border-emerald-200';
  const pendingClass = 'bg-slate-100 text-slate-500';
  const disabledClass = 'cursor-not-allowed opacity-60';

  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      className={`${baseClass} ${active ? activeClass : completed ? completedClass : pendingClass} ${disabled ? disabledClass : ''}`}
    >
      <span className='flex h-5 w-5 items-center justify-center rounded-full bg-white/20 text-xs'>{completed ? '✓' : num}</span>
      <span>{label}</span>
    </button>
  );
}

// 接口卡片组件
function ProviderCard({
  provider,
  selected,
  onClick,
}: {
  provider: LocalAiProvider;
  selected: boolean;
  onClick: () => void;
}) {
  const statusConfig = {
    success: { label: '已连接', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
    failed: { label: '失败', className: 'border-rose-200 bg-rose-50 text-rose-700' },
    unknown: { label: '未测试', className: 'border-slate-200 bg-slate-100 text-slate-500' },
  };
  const status = statusConfig[provider.testStatus === 'success' ? 'success' : provider.testStatus === 'failed' ? 'failed' : 'unknown'];

  return (
    <button
      type='button'
      onClick={onClick}
      className={`w-full rounded-xl border p-3 text-left transition-all ${
        selected ? 'border-slate-900 bg-slate-900 text-white shadow-md' : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
      }`}
    >
      <div className='flex items-center justify-between'>
        <div className='truncate text-sm font-semibold'>{provider.name}</div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${selected ? 'border-white/30 bg-white/20 text-white' : status.className}`}>
          {status.label}
        </span>
      </div>
      <div className={`mt-1 truncate text-xs ${selected ? 'text-white/70' : 'text-slate-400'}`}>{provider.baseUrl || '未填写地址'}</div>
      {provider.capabilities.length > 0 && (
        <div className={`mt-2 flex gap-1 ${selected ? 'text-white/60' : 'text-slate-400'}`}>
          {provider.capabilities.map((cap) => (
            <span key={cap} className={`rounded px-1.5 py-0.5 text-[10px] ${selected ? 'bg-white/20' : 'bg-slate-100'}`}>
              {cap === 'text' ? '文本' : '图片'}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

// 接口编辑组件
interface ProviderEditorProps {
  provider: LocalAiProvider;
  testResult: TestResult | null;
  testing: boolean;
  modelFilter: string;
  showAllTestModels: boolean;
  visibleTestModels: string[];
  filteredTestModels: string[];
  selectedKeyPreset: ProviderPreset | null;
  onUpdate: (patch: Partial<LocalAiProvider>) => void;
  onTest: () => void;
  onDelete: () => void;
  onModelFilterChange: (v: string) => void;
  onShowAllTestModels: () => void;
  onAddModel: (m: string) => void;
  onNextStep: () => void;
}

function ProviderEditor({
  provider,
  testResult,
  testing,
  modelFilter,
  showAllTestModels,
  visibleTestModels,
  filteredTestModels,
  selectedKeyPreset,
  onUpdate,
  onTest,
  onDelete,
  onModelFilterChange,
  onShowAllTestModels,
  onAddModel,
  onNextStep,
}: ProviderEditorProps) {
  const testedAndPassed = provider.testStatus === 'success' || testResult?.ok;

  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <div className='text-xs text-slate-500'>当前编辑</div>
          <h2 className='text-lg font-semibold text-slate-900'>{provider.name}</h2>
        </div>
        <div className='flex items-center gap-2'>
          <button
            type='button'
            onClick={onNextStep}
            disabled={!testedAndPassed}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              testedAndPassed ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}
          >
            下一步：用途分配 →
          </button>
        </div>
      </div>

      <div className='rounded-2xl border border-slate-200 bg-white p-6 space-y-5'>
        {/* 基础信息 */}
        <div className='space-y-4'>
          <h3 className='text-sm font-semibold text-slate-700'>基础信息</h3>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-1.5'>
              <label className='text-xs text-slate-500'>名称（你自己看得懂就行）</label>
              <input
                value={provider.name}
                onChange={(e) => onUpdate({ name: e.target.value })}
                className='h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400'
                placeholder='例如：豆包-标题 / OpenAI-生图'
              />
            </div>
            <div className='space-y-1.5'>
              <label className='text-xs text-slate-500'>接口地址 Base URL（OpenAI 兼容）</label>
              <input
                value={provider.baseUrl}
                onChange={(e) => onUpdate({ baseUrl: e.target.value })}
                className='h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400'
                placeholder='例如：https://api.openai.com/v1'
              />
            </div>
          </div>
        </div>

        {/* API Key */}
        <div className='space-y-3'>
          <h3 className='text-sm font-semibold text-slate-700'>API 密钥</h3>
          <input
            type='password'
            value={provider.apiKey}
            onChange={(e) => onUpdate({ apiKey: e.target.value })}
            className='h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400'
            placeholder='sk-...'
          />
          <div className='flex flex-wrap items-center gap-3'>
            <div className={`rounded-lg border px-3 py-1.5 text-xs ${selectedKeyPreset ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'}`}>
              {selectedKeyPreset ? `已识别：${selectedKeyPreset.name.split('（')[0]}` : '未识别平台'}
            </div>
            {selectedKeyPreset ? (
              <a
                href={selectedKeyPreset.keyUrl}
                target='_blank'
                rel='noreferrer'
                className='rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50'
              >
                打开 Key 申请页面 →
              </a>
            ) : null}
          </div>
          <div className='text-xs text-slate-400'>在平台创建 Key 后，粘贴到上方并点击「测试连接」</div>
        </div>

        {/* 支持能力 */}
        <div className='grid gap-4 md:grid-cols-2'>
          <div className='space-y-3'>
            <h3 className='text-sm font-semibold text-slate-700'>支持能力</h3>
            <div className='flex gap-4'>
              {(['text', 'image'] as const).map((cap) => (
                <label key={cap} className='flex items-center gap-2 text-sm text-slate-700'>
                  <input
                    type='checkbox'
                    checked={provider.capabilities.includes(cap)}
                    onChange={(e) => {
                      const next: AiProviderCapability[] = e.target.checked
                        ? Array.from(new Set([...provider.capabilities, cap]))
                        : provider.capabilities.filter((x) => x !== cap);
                      onUpdate({ capabilities: next });
                    }}
                    className='h-4 w-4 rounded border-slate-300'
                  />
                  <span>{cap === 'text' ? '文本' : '图片'}</span>
                </label>
              ))}
            </div>
            <div className='text-xs text-slate-400'>用途分配时会按能力过滤</div>
          </div>
          <div className='space-y-1.5'>
            <h3 className='text-sm font-semibold text-slate-700'>常用模型（可选）</h3>
            <input
              value={provider.models.join(', ')}
              onChange={(e) =>
                onUpdate({
                  models: e.target.value.split(',').map((x) => x.trim()).filter(Boolean),
                })
              }
              className='h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-slate-400'
              placeholder='例如：gpt-4o-mini, gpt-image-1'
            />
            <div className='text-xs text-slate-400'>多个模型用逗号分隔，也可留空后在测试时自动发现</div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className='flex flex-wrap items-center gap-3 pt-2'>
          <button
            type='button'
            onClick={onTest}
            disabled={testing || !provider.baseUrl.trim() || !provider.apiKey.trim()}
            className='h-10 rounded-full bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed'
          >
            {testing ? '测试中...' : '测试连接'}
          </button>
          <button
            type='button'
            onClick={onDelete}
            className='h-10 rounded-full border border-slate-200 bg-white px-5 text-sm text-slate-600 hover:bg-slate-50'
          >
            删除此接口
          </button>
          {testResult && (
            <span
              className={`rounded-full border px-3 py-2 text-xs ${testResult.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-700'}`}
            >
              {testResult.ok ? `连接成功${testResult.models?.length ? `（发现 ${testResult.models.length} 个模型）` : ''}` : `失败：${testResult.detail || 'unknown'}`}
            </span>
          )}
        </div>
      </div>

      {/* 可用模型列表 */}
      {testResult?.ok && testResult.models?.length ? (
        <div className='rounded-2xl border border-slate-200 bg-white p-5'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div>
              <h3 className='text-sm font-semibold text-slate-700'>可用模型</h3>
              <div className='mt-1 text-xs text-slate-500'>共 {filteredTestModels.length} 个模型，点击可加入常用模型</div>
            </div>
            <input
              value={modelFilter}
              onChange={(e) => onModelFilterChange(e.target.value)}
              className='h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-slate-400 md:w-56'
              placeholder='搜索模型名称...'
            />
          </div>
          <div className='mt-4 flex flex-wrap gap-2'>
            {visibleTestModels.map((m) => (
              <button
                key={m}
                type='button'
                onClick={() => onAddModel(m)}
                className='rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 hover:border-slate-300'
              >
                {m}
              </button>
            ))}
          </div>
          {!filteredTestModels.length ? (
            <div className='mt-3 text-xs text-slate-500'>没有匹配结果</div>
          ) : null}
          {!showAllTestModels && !modelFilter.trim() && filteredTestModels.length > visibleTestModels.length ? (
            <button
              type='button'
              onClick={onShowAllTestModels}
              className='mt-4 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs text-slate-600 hover:bg-slate-50'
            >
              展开剩余 {filteredTestModels.length - visibleTestModels.length} 个模型
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// 用途分配组件
interface PurposeAllocationProps {
  providers: LocalAiProvider[];
  routes: LocalAiRoute[];
  purposeGroups: { title: string; purposes: PurposeDefinition[] }[];
  customPurposeKey: string;
  customPurposeLabel: string;
  customPurposeCapability: AiProviderCapability;
  testResult: TestResult | null;
  selected: LocalAiProvider | null;
  onRouteChange: (purpose: AiPurpose, providerId: string, model: string) => void;
  onCustomPurposeKeyChange: (v: string) => void;
  onCustomPurposeLabelChange: (v: string) => void;
  onCustomPurposeCapabilityChange: (v: AiProviderCapability) => void;
  onAddCustomPurpose: () => void;
  onRemoveCustomPurpose: (purpose: AiPurpose) => void;
}

function PurposeAllocation({
  providers,
  routes,
  purposeGroups,
  customPurposeKey,
  customPurposeLabel,
  customPurposeCapability,
  testResult,
  selected,
  onRouteChange,
  onCustomPurposeKeyChange,
  onCustomPurposeLabelChange,
  onCustomPurposeCapabilityChange,
  onAddCustomPurpose,
  onRemoveCustomPurpose,
}: PurposeAllocationProps) {
  return (
    <div className='space-y-6'>
      <div className='flex items-center justify-between'>
        <div>
          <div className='text-xs text-slate-500'>第三步（共三步）</div>
          <h2 className='text-lg font-semibold text-slate-900'>用途分配</h2>
        </div>
        <div className='text-sm text-slate-500'>
          每个用途需同时选择「接口 + 模型」才生效
        </div>
      </div>

      {/* 已测试通过的接口 */}
      <div className='rounded-2xl border border-emerald-200 bg-emerald-50 p-4'>
        <div className='text-xs font-semibold text-emerald-700 mb-2'>已测试通过的接口（这些才能用于分配）</div>
        <div className='flex flex-wrap gap-2'>
          {providers.filter((p) => p.testStatus === 'success').length > 0 ? (
            providers.filter((p) => p.testStatus === 'success').map((p) => (
              <span key={p.id} className='rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs text-emerald-700'>
                {p.name}
              </span>
            ))
          ) : (
            <span className='text-xs text-emerald-600'>还没有测试通过的接口，请先在「编辑接口」中完成测试</span>
          )}
        </div>
      </div>

      {/* 用途分组 */}
      {purposeGroups.map((group) => (
        <div key={group.title} className='rounded-2xl border border-slate-200 bg-white p-5'>
          <div className='flex items-center gap-2 mb-4'>
            <span className='text-2xl'>{GROUP_ICONS[group.title] || '📋'}</span>
            <h3 className='text-base font-semibold text-slate-900'>{group.title}</h3>
            <span className='rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500'>{group.purposes.length}</span>
          </div>
          <div className='space-y-4'>
            {group.purposes.map((purposeDef) => (
              <PurposeRow
                key={purposeDef.key}
                purposeDef={purposeDef}
                current={routes.find((r) => r.purpose === purposeDef.key) || null}
                providers={providers}
                testResult={testResult}
                selected={selected}
                onChange={(providerId, model) => onRouteChange(purposeDef.key, providerId, model)}
                onRemove={!purposeDef.builtIn ? () => onRemoveCustomPurpose(purposeDef.key) : undefined}
              />
            ))}
          </div>
        </div>
      ))}

      {/* 新增扩展用途 */}
      <div className='rounded-2xl border border-slate-200 bg-white p-5'>
        <div className='flex items-center gap-2 mb-4'>
          <span className='text-2xl'>⚙️</span>
          <h3 className='text-base font-semibold text-slate-900'>新增扩展用途</h3>
        </div>
        <div className='text-xs text-slate-500 mb-4'>
          适合后续还没正式接入 UI 的链路先占位，例如新的提示词步骤、修图、OCR、审核等
        </div>
        <div className='flex flex-wrap gap-3'>
          <input
            value={customPurposeKey}
            onChange={(e) => onCustomPurposeKeyChange(e.target.value)}
            className='h-10 flex-1 min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400'
            placeholder='标识 key（英文）'
          />
          <input
            value={customPurposeLabel}
            onChange={(e) => onCustomPurposeLabelChange(e.target.value)}
            className='h-10 flex-1 min-w-[120px] rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400'
            placeholder='显示名称'
          />
          <select
            value={customPurposeCapability}
            onChange={(e) => onCustomPurposeCapabilityChange(e.target.value === 'image' ? 'image' : 'text')}
            className='h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400'
          >
            <option value='text'>文本</option>
            <option value='image'>图片</option>
          </select>
          <button
            type='button'
            onClick={onAddCustomPurpose}
            className='h-10 rounded-full bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800'
          >
            添加
          </button>
        </div>
      </div>
    </div>
  );
}

// 用途行组件
function PurposeRow({
  purposeDef,
  current,
  providers,
  testResult,
  selected,
  onChange,
  onRemove,
}: {
  purposeDef: PurposeDefinition;
  current: LocalAiRoute | null;
  providers: LocalAiProvider[];
  testResult: TestResult | null;
  selected: LocalAiProvider | null;
  onChange: (providerId: string, model: string) => void;
  onRemove?: () => void;
}) {
  const selectableProviders = providers.filter(
    (p) => p.capabilities.includes(purposeDef.capability) && p.testStatus === 'success',
  );
  const selectedProvider = current ? providers.find((p) => p.id === current.providerId) : null;
  const modelOptions = dedupeStrings([
    ...(selectedProvider?.models || []),
    ...(Array.isArray(testResult?.models) && selectedProvider?.id === selected?.id ? testResult.models : []),
  ]);

  return (
    <div className={`rounded-xl border p-4 ${current?.providerId && current?.model ? 'border-emerald-200 bg-emerald-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex-1 min-w-[200px]'>
          <div className='flex items-center gap-2'>
            <span className='text-sm font-medium text-slate-900'>{purposeDef.label}</span>
            {purposeDef.required && (
              <span className='rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] text-rose-600'>
                必配
              </span>
            )}
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${purposeDef.capability === 'text' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
              {purposeDef.capability === 'text' ? '文本' : '图片'}
            </span>
          </div>
          <div className='mt-1 text-xs text-slate-500'>{purposeDef.description}</div>
        </div>
        {onRemove && (
          <button
            type='button'
            onClick={onRemove}
            className='rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 hover:bg-slate-50'
          >
            删除
          </button>
        )}
      </div>
      <div className='mt-3 grid gap-2 md:grid-cols-[1fr_1fr]'>
        <select
          value={current?.providerId || ''}
          onChange={(e) => {
            const providerId = e.target.value;
            const provider = providers.find((p) => p.id === providerId);
            const model = provider?.models?.[0] || current?.model || '';
            onChange(providerId, model);
          }}
          className='h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400'
        >
          <option value=''>选择接口</option>
          {selectableProviders.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          value={current?.model || ''}
          onChange={(e) => onChange(current?.providerId || '', e.target.value)}
          list={`models-${purposeDef.key}`}
          className='h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-slate-400'
          placeholder='模型名（可手填）'
        />
        <datalist id={`models-${purposeDef.key}`}>
          {modelOptions.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>
      {current?.providerId && selectedProvider?.testStatus !== 'success' ? (
        <div className='mt-2 text-xs text-rose-600'>⚠️ 该接口未测试成功，不能用于此用途</div>
      ) : null}
      {current?.providerId && current?.model ? (
        <div className='mt-2 text-xs text-emerald-600'>✓ 已配置</div>
      ) : null}
    </div>
  );
}
