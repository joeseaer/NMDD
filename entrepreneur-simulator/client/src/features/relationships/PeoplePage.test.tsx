import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PeoplePage from './PeoplePage';

const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

const peopleOverview = {
  generatedAt: '2026-07-18T08:00:00.000Z',
  cached: true,
  recommendationRun: {
    id: 'run-1',
    generatedAt: '2026-07-18T08:00:00.000Z',
    snapshotHash: 'snapshot-1',
    status: 'ai',
    sourceStatus: {
      goals: { available: true, count: 3 },
      interactions: { available: true, count: 7 },
      reviews: { available: false, count: 0, error: 'not ready' },
    },
    recommendationCount: 1,
  },
  recommendations: [{
    id: 'recommendation-1',
    personId: 'person-recommended',
    status: 'pending',
    reason: '她正在决定是否启动一个与你能力高度相关的项目。',
    whyNow: '当前存在一个短暂的合作窗口，需要先验证真实意愿。',
    lifeDomains: ['事业', '朋友'],
    observeNext: '提出一个小范围试合作后，她是否愿意约定明确时间。',
    confidence: 'moderate',
    version: 2,
    evidenceRefs: [{ type: 'interaction', ref: 'interaction:1', label: '最近一次项目讨论', summary: '对方主动询问了交付方式。' }],
    person: {
      id: 'person-recommended',
      name: '林经理',
      identity: '朋友、潜在合作伙伴',
      relationshipRoles: ['朋友', '合作伙伴'],
      attentionState: 'observe',
      currentAttention: false,
      attentionLayer: 'library',
      primaryContextId: 'context-recommended',
      contextVersion: 3,
    },
  }],
  attentionPeople: [{
    id: 'person-current',
    name: '王老师',
    identity: '导师',
    relationshipRoles: ['导师'],
    attentionState: 'focus',
    currentAttention: true,
    attentionLayer: 'current',
    primaryContextId: 'context-current',
    contextVersion: 4,
    focusReason: '论文方向和后续资源连接都与他有关。',
    observeNext: '带着两个方案汇报时，他是否愿意给出具体反馈。',
    lastInteractionAt: '2026-07-17T08:00:00.000Z',
  }],
  libraryPeople: [{
    id: 'person-library',
    name: '陈同学',
    identity: '实验室同学',
    relationshipRoles: ['朋友', '同学'],
    attentionState: 'maintain',
    currentAttention: false,
    attentionLayer: 'library',
    primaryContextId: 'context-library',
    contextVersion: 1,
    focusReason: '',
    observeNext: '',
    lastInteractionAt: '2026-07-10T08:00:00.000Z',
  }],
  counts: { trackedPeople: 3, currentAttention: 1, relationshipLibrary: 2, pendingRecommendations: 1 },
};

