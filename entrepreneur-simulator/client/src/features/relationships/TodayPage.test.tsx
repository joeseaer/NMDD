import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TodayPage from './TodayPage';

const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

const baseCompass = (planningState: Record<string, unknown>) => ({
  id: 'compass-1',
  version: 2,
  title: '事业与处世罗盘',
  horizon_date: '2027-07-15',
  outcome_statement: '操盘一门月稳定现金流约 5 万元的业务。',
  success_metrics: ['真实项目', '客户付款', '稳定现金流'],
  current_assets: ['博士生身份', '长期写代码形成的技术能力'],
  current_constraints: ['存在经济压力', '需要与博士研究并行'],
  ninety_day_bet: '完成一次真实报价和付费验证。',
  non_negotiables: [],
  planning_state: planningState,
});

const rootNode = {
  id: 'root',
  parent_id: null,
  title: '验证真实需求',
  status: 'in_progress',
  sort_order: 0,
  current_fact: '已经找到一个问题方向。',
  completion_standard: '获得明确投入或付款信号。',
  missing_evidence: '还缺真实报价反馈。',
  next_validation: '向一位潜在客户提出报价。',
};

describe('TodayPage compass', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders a branching goal tree, automatically generates AI guidance, and keeps planner tasks read-only', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/relationship-system/compass' && (!init?.method || init.method === 'GET')) {
        return jsonResponse({
          data: baseCompass({
            schema_version: 1,
            current_node_id: 'root',
            nodes: [
              rootNode,
              { ...rootNode, id: 'branch-a', parent_id: 'root', title: '技术服务路线', status: 'planned', sort_order: 0 },
              { ...rootNode, id: 'branch-b', parent_id: 'root', title: '中介撮合路线', status: 'planned', sort_order: 1 },
            ],
            overall_gaps: [],
            stage_gaps: {
              root: [{
                id: 'interviews', label: '客户访谈', current_state: '已完成 1 次', target_state: '完成 5 次',
                primary_gap: '还差 4 次', next_evidence: '完成下一次访谈', current_value: 1, target_value: 5, unit: '次',
              }],
              'branch-a': [{
                id: 'prototype', label: '技术路线验证', current_state: '尚未报价', target_state: '完成一次技术服务报价',
                primary_gap: '缺少报价反馈', next_evidence: '发出报价', current_value: 0, target_value: 1, unit: '次',
              }],
            },
            daily_guidance: null,
          }),
        });
      }
      if (url === '/api/planner/items/user-1?view=today') {
        return jsonResponse([
          { id: 'task-1', type: 'task', title: '待办一', status: 'open', due_at: '2026-07-18T09:00:00.000Z' },
          { id: 'task-2', type: 'task', title: '待办二', status: 'open', due_at: '2026-07-18T10:00:00.000Z' },
          { id: 'task-3', type: 'task', title: '已完成待办', status: 'done', due_at: '2026-07-18T11:00:00.000Z' },
          { id: 'task-4', type: 'task', title: '待办三', status: 'open', due_at: '2026-07-18T12:00:00.000Z' },
          { id: 'task-5', type: 'task', title: '第四条开放待办', status: 'open', due_at: '2026-07-18T13:00:00.000Z' },
        ]);
      }
      if (url === '/api/relationship-system/compass/daily-guidance' && init?.method === 'POST') {
        return jsonResponse({
          available: true,
          cached: false,
          generated_at: new Date().toISOString(),
          guidance: {
            focus: '完成一次真实客户报价。',
            why: '当前最缺的是外部付费证据。',
            avoid: '不要继续扩大开发。',
            observe: '观察对方是否接受具体价格。',
            generated_at: new Date().toISOString(),
            sources: [{ type: 'goal', id: 'root', label: '当前目标' }],
            fallback: false,
          },
          source_status: {
            goals: { available: true, count: 3 },
            planner: { available: true, count: 3 },
            people: { available: true, count: 2 },
            interactions: { available: true, count: 4 },
            opportunities: { available: true, count: 1 },
            reviews: { available: true, count: 1 },
            life_documents: { available: false, count: 0, error: 'not available' },
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/relationships/today']}>
        <Routes>
          <Route path="/relationships/today" element={<TodayPage />} />
          <Route path="/planner" element={<div>已进入首页待办</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '罗盘' })).toBeInTheDocument();
    expect(screen.getByText('技术服务路线')).toBeInTheDocument();
    expect(screen.getByText('中介撮合路线')).toBeInTheDocument();
    expect(screen.getByText('客户访谈')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '技术服务路线' }));
    await waitFor(() => expect(screen.getAllByText('技术服务路线')).toHaveLength(2));
    expect(screen.getByRole('tab', { name: '所选阶段' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('技术路线验证')).toBeInTheDocument();
    expect(await screen.findByText('完成一次真实客户报价。')).toBeInTheDocument();
    expect(screen.getByText('人物资料 2')).toBeInTheDocument();
    expect(screen.getByText(/生活资料 0 · 未纳入/)).toBeInTheDocument();

    expect(screen.getByText('待办一')).toBeInTheDocument();
    expect(screen.getByText('待办二')).toBeInTheDocument();
    expect(screen.getByText('待办三')).toBeInTheDocument();
    expect(screen.queryByText('已完成待办')).not.toBeInTheDocument();
    expect(screen.queryByText('第四条开放待办')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /前往首页执行或调整/ }));
    expect(await screen.findByText('已进入首页待办')).toBeInTheDocument();
  });

  it('adds an editable child branch and saves the complete planning state atomically', async () => {
    const savedBodies: Array<Record<string, unknown>> = [];
    const planningState = {
      schema_version: 1,
      current_node_id: 'root',
      nodes: [rootNode],
      overall_gaps: [],
      stage_gaps: {},
      daily_guidance: {
        focus: '今天保持当前主线。', why: '目标清晰。', avoid: '不要分心。', observe: '观察反馈。',
        generated_at: new Date().toISOString(), sources: [], fallback: false,
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/relationship-system/compass' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        savedBodies.push(body);
        return jsonResponse({ data: { ...baseCompass(body.planningState as Record<string, unknown>), version: 3 } });
      }
      if (url === '/api/relationship-system/compass') return jsonResponse({ data: baseCompass(planningState) });
      if (url === '/api/planner/items/user-1?view=today') return jsonResponse([]);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MemoryRouter><TodayPage /></MemoryRouter>);
    expect((await screen.findAllByText('验证真实需求')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /子目标/ }));

    fireEvent.change(screen.getByLabelText('目标名称'), { target: { value: '科研工具服务支线' } });
    fireEvent.change(screen.getByLabelText('当前事实'), { target: { value: '已有原型。' } });
    fireEvent.change(screen.getByLabelText('完成标准'), { target: { value: '一位客户愿意付费。' } });
    fireEvent.change(screen.getByLabelText('还缺什么'), { target: { value: '缺少报价反馈。' } });
    fireEvent.change(screen.getByLabelText('下一步如何验证'), { target: { value: '发出第一份报价。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存目标' }));

    expect((await screen.findAllByText('科研工具服务支线')).length).toBeGreaterThan(0);
    await waitFor(() => expect(savedBodies).toHaveLength(1));
    const savedState = savedBodies[0].planningState as typeof planningState;
    const child = savedState.nodes.find((node) => node.title === '科研工具服务支线');
    expect(child).toMatchObject({
      parent_id: 'root',
      current_fact: '已有原型。',
      completion_standard: '一位客户愿意付费。',
      missing_evidence: '缺少报价反馈。',
      next_validation: '发出第一份报价。',
    });
    expect(savedBodies[0]).toMatchObject({
      title: '事业与处世罗盘',
      outcomeStatement: '操盘一门月稳定现金流约 5 万元的业务。',
      expectedVersion: 2,
    });
  });

  it('turns the old five-stage route into editable planning data only when planning_state is absent', async () => {
    const legacyCompass = baseCompass({});
    delete (legacyCompass as Partial<typeof legacyCompass>).planning_state;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/relationship-system/compass') return jsonResponse({ data: legacyCompass });
      if (url === '/api/planner/items/user-1?view=today') return jsonResponse([]);
      if (url === '/api/relationship-system/compass/daily-guidance' && init?.method === 'POST') {
        return jsonResponse({
          available: false,
          cached: false,
          guidance: {
            focus: '围绕当前阶段取得一个外部证据。', why: '当前最缺真实反馈。', avoid: '不要继续空想。', observe: '观察外部承诺。',
            generated_at: new Date().toISOString(), sources: [], fallback: true, warning: 'AI 暂不可用。',
          },
          source_status: {},
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MemoryRouter><TodayPage /></MemoryRouter>);
    expect((await screen.findAllByText('找到真实付费需求')).length).toBeGreaterThan(0);
    expect(screen.getByText('完成首次收费与交付')).toBeInTheDocument();
    expect(screen.getByText('客户访谈')).toBeInTheDocument();
    expect(await screen.findByText('AI 暂不可用。')).toBeInTheDocument();
  });

  it('caps deep-tree indentation and shows invalid numeric ranges without a misleading progress bar', async () => {
    const deepNodes = Array.from({ length: 8 }, (_, index) => ({
      ...rootNode,
      id: `level-${index + 1}`,
      parent_id: index === 0 ? null : `level-${index}`,
      title: `第 ${index + 1} 层目标`,
      status: index === 0 ? 'in_progress' : 'planned',
      sort_order: 0,
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/relationship-system/compass') {
        return jsonResponse({ data: baseCompass({
          schema_version: 1,
          current_node_id: 'level-1',
          nodes: deepNodes,
          overall_gaps: [],
          stage_gaps: {
            'level-8': [{
              id: 'zero-target', label: '边界指标', current_state: '当前为 1', target_state: '目标记录为 0',
              primary_gap: '需要重新校准目标', next_evidence: '修正目标值', current_value: 1, target_value: 0, unit: '次',
            }],
          },
          daily_guidance: null,
        }) });
      }
      if (url === '/api/planner/items/user-1?view=today') return jsonResponse([]);
      if (url === '/api/relationship-system/compass/daily-guidance' && init?.method === 'POST') {
        return jsonResponse({
          available: true, cached: true, based_on_compass_version: 1, compass_version: 2, persisted: true, stale: false,
          guidance: {
            focus: '检查深层目标。', why: '避免遗漏。', avoid: '不要错误量化。', observe: '观察指标。',
            generated_at: new Date().toISOString(), data_sources: [], sources: [], fallback: false,
          },
          source_status: {},
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MemoryRouter><TodayPage /></MemoryRouter>);
    const deepestButton = await screen.findByRole('button', { name: '第 8 层目标' });
    expect(deepestButton.parentElement?.style.paddingLeft).toBe('120px');
    fireEvent.click(deepestButton);
    expect(await screen.findByText('边界指标')).toBeInTheDocument();
    expect(screen.getByText('1次')).toBeInTheDocument();
    expect(screen.getByText('目标 0次')).toBeInTheDocument();
    expect(screen.queryByTestId('gap-progress-zero-target')).not.toBeInTheDocument();
    expect(await screen.findByText('检查深层目标。')).toBeInTheDocument();
    expect(screen.queryByText(/规划在生成期间已经更新/)).not.toBeInTheDocument();
  });

  it('discards an AI response started before an edit and adopts the persisted compass version from the next response', async () => {
    let resolveOldGuidance!: (response: Response) => void;
    const oldGuidanceResponse = new Promise<Response>((resolve) => { resolveOldGuidance = resolve; });
    let guidanceCalls = 0;
    const savedBodies: Array<Record<string, unknown>> = [];
    const planningState = {
      schema_version: 1,
      current_node_id: 'root',
      nodes: [rootNode],
      overall_gaps: [],
      stage_gaps: {},
      daily_guidance: null,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/relationship-system/compass' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        savedBodies.push(body);
        const version = savedBodies.length === 1 ? 3 : 5;
        return jsonResponse({ data: { ...baseCompass(body.planningState as Record<string, unknown>), version } });
      }
      if (url === '/api/relationship-system/compass') return jsonResponse({ data: baseCompass(planningState) });
      if (url === '/api/planner/items/user-1?view=today') return jsonResponse([]);
      if (url === '/api/relationship-system/compass/daily-guidance' && init?.method === 'POST') {
        guidanceCalls += 1;
        if (guidanceCalls === 1) return oldGuidanceResponse;
        return jsonResponse({
          available: true, cached: false, based_on_compass_version: 3, compass_version: 4, persisted: true, stale: false,
          guidance: {
            focus: '基于新支线的判断。', why: '规划已经更新。', avoid: '不要使用旧结论。', observe: '观察新支线反馈。',
            generated_at: new Date().toISOString(), snapshot_hash: 'new-snapshot', based_on_compass_version: 3,
            data_sources: [{ domain: 'goals', label: '目标与差距', count: 2, status: 'included' }],
            sources: [{ domain: 'goal', id: 'new-branch', label: '新支线' }], fallback: false,
          },
          source_status: { goals: { available: true, count: 2 } },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MemoryRouter><TodayPage /></MemoryRouter>);
    await screen.findByRole('button', { name: /子目标/ });
    await waitFor(() => expect(guidanceCalls).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: /子目标/ }));
    fireEvent.change(screen.getByLabelText('目标名称'), { target: { value: '生成期间新增的支线' } });
    fireEvent.click(screen.getByRole('button', { name: '保存目标' }));
    expect((await screen.findAllByText('生成期间新增的支线')).length).toBeGreaterThan(0);
    expect(savedBodies[0]).toMatchObject({ expectedVersion: 2 });
    expect((savedBodies[0].planningState as { daily_guidance: unknown }).daily_guidance).toBeNull();

    resolveOldGuidance(jsonResponse({
      available: true, cached: false, based_on_compass_version: 2, compass_version: 3, persisted: true, stale: false,
      guidance: {
        focus: '不应出现的旧判断。', why: '旧数据。', avoid: '旧建议。', observe: '旧信号。',
        generated_at: new Date().toISOString(), data_sources: [], sources: [], fallback: false,
      },
      source_status: {},
    }));
    await waitFor(() => expect(screen.queryByText('不应出现的旧判断。')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    expect(await screen.findByText('基于新支线的判断。')).toBeInTheDocument();
    expect(screen.getAllByText(/新支线/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
    fireEvent.change(screen.getByLabelText('当前事实'), { target: { value: 'AI 返回后继续编辑。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存目标' }));
    await waitFor(() => expect(savedBodies).toHaveLength(2));
    expect(savedBodies[1]).toMatchObject({ expectedVersion: 4 });
    expect((savedBodies[1].planningState as { daily_guidance: unknown }).daily_guidance).toBeNull();
  });
});
