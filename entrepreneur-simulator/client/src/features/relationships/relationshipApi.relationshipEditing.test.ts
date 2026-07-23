import { afterEach, describe, expect, it, vi } from 'vitest';
import { relationshipApi } from './relationshipApi';

const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

const requestBody = (fetchMock: ReturnType<typeof vi.fn>, index: number) => JSON.parse(
  String((fetchMock.mock.calls[index][1] as RequestInit).body),
) as Record<string, unknown>;

describe('relationship editing API contract', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('updates a relationship context with optimistic versioning and maps dormant to sleep', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      id: 'context-1',
      attention_status: 'sleep',
      why_matters_now: '当前共同验证一个项目',
      version: 4,
      boundaries: ['不越过明确拒绝'],
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await relationshipApi.updateContext('context-1', {
      attentionStatus: 'dormant',
      whyMattersNow: '当前共同验证一个项目',
      currentState: '暂时不主动推进',
      currentGoal: '',
      mutualValue: '',
      boundaries: ['不越过明确拒绝'],
      expectedVersion: 3,
    });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/relationship-system/contexts/context-1');
    const body = requestBody(fetchMock, 0);
    expect(body).toMatchObject({ attentionStatus: 'sleep', expectedVersion: 3 });
    expect(body).not.toHaveProperty('userId');
    expect(result.attention_status).toBe('dormant');
  });

  it('keeps new judgments as user-confirmed hypotheses and maps explicit status changes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: 'claim-1',
        personId: 'person-1',
        context: '讨论合作时',
        statement: '对方更偏好明确分工',
        status: 'proposed',
        evidenceStrength: 'insufficient',
        evidence: [],
        alternativeExplanations: ['也可能只是这次时间紧'],
        version: 1,
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'claim-1',
        personId: 'person-1',
        context: '讨论合作时',
        statement: '对方更偏好明确分工',
        status: 'proposed',
        evidenceStrength: 'insufficient',
        evidence: [],
        version: 2,
      }));
    vi.stubGlobal('fetch', fetchMock);

    await relationshipApi.createClaim('person-1', {
      contextId: 'context-1',
      situation: '讨论合作时',
      statement: '对方更偏好明确分工',
      alternativeExplanations: ['也可能只是这次时间紧'],
    });
    await relationshipApi.updateClaim('claim-1', { status: 'proposed', expectedVersion: 1 });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/relationship-system/people/person-1/claims');
    expect(requestBody(fetchMock, 0)).toMatchObject({
      status: 'hypothesis',
      sourceType: 'user',
      userConfirmed: true,
    });
    expect(requestBody(fetchMock, 0)).not.toHaveProperty('userId');
    expect(requestBody(fetchMock, 1)).toMatchObject({ status: 'hypothesis', expectedVersion: 1 });
    expect(requestBody(fetchMock, 1)).not.toHaveProperty('userId');
  });

  it('maps supporting and counter evidence to the service vocabulary without changing claim status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'evidence-1' }));
    vi.stubGlobal('fetch', fetchMock);

    await relationshipApi.addClaimEvidence('claim-1', {
      direction: 'support',
      content: '对方在分工明确后当天确认并按时完成。',
      interactionId: 'interaction-1',
      occurredAt: '2026-07-15T12:00:00.000Z',
    });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/relationship-system/claims/claim-1/evidence');
    const body = requestBody(fetchMock, 0);
    expect(body).toMatchObject({ evidenceType: 'supports', interactionId: 'interaction-1' });
    expect(body).not.toHaveProperty('status');
    expect(body).not.toHaveProperty('userId');
  });

  it('keeps feelings separate from interpretations through extraction, confirmation and manual save', async () => {
    const interactionPayload = (id: string) => ({
      interaction: {
        id,
        personId: 'person-1',
        occurredAt: '2026-07-18T09:00:00.000Z',
        eventContext: '讨论小范围合作',
        observedFacts: ['对方询问了交付时间'],
        myFeelings: ['紧张', '期待'],
        interpretations: ['对方可能更在意时间可控性；也可能只是当天比较忙'],
        commitments: [],
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        proposal: {
          id: 'proposal-1',
          personId: 'person-1',
          occurredAt: '2026-07-18T09:00:00.000Z',
          eventContext: '讨论小范围合作',
          observedFacts: ['对方询问了交付时间'],
          myActions: ['我提出先做一次验证'],
          theirReactions: ['对方要求先看书面方案'],
          myFeelings: ['紧张', '期待'],
          interpretations: ['对方可能更在意时间可控性', '也可能只是当天比较忙'],
          commitments: [],
          opportunitySignals: [],
        },
      }))
      .mockResolvedValueOnce(jsonResponse(interactionPayload('interaction-confirmed')))
      .mockResolvedValueOnce(jsonResponse(interactionPayload('interaction-manual')));
    vi.stubGlobal('fetch', fetchMock);

    const draft = await relationshipApi.extractInteraction({
      personId: 'person-1',
      text: '我提出小范围合作，对方询问交付时间。',
      clientRequestId: 'extract-request-1',
    });
    expect(draft.my_feelings).toEqual(['紧张', '期待']);
    expect(draft.interpretation).toBe('对方可能更在意时间可控性；也可能只是当天比较忙');

    const confirmed = await relationshipApi.confirmInteraction({
      personId: 'person-1',
      clientRequestId: 'confirm-request-1',
      draft,
    });
    expect(requestBody(fetchMock, 1)).toMatchObject({
      personId: 'person-1',
      proposalId: 'proposal-1',
      clientRequestId: 'confirm-request-1',
      patch: {
        myFeelings: ['紧张', '期待'],
        interpretations: ['对方可能更在意时间可控性；也可能只是当天比较忙'],
      },
    });
    expect(confirmed.my_feelings).toEqual(['紧张', '期待']);
    expect(confirmed.interpretation).toBe('对方可能更在意时间可控性；也可能只是当天比较忙');

    const manual = await relationshipApi.saveManualInteraction({
      personId: 'person-1',
      clientRequestId: 'manual-request-1',
      draft: { ...draft, proposal_id: '' },
    });
    expect(fetchMock.mock.calls[2][0]).toBe('/api/relationship-system/people/person-1/interactions');
    expect(requestBody(fetchMock, 2)).toMatchObject({
      clientRequestId: 'manual-request-1',
      patch: {
        sourceType: 'manual',
        observedFacts: ['对方询问了交付时间'],
        myFeelings: ['紧张', '期待'],
        interpretations: ['对方可能更在意时间可控性；也可能只是当天比较忙'],
      },
    });
    expect(manual.my_feelings).toEqual(['紧张', '期待']);
    expect(manual.interpretation).toBe('对方可能更在意时间可控性；也可能只是当天比较忙');
  });
});