const personWorkspace = {
  person: {
    id: 'person-current',
    name: '王老师',
    identity: '导师与长期合作伙伴',
    relationshipRoles: ['导师', '合作伙伴'],
    attentionState: 'repair',
  },
  contexts: [{
    id: 'context-current',
    isPrimary: true,
    version: 4,
    attentionStatus: 'repair',
    whyMattersNow: '近期需要澄清合作分工，也要继续推进论文。',
    currentState: '有合作基础，但上次沟通留下了分工误解。',
    currentGoal: '澄清分工，并确认下一次论文讨论的时间。',
    observeNext: '我说明分工边界后，对方是否愿意复述并确认。',
    mutualValue: '我提供可靠执行，对方提供方向反馈。',
    boundaries: ['不在现场答应无法兑现的额外工作。'],
  }],
  brief: {
    currentState: '有合作基础，但上次沟通留下了分工误解。',
    recentChange: '对方推迟了一次约定的讨论。',
    currentGoal: '澄清分工，并确认下一次论文讨论的时间。',
    observeNext: '我说明分工边界后，对方是否愿意复述并确认。',
  },
  interactionGuide: [{
    id: 'claim-supported',
    personId: 'person-current',
    situation: '讨论复杂任务时',
    statement: '先给两个清晰方案，比开放式追问更容易得到具体反馈。',
    status: 'supported',
    evidenceStrength: 'behavior_supported',
    evidence: [{ id: 'evidence-1', sourceType: 'interaction', evidenceType: 'supports', excerpt: '连续两次都选择了其中一个方案。' }],
    suggestedApproach: '先压缩选择范围，再邀请对方修改。',
  }],
  hypotheses: [{
    id: 'claim-testing',
    personId: 'person-current',
    situation: '需要拒绝额外工作时',
    statement: '只要同时说明可替代方案，对方可能更容易接受边界。',
    status: 'testing',
    evidenceStrength: 'initial',
    evidence: [{ id: 'evidence-testing', sourceType: 'interaction', evidenceType: 'supports', excerpt: '上次提供替代安排后，对方接受了调整。' }],
    alternativeExplanations: ['也可能只是上次时间恰好宽松。'],
  }, {
    id: 'claim-no-evidence',
    personId: 'person-current',
    situation: '临时提出请求时',
    statement: '对方可能更偏好当天回应。',
    status: 'testing',
    evidenceStrength: 'insufficient',
    evidence: [],
  }],
  inactiveClaims: [{
    id: 'claim-retired',
    personId: 'person-current',
    situation: '早期印象',
    statement: '对方总是不愿意给出明确反馈。',
    status: 'retired',
    evidenceStrength: 'mixed',
    evidence: [],
  }],
  decisions: [{
    id: 'decision-current',
    personId: 'person-current',
    goal: '澄清分工，并确认下一次论文讨论的时间。',
    chosenAction: '先发一页分工草案，再约一次十五分钟确认。',
    boundaries: ['不在现场答应无法兑现的额外工作。'],
    stopConditions: ['对方连续两次拒绝确认具体分工。'],
    status: 'chosen',
  }],
  commitments: [
    { id: 'commitment-1', title: '周五前发送一页分工草案', owner: 'me', status: 'open', dueAt: '2026-07-20T08:00:00.000Z' },
    { id: 'commitment-2', title: '对方确认下一次讨论时间', owner: 'them', status: 'open', dueAt: '2026-07-21T08:00:00.000Z' },
    { id: 'commitment-3', title: '共同核对论文修改范围', owner: 'shared', status: 'open', dueAt: '2026-07-22T08:00:00.000Z' },
    { id: 'commitment-4', title: '第四项不应出现在紧凑摘要', owner: 'me', status: 'open', dueAt: '2026-07-23T08:00:00.000Z' },
  ],
  interactions: [
    { id: 'interaction-1', personId: 'person-current', occurredAt: '2026-07-18T08:00:00.000Z', eventContext: '论文讨论', observedFacts: ['对方主动追问了方案二的交付时间。'], myFeelings: ['紧张', '得到重视'], interpretation: '对方可能更关注时间可控性。' },
    { id: 'interaction-2', personId: 'person-current', occurredAt: '2026-07-17T08:00:00.000Z', observedFacts: ['对方确认收到了分工草案。'] },
    { id: 'interaction-3', personId: 'person-current', occurredAt: '2026-07-16T08:00:00.000Z', observedFacts: ['对方把讨论推迟到下周。'] },
    { id: 'interaction-4', personId: 'person-current', occurredAt: '2026-07-15T08:00:00.000Z', observedFacts: ['第四次互动不应出现在紧凑摘要。'] },
  ],
  relatedPeople: [],
};

