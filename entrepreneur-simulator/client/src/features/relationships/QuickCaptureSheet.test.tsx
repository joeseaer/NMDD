import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuickCaptureSheet } from './QuickCaptureSheet';

const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

describe('QuickCaptureSheet', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('does not create a formal interaction until the user confirms the AI draft', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        warnings: ['AI 暂不可用；当前是规则整理草稿，请逐项核对。'],
        proposal: {
          id: 'proposal-1',
          status: 'draft',
          occurredAt: '2026-07-15T12:00:00.000Z',
          eventContext: '一次真实交流',
          observedFacts: ['对方询问了价格'],
          myActions: ['我提出小范围验证'],
          theirReactions: ['对方询问交付时间'],
          myFeelings: ['我有些期待'],
          interpretations: ['我认为存在兴趣，但仍需验证'],
          commitments: [],
          opportunitySignals: [{ summary: '对方正在寻找替代方案' }],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        interaction: {
          id: 'interaction-1',
          personId: 'person-1',
          occurredAt: '2026-07-15T12:00:00.000Z',
          observedFacts: ['对方询问了价格'],
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    render(<QuickCaptureSheet open personId="person-1" onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/刚才发生了什么/), { target: { value: '我提出一次小范围验证，对方问了价格。' } });
    fireEvent.click(screen.getByRole('button', { name: /AI 帮我整理/ }));

    await screen.findByText(/AI 暂不可用；当前是规则整理草稿/);
    expect(screen.getByText('下面仍是待确认草稿。只有点击“确认并保存”后，才会创建正式互动、承诺和机会信号。')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/relationship-system/interactions/extract');
    expect(screen.getByLabelText(/^我的感受/)).toHaveValue('我有些期待');
    expect(screen.getByLabelText(/^我的解释或判断/)).toHaveValue('我认为存在兴趣，但仍需验证');

    fireEvent.click(screen.getByRole('button', { name: '确认并保存' }));
    await screen.findByText('已经保存');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe('/api/relationship-system/interactions/confirm');

    const confirmBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)) as Record<string, unknown>;
    expect(confirmBody.proposalId).toBe('proposal-1');
    expect(typeof confirmBody.clientRequestId).toBe('string');
    const confirmPatch = confirmBody.patch as Record<string, unknown>;
    expect(confirmPatch.myFeelings).toEqual(['我有些期待']);
    expect(confirmPatch.interpretations).toEqual(['我认为存在兴趣，但仍需验证']);
    await waitFor(() => expect(screen.getByRole('button', { name: '完成' })).toBeEnabled());
  });

  it('can save a manually structured interaction without calling AI extraction', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      interaction: {
        id: 'interaction-manual',
        personId: 'person-1',
        occurredAt: '2026-07-15T12:00:00.000Z',
        observedFacts: ['对方明确说周五回复'],
        myFeelings: ['安心'],
        interpretations: ['对方愿意继续推进'],
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<QuickCaptureSheet open personId="person-1" onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText(/刚才发生了什么/), { target: { value: '对方明确说周五回复' } });
    fireEvent.click(screen.getByRole('button', { name: /手动整理/ }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/可观察事实/)).toHaveValue('对方明确说周五回复');
    fireEvent.change(screen.getByLabelText(/^我的感受/), { target: { value: '安心' } });
    fireEvent.change(screen.getByLabelText(/^我的解释或判断/), { target: { value: '对方愿意继续推进' } });
    fireEvent.click(screen.getByRole('button', { name: '确认并保存' }));

    await screen.findByText('已经保存');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/relationship-system/people/person-1/interactions');
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>;
    const patchBody = body.patch as Record<string, unknown>;
    expect(patchBody.myFeelings).toEqual(['安心']);
    expect(patchBody.interpretations).toEqual(['对方愿意继续推进']);
  });
});