describe('PeoplePage overview', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('makes the default people route a complete attention overview and keeps AI suggestions user-confirmed', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/relationship-system/people/overview') return jsonResponse({ data: peopleOverview });
      if (url === '/api/relationship-system/people/attention-recommendations/recommendation-1/decision' && init?.method === 'POST') {
        return jsonResponse({ data: {
          recommendation: { ...peopleOverview.recommendations[0], status: 'accepted', version: 3 },
          person: {
            ...peopleOverview.recommendations[0].person,
            attentionState: 'focus',
            attentionLayer: 'current',
            currentAttention: true,
            focusReason: peopleOverview.recommendations[0].whyNow,
            observeNext: peopleOverview.recommendations[0].observeNext,
          },
        } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/relationships/people']}>
        <Routes><Route path="/relationships/people" element={<PeoplePage />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '人物' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'AI 待确认建议' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '当前关注' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '关系库' })).toBeInTheDocument();
    expect(screen.queryByText('选择一个人物')).not.toBeInTheDocument();
    expect(screen.queryByText('理解与证据')).not.toBeInTheDocument();

    const recommendationCard = screen.getByText('林经理').closest('article');
    expect(recommendationCard).not.toBeNull();
    expect(within(recommendationCard!).getByText('当前存在一个短暂的合作窗口，需要先验证真实意愿。')).toBeInTheDocument();
    expect(within(recommendationCard!).getByText('提出一个小范围试合作后，她是否愿意约定明确时间。')).toBeInTheDocument();
    expect(screen.getByText('AI 已生成')).toBeInTheDocument();
    fireEvent.click(screen.getByText('查看读取范围'));
    expect(screen.getByText('目标与差距 3')).toBeInTheDocument();
    expect(screen.getByText('复盘 0 · 未读取')).toBeInTheDocument();

    fireEvent.click(within(recommendationCard!).getByRole('button', { name: '加入关注' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const decisionCall = fetchMock.mock.calls[1];
    expect(decisionCall[0]).toBe('/api/relationship-system/people/attention-recommendations/recommendation-1/decision');
    expect(JSON.parse(String((decisionCall[1] as RequestInit).body))).toMatchObject({
      decision: 'accept',
      reason: peopleOverview.recommendations[0].whyNow,
      observeNext: peopleOverview.recommendations[0].observeNext,
      expectedVersion: 2,
    });
    expect(screen.queryByText('编辑后加入')).not.toBeInTheDocument();
    expect(screen.getAllByText('林经理').length).toBeGreaterThan(0);
  });

  it('lets the user edit current attention, manually add from the library, and search without exposing the person workbench', async () => {
    const patchBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/relationship-system/people/overview') return jsonResponse({ data: peopleOverview });
      if (url.startsWith('/api/relationship-system/people/') && url.endsWith('/attention') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        patchBodies.push(body);
        const isCurrent = url.includes('person-current');
        const source = isCurrent ? peopleOverview.attentionPeople[0] : peopleOverview.libraryPeople[0];
        return jsonResponse({ data: { person: {
          ...source,
          attentionState: 'focus',
          currentAttention: true,
          attentionLayer: 'current',
          focusReason: body.focusReason,
          observeNext: body.observeNext,
        } } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MemoryRouter><PeoplePage /></MemoryRouter>);
    const currentCard = (await screen.findByText('王老师')).closest('article');
    expect(currentCard).not.toBeNull();
    fireEvent.click(within(currentCard!).getByRole('button', { name: '调整' }));
    fireEvent.change(screen.getByLabelText('为什么现在关注'), { target: { value: '近期需要校准论文方向。' } });
    fireEvent.change(screen.getByLabelText(/下一次只观察什么/), { target: { value: '观察对方是否认可两个备选方案。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存调整' }));
    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).toMatchObject({
      attentionState: 'focus',
      focusReason: '近期需要校准论文方向。',
      observeNext: '观察对方是否认可两个备选方案。',
      contextId: 'context-current',
      expectedVersion: 4,
    });

    fireEvent.change(screen.getByLabelText('搜索关系库'), { target: { value: '不存在的人' } });
    expect(screen.queryByText('陈同学')).not.toBeInTheDocument();
    expect(screen.getByText('没有符合条件的人物')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索关系库'), { target: { value: '' } });
    const libraryCard = screen.getByText('陈同学').closest('article');
    expect(libraryCard).not.toBeNull();
    fireEvent.click(within(libraryCard!).getByRole('button', { name: '加入关注' }));
    fireEvent.change(screen.getByLabelText('为什么现在关注'), { target: { value: '近期需要互相支持实验安排。' } });
    fireEvent.change(screen.getByLabelText(/下一次只观察什么/), { target: { value: '提出互助安排后，对方是否主动确认时间。' } });
    fireEvent.click(screen.getByRole('button', { name: '加入当前关注' }));
    await waitFor(() => expect(patchBodies).toHaveLength(2));
    expect(patchBodies[1]).toMatchObject({ attentionState: 'focus', contextId: 'context-library', expectedVersion: 1 });
    expect(screen.queryByText('陈同学')).toBeInTheDocument();
  });

  it('opens the editor instead of accepting an incomplete AI recommendation', async () => {
    const incomplete = {
      ...peopleOverview,
      recommendations: [{ ...peopleOverview.recommendations[0], whyNow: '', reason: '', observeNext: '' }],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/relationship-system/people/overview') return jsonResponse({ data: incomplete });
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MemoryRouter><PeoplePage /></MemoryRouter>);
    const recommendationCard = (await screen.findByText('林经理')).closest('article');
    fireEvent.click(within(recommendationCard!).getByRole('button', { name: '加入关注' }));
    const dialog = screen.getByRole('dialog', { name: '确认关注 林经理' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveClass('max-h-[92dvh]', 'flex-col');
    expect(dialog.querySelector('.overflow-y-auto')).not.toBeNull();
    expect(dialog.querySelector('header')).toHaveClass('shrink-0');
    expect(dialog.querySelector('footer')).toHaveClass('shrink-0');
    expect(screen.getByRole('button', { name: '确认并加入' })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never demotes repair or boundary relationships through the overview card', async () => {
    const guardedOverview = {
      ...peopleOverview,
      recommendations: [],
      attentionPeople: [
        peopleOverview.attentionPeople[0],
        {
          ...peopleOverview.attentionPeople[0],
          id: 'person-repair',
          name: '待修复关系',
          attentionState: 'repair',
          focusReason: '近期存在需要澄清的误会。',
          observeNext: '观察一次真诚说明后，对方是否愿意继续沟通。',
        },
        {
          ...peopleOverview.attentionPeople[0],
          id: 'person-boundary',
          name: '边界关系',
          attentionState: 'boundary',
          focusReason: '当前需要保护时间与责任边界。',
          observeNext: '观察明确拒绝后，对方是否尊重边界。',
        },
      ],
      counts: { ...peopleOverview.counts, currentAttention: 3, pendingRecommendations: 0 },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/relationship-system/people/overview') return jsonResponse({ data: guardedOverview });
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MemoryRouter><PeoplePage /></MemoryRouter>);
    const focusCard = (await screen.findByText('王老师')).closest('article');
    const repairCard = screen.getByText('待修复关系').closest('article');
    const boundaryCard = screen.getByText('边界关系').closest('article');
    expect(within(focusCard!).getByRole('button', { name: '移回关系库' })).toBeInTheDocument();
    expect(within(repairCard!).queryByRole('button', { name: '移回关系库' })).not.toBeInTheDocument();
    expect(within(boundaryCard!).queryByRole('button', { name: '移回关系库' })).not.toBeInTheDocument();
    expect(within(repairCard!).getByText('相处策略需在人物页调整')).toBeInTheDocument();
    expect(within(boundaryCard!).getByText('相处策略需在人物页调整')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('removes a pending recommendation when the same person is manually added from the library', async () => {
    const libraryPerson = peopleOverview.libraryPeople[0];
    const recommendation = {
      ...peopleOverview.recommendations[0],
      id: 'recommendation-library',
      personId: libraryPerson.id,
      person: libraryPerson,
    };
    const duplicateOverview = {
      ...peopleOverview,
      recommendations: [recommendation],
      counts: { ...peopleOverview.counts, pendingRecommendations: 1 },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/relationship-system/people/overview') return jsonResponse({ data: duplicateOverview });
      if (url === '/api/relationship-system/people/person-library/attention' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({ data: { person: {
          ...libraryPerson,
          attentionState: 'focus',
          attentionLayer: 'current',
          currentAttention: true,
          focusReason: body.focusReason,
          observeNext: body.observeNext,
        } } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MemoryRouter><PeoplePage /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: '编辑后加入' })).toBeInTheDocument();
    const libraryRows = screen.getAllByText('陈同学').map((node) => node.closest('article')).filter(Boolean);
    const libraryRow = libraryRows.find((node) => within(node!).queryByText(/最近互动/));
    expect(libraryRow).toBeDefined();
    fireEvent.click(within(libraryRow!).getByRole('button', { name: '加入关注' }));
    fireEvent.change(screen.getByLabelText('为什么现在关注'), { target: { value: '近期需要一起协调实验。' } });
    fireEvent.change(screen.getByLabelText(/下一次只观察什么/), { target: { value: '对方是否愿意确认明确时间。' } });
    fireEvent.click(screen.getByRole('button', { name: '加入当前关注' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: '编辑后加入' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '暂不关注' })).not.toBeInTheDocument();
    expect(screen.getByText('本轮没有建议新增关注')).toBeInTheDocument();
    const currentHeadingRow = screen.getByRole('heading', { name: '当前关注' }).parentElement;
    expect(within(currentHeadingRow!).getByText('2')).toBeInTheDocument();
  });

  it('generates from the explicit empty state and never presents a fallback as AI output', async () => {
    const initial = { ...peopleOverview, recommendations: [], recommendationRun: null };
    const fallback = {
      ...initial,
      cached: false,
      recommendationRun: {
        id: 'run-fallback',
        generatedAt: '2026-07-18T09:00:00.000Z',
        status: 'fallback',
        warning: 'AI 暂时不可用，本次只做了基础筛选。',
        sourceStatus: { people: { available: true, count: 3 } },
        recommendationCount: 0,
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/relationship-system/people/overview') return jsonResponse({ data: initial });
      if (url === '/api/relationship-system/people/attention-recommendations/generate' && init?.method === 'POST') return jsonResponse({ data: fallback });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MemoryRouter><PeoplePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '生成一次建议' }));
    expect(await screen.findByText('基础筛选 · 非 AI')).toBeInTheDocument();
    expect(screen.queryByText('AI 已生成')).not.toBeInTheDocument();
    expect(screen.getByText('AI 暂时不可用，本次只做了基础筛选。')).toBeInTheDocument();
    const body = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)) as Record<string, unknown>;
    expect(body).toEqual({ refresh: false });
  });
});

describe('PeoplePage person workbench', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const renderWorkbench = () => render(
    <MemoryRouter initialEntries={['/relationships/people/person-current/overview']}>
      <Routes>
        <Route path="/relationships/people/:personId/:tab" element={<PeoplePage />} />
        <Route path="/relationships/people" element={<div>已返回人物总览</div>} />
      </Routes>
    </MemoryRouter>,
  );

  it('uses the first screen for one relationship judgment and keeps the workbench full-width and compact', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/relationship-system/people/person-current/workspace') return jsonResponse({ data: personWorkspace });
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWorkbench();

    expect(await screen.findByRole('heading', { name: '王老师' })).toBeInTheDocument();
    expect(screen.queryByText('关系地图')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回人物总览' })).toBeVisible();
    expect(screen.getByRole('button', { name: '返回人物总览' })).not.toHaveClass('lg:hidden');

    const core = screen.getByTestId('relationship-judgment-core');
    expect(within(core).getByText('我现在想达成什么')).toBeInTheDocument();
    expect(within(core).getByText('我准备怎么做')).toBeInTheDocument();
    expect(within(core).getByText('下一次只观察什么')).toBeInTheDocument();
    expect(within(core).getByText('澄清分工，并确认下一次论文讨论的时间。')).toBeInTheDocument();
    expect(within(core).getByText('先发一页分工草案，再约一次十五分钟确认。')).toBeInTheDocument();
    expect(within(core).queryByText('当前关系状态')).not.toBeInTheDocument();
    expect(screen.getByText(/不在现场答应无法兑现的额外工作。/)).toBeInTheDocument();
    expect(screen.getByText(/对方连续两次拒绝确认具体分工。/)).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: '我目前怎么理解这个人' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '已验证的相处方式' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '待验证假设' })).toBeInTheDocument();
    expect(screen.getByText('这只是待观察的问题，不是对这个人的定论。')).toBeInTheDocument();

    expect(screen.getByText('周五前发送一页分工草案')).toBeInTheDocument();
    expect(screen.queryByText('第四项不应出现在紧凑摘要')).not.toBeInTheDocument();
    expect(screen.getByText('对方主动追问了方案二的交付时间。')).toBeInTheDocument();
    expect(screen.queryByText('第四次互动不应出现在紧凑摘要。')).not.toBeInTheDocument();

    const workspace = screen.getByTestId('person-workspace');
    expect(workspace).toHaveClass('overflow-x-hidden');
    expect(screen.getAllByRole('button', { name: '记录互动' })[0]).toHaveClass('w-full', 'sm:w-auto');
    expect(core).toHaveClass('grid', 'lg:grid-cols-3');
    const tablist = screen.getByRole('navigation', { name: '人物工作台页签' });
    expect(tablist).toHaveClass('overflow-x-auto');
    ['现在怎么相处', '当前理解', '决定与结果', '互动记录'].forEach((label) => {
      expect(within(tablist).getByRole('button', { name: label })).toBeInTheDocument();
    });
  });

  it('keeps active understanding separate from historical conclusions and separates feelings from interpretation', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/relationship-system/people/person-current/workspace') return jsonResponse({ data: personWorkspace });
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWorkbench();
    await screen.findByRole('heading', { name: '王老师' });

    fireEvent.click(screen.getByRole('button', { name: '当前理解' }));
    expect(await screen.findByRole('heading', { name: '校准当前理解' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '历史结论' })).toBeInTheDocument();
    expect(screen.getByText('对方总是不愿意给出明确反馈。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '互动记录' }));
    expect(await screen.findByRole('heading', { name: '互动时间线' })).toBeInTheDocument();
    expect(screen.getByText(/我的感受：/).closest('p')).toHaveTextContent('紧张；得到重视');
    expect(screen.getByText(/我的解释或判断：/).closest('p')).toHaveTextContent('对方可能更关注时间可控性。');

    fireEvent.click(screen.getByRole('button', { name: '返回人物总览' }));
    expect(await screen.findByText('已返回人物总览')).toBeInTheDocument();
  });

  it('round-trips the next observation and preserves repair or boundary attention states when editing the brief', async () => {
    const patchBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/relationship-system/people/person-current/workspace') return jsonResponse({ data: personWorkspace });
      if (url === '/api/relationship-system/contexts/context-current' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        patchBodies.push(body);
        return jsonResponse({ data: { context: { ...personWorkspace.contexts[0], ...body } } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWorkbench();
    await screen.findByRole('heading', { name: '王老师' });
    fireEvent.click(screen.getByRole('button', { name: '调整关系简报' }));

    expect(screen.getByLabelText('关注状态')).toHaveValue('repair');
    const observeField = screen.getByLabelText(/下一次只观察什么/);
    expect(observeField).toHaveValue('我说明分工边界后，对方是否愿意复述并确认。');
    fireEvent.change(observeField, { target: { value: '明确边界后，对方是否愿意确认新的分工。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存简报' }));

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).toMatchObject({
      attentionStatus: 'repair',
      observeNext: '明确边界后，对方是否愿意确认新的分工。',
      expectedVersion: 4,
    });
  });

  it('requires evidence for supported status and records explicit user confirmation', async () => {
    const patchBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/relationship-system/people/person-current/workspace') return jsonResponse({ data: personWorkspace });
      if (url === '/api/relationship-system/claims/claim-testing' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        patchBodies.push(body);
        return jsonResponse({ data: { claim: { ...personWorkspace.hypotheses[0], ...body } } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWorkbench();
    await screen.findByRole('heading', { name: '王老师' });
    fireEvent.click(screen.getByRole('button', { name: '当前理解' }));
    await screen.findByRole('heading', { name: '校准当前理解' });

    const noEvidenceSelect = screen.getByLabelText(/对方可能更偏好当天回应/);
    const noEvidenceSupported = within(noEvidenceSelect).getByRole('option', { name: '已有支持' });
    expect(noEvidenceSupported).toBeDisabled();

    const supportedSelect = screen.getByLabelText(/只要同时说明可替代方案/);
    fireEvent.change(supportedSelect, { target: { value: 'supported' } });
    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).toMatchObject({ status: 'supported', userConfirmed: true });
  });
});
