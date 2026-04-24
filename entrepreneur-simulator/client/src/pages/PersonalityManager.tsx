import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, User, Calendar, MessageSquare, Brain, X, Save, Edit2, Phone, MapPin, Zap, ThumbsUp, Activity, AlertCircle, Lock, Cake, Upload, Users, Clock, Eye, EyeOff, Briefcase, GraduationCap, Coffee, Compass, Crown, ChevronDown, ChevronUp, Bot, ArrowLeft, Check, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../services/api';

// --- Constants ---
const CATEGORIES = [
  { id: 'noble', label: '贵人/恩师', icon: <Crown className="w-4 h-4" /> },
  { id: 'mentor', label: '导师/前辈', icon: <Compass className="w-4 h-4" /> },
  { id: 'partner', label: '合作伙伴', icon: <Briefcase className="w-4 h-4" /> },
  { id: 'peer', label: '同学/同侪', icon: <GraduationCap className="w-4 h-4" /> },
  { id: 'expert', label: '行业专家', icon: <Activity className="w-4 h-4" /> },
  { id: 'friend', label: '普通朋友', icon: <Coffee className="w-4 h-4" /> }
];

// --- Components ---

const RelationshipTrendChart = ({ logs, currentScore }: { logs: any[], currentScore: number }) => {
    // Calculate trend: start from current score and go backwards
    // limit to last 10 points
    const sortedLogs = [...logs].sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime()).slice(0, 10);
    
    let score = currentScore;
    const points = [{ date: 'Now', score }];
    
    sortedLogs.forEach(log => {
        score -= (log.relationship_change || 0);
        points.unshift({ date: log.event_date, score });
    });
    
    // Normalize points for SVG (width 100, height 40)
    // Score range 0-100
    const width = 120;
    const height = 40;
    
    const polylinePoints = points.map((p, i) => {
        const x = (i / (points.length - 1 || 1)) * width;
        const y = height - (p.score / 100) * height;
        return `${x},${y}`;
    }).join(' ');

    return (
        <div className="flex flex-col items-end">
            <svg width={width} height={height} className="overflow-visible">
                <polyline 
                    points={polylinePoints} 
                    fill="none" 
                    stroke="#8b5cf6" 
                    strokeWidth="2" 
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                {points.map((p, i) => (
                     <circle 
                        key={i} 
                        cx={(i / (points.length - 1 || 1)) * width} 
                        cy={height - (p.score / 100) * height} 
                        r="2" 
                        fill="#8b5cf6" 
                    />
                ))}
            </svg>
            <span className="text-[10px] text-gray-400 mt-1">近期趋势</span>
        </div>
    );
};

export default function PersonalityManager() {
  const [people, setPeople] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPerson, setSelectedPerson] = useState<any>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const [logs, setLogs] = useState<any[]>([]);
  const [isAddingLog, setIsAddingLog] = useState(false);
  const [editingLog, setEditingLog] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);

  // New States
  const [showPrivate, setShowPrivate] = useState(true); 
  const [generatedScript, setGeneratedScript] = useState<string[] | null>(null);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [showRelatedModal, setShowRelatedModal] = useState(false);
  const [showAllRelated, setShowAllRelated] = useState(false);
  const [activeCategory, setActiveCategory] = useState('全部'); // Updated: Category filter
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [summaryData, setSummaryData] = useState<any>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string>('');
  const [strategySuggestion, setStrategySuggestion] = useState<any>(null);
  const [strategySuggesting, setStrategySuggesting] = useState(false);
  const [strategyEvaluation, setStrategyEvaluation] = useState<any>(null);
  const [strategyEvaluating, setStrategyEvaluating] = useState(false);
  const [practicalScenesLoading, setPracticalScenesLoading] = useState(false);
  const [trafficRedDraft, setTrafficRedDraft] = useState<any[]>([]);
  const [trafficGreenDraft, setTrafficGreenDraft] = useState<any[]>([]);
  const [trafficSaving, setTrafficSaving] = useState(false);
  const trafficSaveTimerRef = useRef<any>(null);
  const [scenarioCards, setScenarioCards] = useState<any[]>([]);
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [scenarioGenerating, setScenarioGenerating] = useState(false);
  const [scenarioInput, setScenarioInput] = useState('');
  const [scenarioCategory, setScenarioCategory] = useState('职场协作');
  const [scenarioCategoryCustom, setScenarioCategoryCustom] = useState('');
  const [scenarioActingId, setScenarioActingId] = useState<string | null>(null);
  const [scenarioEditingId, setScenarioEditingId] = useState<string | null>(null);
  const [scenarioEditDraft, setScenarioEditDraft] = useState<any>(null);
  const [scenarioEditSaving, setScenarioEditSaving] = useState(false);
  const [scenarioDeletingId, setScenarioDeletingId] = useState<string | null>(null);
  const [trafficEditTarget, setTrafficEditTarget] = useState<{ kind: 'red' | 'green'; index: number } | null>(null);
  const [trafficEditText, setTrafficEditText] = useState('');
  const [mapProposal, setMapProposal] = useState<any>(null);
  const behaviorHabitsRef = useRef<HTMLTextAreaElement | null>(null);
  const lifeTrajectoryRef = useRef<HTMLTextAreaElement | null>(null);

  const BASIC_EXTRA_ICON_KEYS = useMemo(() => ([
    'MapPin',
    'MessageSquare',
    'Calendar',
    'Phone',
    'Coffee',
    'Briefcase',
    'GraduationCap',
    'Compass',
    'Crown',
    'Activity',
    'Zap',
    'ThumbsUp',
  ]), []);

  const renderBasicExtraIcon = (key: string | undefined) => {
    const k = String(key || '').trim();
    const props = { className: 'w-4 h-4 text-gray-400' };
    switch (k) {
      case 'MapPin': return <MapPin {...props} />;
      case 'MessageSquare': return <MessageSquare {...props} />;
      case 'Calendar': return <Calendar {...props} />;
      case 'Phone': return <Phone {...props} />;
      case 'Coffee': return <Coffee {...props} />;
      case 'Briefcase': return <Briefcase {...props} />;
      case 'GraduationCap': return <GraduationCap {...props} />;
      case 'Compass': return <Compass {...props} />;
      case 'Crown': return <Crown {...props} />;
      case 'Activity': return <Activity {...props} />;
      case 'Zap': return <Zap {...props} />;
      case 'ThumbsUp': return <ThumbsUp {...props} />;
      default: return <MapPin {...props} />;
    }
  };

  const pickRandomBasicExtraIcon = () => {
    const i = Math.floor(Math.random() * BASIC_EXTRA_ICON_KEYS.length);
    return BASIC_EXTRA_ICON_KEYS[i] || 'MapPin';
  };

  const createBasicExtraItem = () => {
    const id = (globalThis.crypto && 'randomUUID' in globalThis.crypto)
      ? (globalThis.crypto as any).randomUUID()
      : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    return { id, icon: pickRandomBasicExtraIcon(), label: '', value: '' };
  };

  const [reactionLibraryDraft, setReactionLibraryDraft] = useState<any[]>([]);
  const [reactionSaving, setReactionSaving] = useState(false);
  const [reactionSavedAt, setReactionSavedAt] = useState<number | null>(null);
  const reactionSaveTimerRef = useRef<any>(null);

  const defaultProfileAnalysis = useMemo(() => ({
    layer_1_core: {
      personality_traits: '',
      core_values: '',
      cognitive_mode: '',
      emotional_energy: '',
    },
    layer_2_drive: {
      motivation_system: '',
      skills_capabilities: '',
      resource_network: '',
    },
    layer_3_surface: {
      behavior_habits: '',
      life_trajectory: '',
      current_status_path: '',
    },
    strategy_layer: {
      relation_positioning: '',
      relation_priority: '',
      relation_stage: '',
      short_term_goal_30d: '',
      mid_term_goal_90d: '',
      expected_rhythm: '',
      channel_preference: '',
      contact_frequency: '',
      preferred_topics: '',
      taboo_topics: '',
      weekly_time_budget_hours: '',
      money_budget_monthly: '',
      boundaries_red_lines: '',
      strategy_status: '',
      strategy_confidence: '',
      weekly_action_plan: '',
      expected_feedback_signals: '',
      weekly_review_result: '',
      deviation_reason: '',
      next_week_adjustment: '',
      invested_time_hours_month: '',
      invested_money_month: '',
      gained_value_score: '',
      strategy_roi_score: '',
      system_recommendation: '',
      updated_at: '',
    },
  }), []);

  const [analysisDraft, setAnalysisDraft] = useState<any>(defaultProfileAnalysis);
  const [, setSavedAt] = useState<Record<string, number>>({});
  const [, setSavingField] = useState<string | null>(null);
  const saveTimersRef = useRef<Record<string, any>>({});
  const latestAnalysisRef = useRef<any>(defaultProfileAnalysis);
  const [verificationChecklists, setVerificationChecklists] = useState<any>({});
  const [verificationLoading, setVerificationLoading] = useState<Record<string, boolean>>({});
  const verificationTimersRef = useRef<Record<string, any>>({});
  const checklistInitRef = useRef<string | null>(null);
  const activeSummaryPersonIdRef = useRef<string>('');
  const summaryRequestSeqRef = useRef(0);

  useEffect(() => {
    latestAnalysisRef.current = analysisDraft;
  }, [analysisDraft]);

  const parsePrivateInfo = (privateInfo: any) => {
    if (!privateInfo || typeof privateInfo !== 'string') return { analysis: defaultProfileAnalysis, verification: {} };
    const raw = privateInfo.trim();
    if (!raw) return { analysis: defaultProfileAnalysis, verification: {} };
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') {
        return {
          analysis: {
            layer_1_core: { ...defaultProfileAnalysis.layer_1_core, ...(obj.layer_1_core || {}) },
            layer_2_drive: { ...defaultProfileAnalysis.layer_2_drive, ...(obj.layer_2_drive || {}) },
            layer_3_surface: { ...defaultProfileAnalysis.layer_3_surface, ...(obj.layer_3_surface || {}) },
            strategy_layer: { ...defaultProfileAnalysis.strategy_layer, ...(obj.strategy_layer || {}) },
          },
          verification: obj.verification_checklists && typeof obj.verification_checklists === 'object' ? obj.verification_checklists : {},
        };
      }
    } catch {}
    return {
      analysis: {
        ...defaultProfileAnalysis,
        layer_3_surface: { ...defaultProfileAnalysis.layer_3_surface, current_status_path: raw },
      },
      verification: {},
    };
  };

  const parsePrivateInfoObject = (privateInfo: any) => {
    if (!privateInfo || typeof privateInfo !== 'string') return {};
    const raw = privateInfo.trim();
    if (!raw) return {};
    try {
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? obj : {};
    } catch {
      return {};
    }
  };

  const normalizeTrafficList = (arr: any[], fallbackSource: string) => {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((it) => {
        if (typeof it === 'string') return { text: it.trim(), source: fallbackSource };
        if (!it || typeof it !== 'object') return null;
        const text = String(it.text || it.content || '').trim();
        if (!text) return null;
        const source = String(it.source || fallbackSource || 'manual');
        return { text, source };
      })
      .filter(Boolean);
  };

  const readTrafficFromPerson = (person: any) => {
    const parsed = parsePrivateInfoObject(person?.private_info);
    const traffic = parsed?.traffic_lights && typeof parsed.traffic_lights === 'object' ? parsed.traffic_lights : {};
    const red = normalizeTrafficList(
      traffic.red || (Array.isArray(person?.triggers) ? person.triggers : []),
      'manual'
    );
    const green = normalizeTrafficList(
      traffic.green || (Array.isArray(person?.pleasers) ? person.pleasers : []),
      'manual'
    );
    return { red, green, parsed };
  };

  const saveTrafficLights = (nextRed: any[], nextGreen: any[]) => {
    if (!selectedPerson) return;
    if (trafficSaveTimerRef.current) clearTimeout(trafficSaveTimerRef.current);
    trafficSaveTimerRef.current = setTimeout(async () => {
      setTrafficSaving(true);
      try {
        const red = normalizeTrafficList(nextRed, 'manual');
        const green = normalizeTrafficList(nextGreen, 'manual');
        const parsed = parsePrivateInfoObject(selectedPerson.private_info);
        const nextPrivate = {
          ...(parsed || {}),
          traffic_lights: { red, green, updated_at: new Date().toISOString() },
        };
        await api.updatePerson(selectedPerson.id, {
          ...selectedPerson,
          private_info: JSON.stringify(nextPrivate),
        });
        const updated = { ...selectedPerson, private_info: JSON.stringify(nextPrivate) };
        setSelectedPerson(updated);
        setPeople((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        setEditForm((prev: any) => (prev && prev.id === updated.id ? { ...prev, private_info: updated.private_info } : prev));
      } catch (err) {
        console.error('Failed to save traffic lights', err);
      } finally {
        setTrafficSaving(false);
      }
    }, 800);
  };

  const fetchScenarioCards = async (personId: string) => {
    try {
      setScenarioLoading(true);
      const res = await api.getScenarioCards(personId);
      setScenarioCards(Array.isArray(res?.items) ? res.items : []);
    } catch (err) {
      console.error('Failed to fetch scenario cards', err);
      setScenarioCards([]);
    } finally {
      setScenarioLoading(false);
    }
  };

  const hasAnyText = (obj: any) => {
    if (!obj || typeof obj !== 'object') return false;
    return Object.values(obj).some((v: any) => typeof v === 'string' ? v.trim() : false);
  };

  const scheduleEnsureChecklist = (layerKey: string, force: boolean = false) => {
    if (!selectedPerson) return;
    const analysis = latestAnalysisRef.current;
    if (!hasAnyText(analysis?.[layerKey])) return;
    if (verificationTimersRef.current[layerKey]) clearTimeout(verificationTimersRef.current[layerKey]);
    verificationTimersRef.current[layerKey] = setTimeout(async () => {
      setVerificationLoading((prev) => ({ ...prev, [layerKey]: true }));
      try {
        const res = await api.ensureVerificationChecklist(selectedPerson.id, layerKey, force);
        setVerificationChecklists((prev: any) => ({
          ...(prev || {}),
          [layerKey]: {
            ...(prev?.[layerKey] || {}),
            items: Array.isArray(res?.items) ? res.items : [],
            hash: res?.hash,
            generated_at: new Date().toISOString(),
          },
        }));

        setSelectedPerson((p: any) => {
          if (!p || p.id !== selectedPerson.id) return p;
          try {
            const base = p.private_info && typeof p.private_info === 'string' ? JSON.parse(p.private_info) : {};
            const next = {
              ...(base && typeof base === 'object' ? base : {}),
              verification_checklists: {
                ...((base && typeof base === 'object' && base.verification_checklists) ? base.verification_checklists : {}),
                [layerKey]: { hash: res?.hash, items: Array.isArray(res?.items) ? res.items : [], generated_at: new Date().toISOString() },
              },
            };
            return { ...p, private_info: JSON.stringify(next) };
          } catch {
            return p;
          }
        });
      } catch (e) {
        console.error('Failed to ensure verification checklist', e);
      } finally {
        setVerificationLoading((prev) => ({ ...prev, [layerKey]: false }));
      }
    }, 800);
  };

  useEffect(() => {
    if (!selectedPerson) return;
    const parsed = parsePrivateInfo(selectedPerson.private_info);
    const traffic = readTrafficFromPerson(selectedPerson);
    setAnalysisDraft(parsed.analysis);
    latestAnalysisRef.current = parsed.analysis;
    setVerificationChecklists(parsed.verification);
    setTrafficRedDraft(traffic.red);
    setTrafficGreenDraft(traffic.green);
    setMapProposal(null);
    checklistInitRef.current = null;
    setSavedAt({});
    setSavingField(null);
    setReactionLibraryDraft(Array.isArray(selectedPerson.reaction_library) ? selectedPerson.reaction_library : []);
    setReactionSaving(false);
    setReactionSavedAt(null);
    setShowAllRelated(false);
    setStrategySuggestion(null);
    setStrategyEvaluation(null);
    fetchScenarioCards(selectedPerson.id);
  }, [selectedPerson?.id]);

  useEffect(() => {
    if (!selectedPerson) return;
    if (checklistInitRef.current === selectedPerson.id) return;
    checklistInitRef.current = selectedPerson.id;
    ['layer_1_core', 'layer_2_drive', 'layer_3_surface'].forEach((layerKey) => {
      const existing = verificationChecklists?.[layerKey];
      if (existing && Array.isArray(existing.items) && existing.items.length > 0) return;
      scheduleEnsureChecklist(layerKey, false);
    });
  }, [selectedPerson?.id]);

  const normalizeReactionLibrary = (items: any[]) => {
    if (!Array.isArray(items)) return [];
    return items
      .map((it) => {
        if (!it || typeof it !== 'object') return { scene: '', reaction: '' };
        return {
          scene: typeof it.scene === 'string' ? it.scene : '',
          reaction: typeof it.reaction === 'string' ? it.reaction : '',
        };
      })
      .filter((it) => it.scene.trim() || it.reaction.trim());
  };

  const scheduleSaveReactionLibrary = (next: any[]) => {
    if (!selectedPerson) return;
    if (reactionSaveTimerRef.current) clearTimeout(reactionSaveTimerRef.current);
    reactionSaveTimerRef.current = setTimeout(async () => {
      setReactionSaving(true);
      try {
        const normalized = normalizeReactionLibrary(next);
        await api.updatePersonReactionLibrary(selectedPerson.id, normalized);
        const updated = { ...selectedPerson, reaction_library: normalized };
        setSelectedPerson(updated);
        setPeople((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        setEditForm((prev: any) => (prev && prev.id === updated.id ? { ...prev, reaction_library: normalized } : prev));
        const now = Date.now();
        setReactionSavedAt(now);
        setTimeout(() => {
          setReactionSavedAt((cur) => (cur === now ? null : cur));
        }, 2000);
      } catch (err) {
        console.error('Failed to save reaction library', err);
      } finally {
        setReactionSaving(false);
      }
    }, 1500);
  };

  const updateReactionItem = (index: number, patch: any) => {
    setReactionLibraryDraft((prev) => {
      const next = Array.isArray(prev) ? [...prev] : [];
      const current = next[index] && typeof next[index] === 'object' ? next[index] : { scene: '', reaction: '' };
      next[index] = { ...current, ...patch };
      scheduleSaveReactionLibrary(next);
      return next;
    });
  };

  const addReactionItem = () => {
    setReactionLibraryDraft((prev) => {
      const next = Array.isArray(prev) ? [...prev, { scene: '', reaction: '' }] : [{ scene: '', reaction: '' }];
      scheduleSaveReactionLibrary(next);
      return next;
    });
  };

  const removeReactionItem = (index: number) => {
    setReactionLibraryDraft((prev) => {
      const next = Array.isArray(prev) ? prev.filter((_, i) => i !== index) : [];
      scheduleSaveReactionLibrary(next);
      return next;
    });
  };

  const autosaveAnalysis = async (next: any, fieldKey: string) => {
    if (!selectedPerson) return;
    setSavingField(fieldKey);
    try {
      await api.updatePersonProfileAnalysis(selectedPerson.id, next);
      const now = Date.now();
      setSavedAt((prev) => ({ ...prev, [fieldKey]: now }));
      setTimeout(() => {
        setSavedAt((prev) => {
          if (prev[fieldKey] !== now) return prev;
          const { [fieldKey]: _, ...rest } = prev;
          return rest;
        });
      }, 2000);
      const json = JSON.stringify({ ...next, verification_checklists: verificationChecklists || {} });
      setSelectedPerson((p: any) => (p && p.id === selectedPerson.id ? { ...p, private_info: json } : p));
      setPeople((prev) => prev.map((p) => (p.id === selectedPerson.id ? { ...p, private_info: json } : p)));
      setEditForm((prev: any) => (prev && prev.id === selectedPerson.id ? { ...prev, private_info: json } : prev));

      const layerKey = String(fieldKey || '').split('.')[0];
      if (layerKey) scheduleEnsureChecklist(layerKey, false);
    } catch (e) {
      console.error('Failed to autosave profile analysis', e);
    } finally {
      setSavingField((cur) => (cur === fieldKey ? null : cur));
    }
  };

  const setAnalysisField = (path: string, value: string) => {
    setAnalysisDraft((prev: any) => {
      const next = {
        ...prev,
        [path.split('.')[0]]: {
          ...(prev?.[path.split('.')[0]] || {}),
          [path.split('.')[1]]: value,
        },
      };
      return next;
    });

    if (saveTimersRef.current[path]) clearTimeout(saveTimersRef.current[path]);
    saveTimersRef.current[path] = setTimeout(() => {
      const current = latestAnalysisRef.current;
      const [layer, key] = path.split('.');
      const next = {
        ...current,
        [layer]: {
          ...(current?.[layer] || {}),
          [key]: value,
        },
      };
      autosaveAnalysis(next, path);
    }, 1500);
  };

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  };

  const formatStrategyVersion = (raw: any) => {
    const text = String(raw || '').trim();
    if (!text) return '未设置';
    const dt = new Date(text);
    if (Number.isNaN(dt.getTime())) return text;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
  };

  useEffect(() => {
    if (behaviorHabitsRef.current) autoResize(behaviorHabitsRef.current);
    if (lifeTrajectoryRef.current) autoResize(lifeTrajectoryRef.current);
  }, [
    selectedPerson?.id,
    analysisDraft?.layer_3_surface?.behavior_habits,
    analysisDraft?.layer_3_surface?.life_trajectory,
  ]);

  const fetchSummary = async (personId: string, forceRefresh: boolean = false): Promise<string | null> => {
      const requestSeq = ++summaryRequestSeqRef.current;
      activeSummaryPersonIdRef.current = personId;
      setSummaryLoading(true);
      setSummaryError('');
      try {
          const data = await api.getPersonSummary(personId, forceRefresh);
          if (summaryRequestSeqRef.current !== requestSeq || activeSummaryPersonIdRef.current !== personId) return null;
          setSummaryData(data);
          return null;
      } catch (err) {
          if (summaryRequestSeqRef.current !== requestSeq || activeSummaryPersonIdRef.current !== personId) return null;
          console.error("Failed to fetch summary", err);
          const detail = err instanceof Error ? err.message : '获取每日内参失败（未知错误）';
          setSummaryError(detail);
          setSummaryData(null);
          return detail;
      } finally {
          if (summaryRequestSeqRef.current !== requestSeq || activeSummaryPersonIdRef.current !== personId) return null;
          setSummaryLoading(false);
      }
  };

  const handleGeneratePracticalScenes = async () => {
    if (!selectedPerson) return;
    setPracticalScenesLoading(true);
    try {
      const result = await api.generatePracticalScenes(selectedPerson.id);
      const triggers = Array.isArray(result?.triggers) ? result.triggers : [];
      const pleasers = Array.isArray(result?.pleasers) ? result.pleasers : [];

      const updated = { ...selectedPerson, triggers, pleasers };
      setSelectedPerson(updated);
      setPeople(prev => prev.map(p => p.id === updated.id ? updated : p));
      setEditForm((prev: any) => (prev && prev.id === updated.id ? { ...prev, triggers, pleasers } : prev));
    } catch (err) {
      console.error('Failed to generate practical scenes', err);
      alert('生成失败，请稍后重试');
    } finally {
      setPracticalScenesLoading(false);
    }
  };

  const fetchPeople = async () => {
    try {
      setLoading(true);
      const data = await api.getAllPeople();
      const peopleList = Array.isArray(data) ? data : [];
      setPeople(peopleList);
      if (!selectedPerson && peopleList.length > 0) {
        handleSelectPerson(peopleList[0]);
      } else if (selectedPerson) {
         // Update selected person data if it changed
         const updated = peopleList.find((p: any) => p.id === selectedPerson.id);
         if (updated) setSelectedPerson(updated);
      }
    } catch (error) {
      console.error("Failed to fetch people", error);
      setPeople([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async (personId: string) => {
      try {
          const data = await api.getInteractionLogs(personId);
          setLogs(Array.isArray(data) ? data : []);
      } catch (error) {
          console.error("Failed to fetch logs", error);
          setLogs([]);
      }
  }

  const handleSelectPerson = (person: any) => {
      if (!person) return;
      setSelectedPerson(person);
      setEditForm(person); // Initialize form with person data
      setIsEditing(false);
      setSummaryData(null);
      activeSummaryPersonIdRef.current = person.id;
      fetchLogs(person.id);
      fetchSummary(person.id);
  }

  const handleRefreshSummary = async () => {
    if (!selectedPerson?.id || summaryLoading) return;
    const errMsg = await fetchSummary(selectedPerson.id, true);
    if (errMsg) {
      alert(`手动刷新失败：\n${errMsg}`);
    }
  };

  const handleRecommendStrategy = async () => {
    if (!selectedPerson?.id || strategySuggesting) return;
    setStrategySuggesting(true);
    try {
      const data = await api.generateStrategySuggestion(selectedPerson.id);
      setStrategySuggestion(data || null);
    } catch (err) {
      console.error('Failed to generate strategy suggestion', err);
      alert(err instanceof Error ? err.message : '生成策略建议失败');
    } finally {
      setStrategySuggesting(false);
    }
  };

  const handleEvaluateStrategy = async () => {
    if (!selectedPerson?.id || strategyEvaluating) return;
    setStrategyEvaluating(true);
    try {
      const data = await api.evaluateStrategy(selectedPerson.id);
      setStrategyEvaluation(data || null);
    } catch (err) {
      console.error('Failed to evaluate strategy', err);
      alert(err instanceof Error ? err.message : '策略评估失败');
    } finally {
      setStrategyEvaluating(false);
    }
  };

  // New: Handle Avatar Upload (Mock for now or use Base64 if small)
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files && e.target.files[0];
      if (!file || !selectedPerson) return;
      try {
          let uploadFile: File = file;
          if (file.size > 2 * 1024 * 1024 && file.type.startsWith('image/')) {
              const bmp = await createImageBitmap(file);
              const max = 900;
              const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
              const w = Math.max(1, Math.round(bmp.width * scale));
              const h = Math.max(1, Math.round(bmp.height * scale));
              const canvas = document.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d');
              if (ctx) ctx.drawImage(bmp, 0, 0, w, h);
              const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
              if (blob) {
                  uploadFile = new File([blob], file.name.replace(/\.(png|jpg|jpeg|webp|gif)$/i, '.jpg'), { type: 'image/jpeg' });
              }
          }
          const uploaded = await api.uploadImage(uploadFile);
          const imageUrl = uploaded?.url;
          if (!imageUrl) throw new Error('上传失败：未返回图片地址');
          const updated = { ...selectedPerson, avatar_real: imageUrl, avatar_type: 'real' };
          await api.updatePerson(selectedPerson.id, updated);
          setSelectedPerson(updated);
          setPeople(prev => prev.map(p => p.id === updated.id ? updated : p));
      } catch (err: any) {
          console.error('Avatar upload failed', err);
          alert(err?.message || '头像上传失败');
      } finally {
          e.target.value = '';
      }
  };

  // New: Handle AI Avatar Generation
  const handleAIAvatar = async () => {
      if (!selectedPerson) return;
      const prompt = `A professional portrait of ${selectedPerson.name}, ${selectedPerson.identity}, ${selectedPerson.disc_type} personality, realistic style, high quality`;
      // Use Trae's image generation URL pattern
      const imageUrl = `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${encodeURIComponent(prompt)}&image_size=square_hd`;
      
      const updated = { ...selectedPerson, avatar_ai: imageUrl, avatar_type: 'ai' };
      await api.updatePerson(selectedPerson.id, updated);
      setSelectedPerson(updated);
      setPeople(prev => prev.map(p => p.id === updated.id ? updated : p));
  };

  // New: Generate Scripts
  const handleGenerateScript = async () => {
      if (!selectedPerson) return;
      setScriptLoading(true);
      try {
          const result = await api.generateScript(selectedPerson.id);
          setGeneratedScript(result.scripts || []);
      } catch (err) {
          console.error(err);
          alert("生成话术失败");
      } finally {
          setScriptLoading(false);
      }
  };

  // New: Smart Follow-up Logic (Now powered by AI & Backend)
  const [generatingAIFollowUp, setGeneratingAIFollowUp] = useState<string | null>(null);

  const handleRefreshAIFollowUp = async (e: React.MouseEvent, personId: string) => {
      e.stopPropagation();
      if (generatingAIFollowUp === personId) return;
      setGeneratingAIFollowUp(personId);
      try {
          const res = await api.generateAIFollowUpSuggestion(personId);
          if (res?.suggestion) {
              setPeople(prev => prev.map(p => p.id === personId ? { ...p, ai_followup_suggestion: res.suggestion } : p));
              if (selectedPerson?.id === personId) {
                  setSelectedPerson((prev: any) => ({ ...prev, ai_followup_suggestion: res.suggestion }));
              }
          }
      } catch (err) {
          console.error('Failed to generate AI follow-up', err);
          const msg = err instanceof Error ? err.message : '刷新建议失败';
          alert(msg);
      } finally {
          setGeneratingAIFollowUp(null);
      }
  };

  const renderAIFollowUpTag = (person: any) => {
      const suggestion = (() => {
          const raw = person.ai_followup_suggestion;
          if (!raw) return null;
          if (typeof raw === 'string') {
              try { return JSON.parse(raw); } catch { return null; }
          }
          return raw;
      })();
      const isGenerating = generatingAIFollowUp === person.id;
      
      return (
          <div className="mt-2 flex items-center gap-2" onClick={e => e.stopPropagation()}>
              {suggestion ? (
                  <div className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] ${suggestion.color || 'bg-gray-100 text-gray-700'}`}>
                      {suggestion.label}
                  </div>
              ) : (
                  <div className="inline-flex items-center px-2 py-0.5 rounded text-[10px] bg-gray-50 text-gray-400">
                      无建议
                  </div>
              )}
              <button 
                  onClick={(e) => handleRefreshAIFollowUp(e, person.id)}
                  disabled={isGenerating}
                  className={`text-[10px] text-gray-400 hover:text-primary transition-colors ${isGenerating ? 'animate-spin' : ''}`}
                  title="让AI重新生成建议"
              >
                  <Bot className="w-3 h-3" />
              </button>
          </div>
      );
  };

  // ... (rest of the component)


  useEffect(() => {
    fetchPeople();
  }, []);

  const handleCreateSuccess = () => {
    fetchPeople();
    setIsCreating(false);
  };

  const refreshSelectedPersonAfterLogChange = async () => {
      if (!selectedPerson) return;
      await fetchLogs(selectedPerson.id);
      try {
          const data = await api.getAllPeople();
          const updated = data.find((p: any) => p.id === selectedPerson.id);
          if (updated) {
              setSelectedPerson(updated);
              setPeople(prev => prev.map(p => p.id === updated.id ? updated : p));
          }
      } catch (err) {
          console.error("Failed to refresh people list", err);
      }
  };

  const handleLogAdded = async (created?: any) => {
      if (selectedPerson) {
          await refreshSelectedPersonAfterLogChange();
          if (created?.proposal) setMapProposal(created.proposal);
          if (Array.isArray(created?.proposals) && created.proposals.length > 0) {
            const first = created.proposals.find((x: any) => x?.proposal)?.proposal;
            if (first) setMapProposal(first);
          }
      }
      setIsAddingLog(false);
      setEditingLog(null);
  }

  const handleDeleteLog = async (logId: string | number) => {
    const ok = window.confirm('确认删除这条互动记录吗？');
    if (!ok) return;
    try {
      await api.deleteInteractionLog(logId);
      await refreshSelectedPersonAfterLogChange();
    } catch (err) {
      console.error('Failed to delete log', err);
      alert('删除失败');
    }
  };

  const updateTrafficItem = (kind: 'red' | 'green', index: number, patch: any) => {
    if (kind === 'red') {
      setTrafficRedDraft((prev) => {
        const next = Array.isArray(prev) ? [...prev] : [];
        const current = next[index] && typeof next[index] === 'object' ? next[index] : { text: '', source: 'manual' };
        next[index] = { ...current, ...patch };
        saveTrafficLights(next, trafficGreenDraft);
        return next;
      });
      return;
    }
    setTrafficGreenDraft((prev) => {
      const next = Array.isArray(prev) ? [...prev] : [];
      const current = next[index] && typeof next[index] === 'object' ? next[index] : { text: '', source: 'manual' };
      next[index] = { ...current, ...patch };
      saveTrafficLights(trafficRedDraft, next);
      return next;
    });
  };

  const addTrafficItem = (kind: 'red' | 'green', source: string = 'manual', text: string = '') => {
    if (kind === 'red') {
      setTrafficRedDraft((prev) => {
        const next = [...(Array.isArray(prev) ? prev : []), { text, source }];
        saveTrafficLights(next, trafficGreenDraft);
        return next;
      });
      return;
    }
    setTrafficGreenDraft((prev) => {
      const next = [...(Array.isArray(prev) ? prev : []), { text, source }];
      saveTrafficLights(trafficRedDraft, next);
      return next;
    });
  };

  const removeTrafficItem = (kind: 'red' | 'green', index: number) => {
    if (kind === 'red') {
      setTrafficRedDraft((prev) => {
        const next = (Array.isArray(prev) ? prev : []).filter((_: any, i: number) => i !== index);
        saveTrafficLights(next, trafficGreenDraft);
        return next;
      });
      return;
    }
    setTrafficGreenDraft((prev) => {
      const next = (Array.isArray(prev) ? prev : []).filter((_: any, i: number) => i !== index);
      saveTrafficLights(trafficRedDraft, next);
      return next;
    });
  };

  const startTrafficEdit = (kind: 'red' | 'green', index: number, currentText: string) => {
    setTrafficEditTarget({ kind, index });
    setTrafficEditText(currentText || '');
  };

  const saveTrafficEdit = () => {
    if (!trafficEditTarget) return;
    const nextText = String(trafficEditText || '').trim();
    if (trafficEditTarget.kind === 'red') {
      updateTrafficItem('red', trafficEditTarget.index, { text: nextText });
    } else {
      updateTrafficItem('green', trafficEditTarget.index, { text: nextText });
    }
    setTrafficEditTarget(null);
    setTrafficEditText('');
  };

  const handleGenerateScenarioCard = async () => {
    if (!selectedPerson) return;
    const query = scenarioInput.trim();
    if (!query) {
      alert('请先输入要预演的场景');
      return;
    }
    const finalCategory = (scenarioCategory === '自定义分类' ? scenarioCategoryCustom : scenarioCategory).trim();
    if (!finalCategory) {
      alert('请先选择或填写分类');
      return;
    }
    setScenarioGenerating(true);
    try {
      const res = await api.generateScenarioSimulation(selectedPerson.id, { query, category: finalCategory });
      const item = res?.item;
      if (item) {
        setScenarioCards((prev) => [item, ...(Array.isArray(prev) ? prev : [])]);
        setScenarioInput('');
      }
    } catch (err) {
      console.error('Failed to generate scenario card', err);
      alert('生成剧本失败，请稍后重试');
    } finally {
      setScenarioGenerating(false);
    }
  };

  const handleScenarioVerdict = async (sopId: string, verdict: 'accept' | 'reject') => {
    if (!selectedPerson || !sopId) return;
    const prevCards = scenarioCards || [];
    const optimistic = prevCards.map((x: any) => ((x.sop_id || x.id) === sopId ? { ...x, verdict } : x));
    setScenarioCards(optimistic);
    setScenarioActingId(sopId);
    try {
      const target = optimistic.find((x: any) => (x.sop_id || x.id) === sopId);
      const patch = { verdict };
      const res = await api.updateScenarioCard(selectedPerson.id, sopId, patch);
      const nextItem = res?.item ? { ...target, ...res.item } : { ...target, verdict };
      setScenarioCards((prev) => (prev || []).map((x: any) => (((x.sop_id || x.id) === sopId || (nextItem?.sop_id && (x.sop_id || x.id) === nextItem.sop_id)) ? nextItem : x)));
      await fetchScenarioCards(selectedPerson.id);
    } catch (err) {
      console.error('Failed to update scenario verdict', err);
      setScenarioCards(prevCards);
      alert('更新剧本状态失败');
    } finally {
      setScenarioActingId((cur) => (cur === sopId ? null : cur));
    }
  };

  const startScenarioEdit = (item: any, forceReject: boolean = false) => {
    if (!item) return;
    const id = item.sop_id || item.id;
    if (!id) return;
    const combinedText = [
      `预期反应：${item?.predicted_reaction || ''}`,
      `建议对策：${item?.strategy || ''}`,
    ].join('\n\n');
    setScenarioEditingId(id);
    setScenarioEditDraft({
      sop_id: id,
      title: item.title || '',
      scenario: item.scenario || '',
      text: combinedText || String(item?.strategy || ''),
      category: item.category || '未分类',
      verdict: forceReject ? 'reject' : (item.verdict || 'pending'),
    });
  };

  const parseScenarioText = (text: string, fallbackReaction: string, fallbackStrategy: string) => {
    const raw = String(text || '').trim();
    if (!raw) {
      return { predicted_reaction: fallbackReaction || '', strategy: fallbackStrategy || '' };
    }
    const normalized = raw.replace(/\r\n/g, '\n');
    const reactionMatch = normalized.match(/预期反应[:：]\s*([\s\S]*?)(?:\n+\s*建议对策[:：]|$)/);
    const strategyMatch = normalized.match(/建议对策[:：]\s*([\s\S]*?)$/);
    const predicted_reaction = (reactionMatch?.[1] || '').trim() || fallbackReaction || '';
    const strategy = (strategyMatch?.[1] || '').trim() || fallbackStrategy || normalized;
    return { predicted_reaction, strategy };
  };

  const saveScenarioEdit = async () => {
    if (!selectedPerson || !scenarioEditingId || !scenarioEditDraft) return;
    setScenarioEditSaving(true);
    try {
      const target = (scenarioCards || []).find((x: any) => (x.sop_id || x.id) === scenarioEditingId);
      const parsed = parseScenarioText(
        scenarioEditDraft.text,
        String(target?.predicted_reaction || ''),
        String(target?.strategy || '')
      );
      const patch = {
        predicted_reaction: parsed.predicted_reaction,
        strategy: parsed.strategy,
        category: scenarioEditDraft.category || '未分类',
        verdict: scenarioEditDraft.verdict || 'pending',
      };
      const res = await api.updateScenarioCard(selectedPerson.id, scenarioEditingId, patch);
      const nextItem = res?.item ? { ...scenarioEditDraft, ...res.item } : { ...scenarioEditDraft };
      setScenarioCards((prev) => (prev || []).map((x: any) => ((x.sop_id || x.id) === scenarioEditingId ? nextItem : x)));
      setScenarioEditingId(null);
      setScenarioEditDraft(null);
      await fetchScenarioCards(selectedPerson.id);
    } catch (err) {
      console.error('Failed to save scenario edit', err);
      alert('保存剧本修改失败');
    } finally {
      setScenarioEditSaving(false);
    }
  };

  const handleDeleteScenarioCard = async (sopId: string) => {
    if (!selectedPerson || !sopId) return;
    const ok = window.confirm('确认删除这个剧本条目吗？删除后不可恢复。');
    if (!ok) return;
    const prevCards = scenarioCards || [];
    setScenarioDeletingId(sopId);
    setScenarioCards((prev) => (prev || []).filter((x: any) => (x.sop_id || x.id) !== sopId));
    try {
      await api.deleteScenarioCard(selectedPerson.id, sopId);
      if (scenarioEditingId === sopId) {
        setScenarioEditingId(null);
        setScenarioEditDraft(null);
      }
      await fetchScenarioCards(selectedPerson.id);
    } catch (err) {
      console.error('Failed to delete scenario card', err);
      setScenarioCards(prevCards);
      alert('删除剧本失败，请稍后重试');
    } finally {
      setScenarioDeletingId((cur) => (cur === sopId ? null : cur));
    }
  };

  const handleApplyProposal = async () => {
    if (!selectedPerson || !mapProposal) return;
    try {
      const res = await api.applyMapProposal(selectedPerson.id, mapProposal);
      const mergedRed = normalizeTrafficList((res?.triggers || []).map((t: string) => ({ text: t, source: 'manual' })), 'manual');
      const mergedGreen = normalizeTrafficList((res?.pleasers || []).map((t: string) => ({ text: t, source: 'manual' })), 'manual');
      setTrafficRedDraft(mergedRed);
      setTrafficGreenDraft(mergedGreen);
      setMapProposal(null);
      const parsed = parsePrivateInfoObject(selectedPerson.private_info);
      const nextPrivate = {
        ...(parsed || {}),
        behavioral_archive: {
          ...(parsed?.behavioral_archive || {}),
          ...(res?.behavioral_archive || {}),
        },
      };
      setSelectedPerson((prev: any) => prev && prev.id === selectedPerson.id ? {
        ...prev,
        triggers: res?.triggers || prev.triggers || [],
        pleasers: res?.pleasers || prev.pleasers || [],
        private_info: JSON.stringify(nextPrivate),
      } : prev);
      setPeople((prev) => prev.map((p: any) => p.id === selectedPerson.id ? {
        ...p,
        triggers: res?.triggers || p.triggers || [],
        pleasers: res?.pleasers || p.pleasers || [],
        private_info: JSON.stringify(nextPrivate),
      } : p));
    } catch (err) {
      console.error('Failed to apply map proposal', err);
      alert('应用提案失败');
    }
  };

  const handleUpdateProfile = async () => {
      try {
          if (!editForm) return;
          // Parse tags if string
          const tags = typeof editForm.tags === 'string' 
            ? editForm.tags.split(/[,，\s]+/).filter(Boolean) 
            : (Array.isArray(editForm.tags) ? editForm.tags : []);

          const related_people = Array.isArray(editForm.related_people) ? editForm.related_people : [];
          
          const updatedData = {
            ...editForm,
            tags,
            related_people,
            birthday: editForm.birthday ? editForm.birthday : null,
            first_met_date: editForm.first_met_date ? editForm.first_met_date : null,
          };
          await api.updatePerson(selectedPerson.id, updatedData);
          
          setSelectedPerson(updatedData);
          setPeople(prev => prev.map(p => p.id === updatedData.id ? updatedData : p));
          setIsEditing(false);
      } catch (error) {
          console.error("Update failed", error);
          alert("更新失败");
      }
  }

  const handleDeletePerson = async () => {
    if (!selectedPerson) return;
    const ok = window.confirm(`确认删除人物「${selectedPerson.name || ''}」？该人物的互动记录也会一并删除。`);
    if (!ok) return;
    try {
      await api.deletePerson(selectedPerson.id);
      setPeople((prev) => prev.filter((p: any) => p.id !== selectedPerson.id));
      setSelectedPerson(null);
      setEditForm(null);
      setIsEditing(false);
    } catch (e) {
      console.error('Delete failed', e);
      alert('删除失败，请稍后重试');
    }
  };

  const handleAIAnalyze = async () => {
      if (!selectedPerson) return;
      setAnalyzing(true);
      try {
          // Pass current editing data if available, otherwise selected person
          const currentData = isEditing && editForm ? editForm : selectedPerson;
          
          const result = await api.analyzePerson(selectedPerson.id, currentData);
          // Store result for review instead of applying directly
          setAnalysisResult(result);
          // Don't set editing or form data yet
      } catch (error) {
          console.error("Analysis failed", error);
          alert("AI 分析失败");
      } finally {
          setAnalyzing(false);
      }
  }

  const handleApplyAnalysis = (finalData: any) => {
      // Use finalData (which might be edited) instead of analysisResult
      const dataToApply = finalData || analysisResult;
      if (!dataToApply) return;
      
      setEditForm((prev: any) => ({
          ...(prev || selectedPerson || {}),
          disc_type: dataToApply.disc || '',
          mbti_type: dataToApply.mbti || '',
          ai_analysis: dataToApply.analysis || '',
          interaction_tips: dataToApply.tips || '',
          triggers: dataToApply.triggers || [],
          pleasers: dataToApply.pleasers || []
      }));
      setAnalysisResult(null);
      setIsEditing(true);
  }

  const toggleMood = async (person: any) => {
      const moods = ['平稳', '开心', '忙碌', '压力', '期待'];
      const currentIdx = moods.indexOf(person.current_mood || '平稳');
      const nextMood = moods[(currentIdx + 1) % moods.length];
      
      try {
          const updated = { ...person, current_mood: nextMood };
          await api.updatePerson(person.id, updated);
          setSelectedPerson(updated);
          setPeople(prev => prev.map(p => p.id === updated.id ? updated : p));
      } catch (error) {
          console.error("Failed to update mood", error);
      }
  }

  // New: Generate Interaction Review
  const handleGenerateReview = async (logId: number) => {
      try {
          const result = await api.generateReview(logId, selectedPerson.id);
          // Refresh logs to show review
          if (result.review) {
              setLogs(prev => prev.map(l => l.id === logId ? { ...l, ai_review: result.review } : l));
          }
      } catch (err) {
          console.error(err);
          alert("复盘生成失败");
      }
  };

  const filteredPeople = (people || []).filter(p => {
    const matchesSearch = (p.name || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
      (Array.isArray(p.tags) && p.tags.some((t: string) => (t || '').toLowerCase().includes(searchTerm.toLowerCase())));
    
    if (activeCategory === '全部') return matchesSearch;
    
    // Find category config
    const catConfig = CATEGORIES.find(c => c.label.includes(activeCategory));
    if (!catConfig) return matchesSearch;
    
    return matchesSearch && p.category === catConfig.id;
  });

  return (
    <div className="flex h-full bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden relative">
      {/* Sidebar List */}
      <div className={`
        w-full lg:w-80 border-r border-gray-100 bg-gray-50/50 flex-col flex-shrink-0 
        ${selectedPerson ? 'hidden lg:flex' : 'flex'}
      `}>
        <div className="p-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
            <User className="w-5 h-5 mr-2 text-primary" />
            性格分析档案
          </h2>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索人物..."
              className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            <button 
                onClick={() => setActiveCategory('全部')} 
                className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors border ${activeCategory === '全部' ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary/50'}`}
            >
                全部
            </button>
            {CATEGORIES.map(cat => (
              <button 
                key={cat.id} 
                onClick={() => setActiveCategory(cat.label)} 
                className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors flex items-center border ${activeCategory === cat.label ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary/50'}`}
              >
                <span className="mr-1">{cat.icon}</span>
                {cat.label.split('/')[0]}
              </button>
            ))}
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {loading ? (
             <div className="text-center py-4 text-gray-400 text-sm">加载中...</div>
          ) : filteredPeople.map(person => (
            <div 
              key={person.id}
              onClick={() => handleSelectPerson(person)}
              className={`p-3 rounded-lg cursor-pointer transition-colors ${selectedPerson?.id === person.id ? 'bg-white shadow-sm border border-primary/20' : 'hover:bg-white hover:shadow-sm border border-transparent'}`}
            >
              <div className="flex justify-between items-start mb-1">
                <span className="font-bold text-gray-900">{person.name || '未命名'}</span>
                {person.category && (
                    <span className="text-[10px] bg-primary/5 text-primary px-1.5 py-0.5 rounded flex items-center">
                        {CATEGORIES.find(c => c.id === person.category)?.icon}
                        <span className="ml-1">{CATEGORIES.find(c => c.id === person.category)?.label.split('/')[0]}</span>
                    </span>
                )}
              </div>
              <div className="text-xs text-gray-500 mb-2 truncate">{person.identity}</div>
              <div className="flex flex-wrap gap-1 mb-2">
                {person.tags && person.tags.map((t: string, i: number) => (
                  <span key={i} className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] text-gray-600">#{t}</span>
                ))}
              </div>
              <div className="flex items-center text-xs text-gray-500 gap-3">
                <span className="flex items-center"><Brain className="w-3 h-3 mr-1" /> {person.disc_type || '未知'}</span>
                <span className="flex items-center">关系: {person.relationship_strength}%</span>
              </div>
              
              {/* Last Interaction Summary */}
              {person.last_interaction && (
                  <div className="text-[10px] text-gray-500 truncate mb-2 flex items-center bg-gray-50 px-1.5 py-0.5 rounded">
                      <MessageSquare className="w-3 h-3 mr-1 text-gray-400" />
                      上次: {person.last_interaction}
                  </div>
              )}

              {/* New: Suggested Follow Up Tag */}
              {renderAIFollowUpTag(person)}
            </div>
          ))}
          
          <button onClick={() => setIsCreating(true)} className="w-full py-3 border-2 border-dashed border-gray-200 rounded-lg text-gray-400 text-sm hover:border-primary hover:text-primary hover:bg-primary/5 transition-all flex items-center justify-center">
            <Plus className="w-4 h-4 mr-1" /> 新建人物档案
          </button>
        </div>
      </div>

      {/* Main Detail Area */}
      <div className={`flex-1 overflow-y-auto bg-white ${selectedPerson ? 'block' : 'hidden lg:block'}`}>
        {selectedPerson ? (
          <div className="p-4 lg:p-8 max-w-4xl mx-auto">
            {/* Mobile Back Button */}
            <div className="lg:hidden mb-4">
                <button onClick={() => setSelectedPerson(null)} className="flex items-center text-gray-500 hover:text-gray-900 font-medium text-sm">
                    <ArrowLeft className="w-4 h-4 mr-1" /> 返回列表
                </button>
            </div>

            {/* Header */}
            <div className="flex justify-between items-start mb-8 border-b border-gray-100 pb-6">
              <div className="flex items-start gap-4 flex-1">
                {/* Avatar with Dual Track */}
                <div className="relative group w-24 h-24 shrink-0 cursor-pointer">
                    <div className="w-full h-full bg-primary/10 rounded-full flex items-center justify-center text-3xl font-bold text-primary overflow-hidden border-2 border-transparent group-hover:border-primary/50 transition-all">
                        {selectedPerson.avatar_real ? (
                            <img src={selectedPerson.avatar_real} alt="Real" className="w-full h-full object-cover" />
                        ) : selectedPerson.avatar_ai ? (
                            <img src={selectedPerson.avatar_ai} alt="AI" className="w-full h-full object-cover" />
                        ) : (
                            (selectedPerson.name || '?')[0]
                        )}
                    </div>
                    {/* Hover Actions */}
                    <div className="absolute inset-0 bg-black/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 backdrop-blur-sm z-10">
                        <label className="cursor-pointer bg-white/20 p-2 rounded-full hover:bg-white/40 transition-colors" title="上传真实照片" onClick={e => e.stopPropagation()}>
                            <Upload className="w-4 h-4 text-white" />
                            <input type="file" className="hidden" accept="image/*" onChange={handleAvatarUpload} />
                        </label>
                        <button onClick={(e) => { e.stopPropagation(); handleAIAvatar(); }} className="bg-white/20 p-2 rounded-full hover:bg-white/40 transition-colors" title="AI 生成形象">
                            <Zap className="w-4 h-4 text-yellow-300" />
                        </button>
                    </div>
                </div>

                <div className="flex-1 ml-2">
                  {isEditing && editForm ? (
                      <div className="space-y-2">
                          <input 
                            value={editForm.name || ''} 
                            onChange={e => setEditForm({...editForm, name: e.target.value})}
                            className="text-2xl font-bold text-gray-900 w-full border-b border-gray-300 focus:outline-none focus:border-primary"
                            placeholder="姓名"
                          />
                          <div className="flex gap-2">
                              <input 
                                value={editForm.identity || ''} 
                                onChange={e => setEditForm({...editForm, identity: e.target.value})}
                                className="text-gray-500 w-1/2 border-b border-gray-300 focus:outline-none focus:border-primary"
                                placeholder="身份"
                              />
                              <input 
                                value={editForm.field || ''} 
                                onChange={e => setEditForm({...editForm, field: e.target.value})}
                                className="text-gray-500 w-1/2 border-b border-gray-300 focus:outline-none focus:border-primary"
                                placeholder="领域"
                              />
                            <div className="flex items-center">
                        <Cake className="w-4 h-4 mr-2 text-gray-400"/> 
                        <span className="text-gray-500 w-20 shrink-0">生日:</span> 
                        {isEditing && editForm ? (
                            <input 
                                type="date"
                                value={editForm.birthday || ''} 
                                onChange={e => setEditForm({...editForm, birthday: e.target.value})}
                                className="flex-1 bg-white border border-gray-200 rounded px-2 py-1"
                            />
                        ) : (
                            <span className="text-gray-900">{selectedPerson.birthday || '未记录'}</span>
                        )}
                    </div>
                  </div>
                          <input 
                            value={Array.isArray(editForm.tags) ? editForm.tags.join(' ') : (editForm.tags || '')} 
                            onChange={e => setEditForm({...editForm, tags: e.target.value})}
                            className="text-xs text-gray-600 w-full border-b border-gray-300 focus:outline-none focus:border-primary"
                            placeholder="标签 (空格分隔)"
                          />
                      </div>
                  ) : (
                      <>
                        <div className="flex items-center gap-3 mb-1">
                            <h1 className="text-2xl font-bold text-gray-900">{selectedPerson.name || '未命名'}</h1>
                            {/* Mood Selector - Moved here */}
                            <div className="relative group flex items-center gap-2">
                                <div onClick={() => toggleMood(selectedPerson)} className="flex items-center space-x-1 px-2 py-1 bg-gray-50 rounded-full text-xs text-gray-600 cursor-pointer border border-transparent hover:border-gray-200 select-none transition-colors hover:bg-gray-100">
                                    <span>{selectedPerson.current_mood || '平稳'}</span>
                                </div>
                                <button onClick={() => { setIsEditing(true); setEditForm(selectedPerson); }} className="p-1 text-gray-400 hover:text-primary transition-colors" title="编辑档案">
                                    <Edit2 className="w-4 h-4" />
                                </button>
                                <button onClick={handleDeletePerson} className="p-1 text-gray-400 hover:text-red-600 transition-colors" title="删除人物">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                <p className="text-gray-500 mb-2">
                    {selectedPerson.identity || '未知身份'} | {selectedPerson.field || '未知领域'}
                    {selectedPerson.birthday && <span className="ml-2 text-xs bg-pink-100 text-pink-600 px-2 py-0.5 rounded-full flex inline-flex items-center"><Cake className="w-3 h-3 mr-1"/> {selectedPerson.birthday}</span>}
                </p>
                        <div className="flex gap-2 flex-wrap">
                            {selectedPerson.tags && selectedPerson.tags.map((t: string, i: number) => (
                            <span key={i} className="px-2 py-1 bg-gray-100 rounded-full text-xs text-gray-600">#{t}</span>
                            ))}
                        </div>
                      </>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0 ml-4 flex flex-col items-end">
                  {isEditing && editForm && (
                      <div className="flex space-x-2 mb-4">
                          <button onClick={() => setIsEditing(false)} className="px-3 py-1 text-sm text-gray-500 hover:text-gray-700">取消</button>
                          <button onClick={handleUpdateProfile} className="px-3 py-1 text-sm bg-primary text-white rounded-md hover:bg-primary/90">保存</button>
                          <button onClick={handleDeletePerson} className="px-3 py-1 text-sm bg-red-600 text-white rounded-md hover:bg-red-700">删除</button>
                      </div>
                  )}
                
                <div className="text-sm text-gray-500 mb-1">关系强度</div>
                  {isEditing && editForm ? (
                      <div className="flex items-center gap-2">
                          <input 
                              type="number" 
                              min="0" max="100"
                              value={editForm.relationship_strength || 0}
                              onChange={e => setEditForm({...editForm, relationship_strength: parseInt(e.target.value)})}
                              className="w-16 border rounded px-1 text-right font-bold text-primary"
                          />
                          <span className="text-primary font-bold">%</span>
                      </div>
                  ) : (
                      <div className="text-xl font-bold text-primary">{selectedPerson.relationship_strength}%</div>
                  )}
                  
                  <div className="w-32 h-2 bg-gray-100 rounded-full mt-1 overflow-hidden mb-2">
                    <div className="h-full bg-primary" style={{ width: `${isEditing && editForm ? editForm.relationship_strength : selectedPerson.relationship_strength}%` }}></div>
                  </div>
                  
                  {/* Trend Chart */}
                  {!isEditing && logs.length > 1 && (
                      <RelationshipTrendChart logs={logs} currentScore={selectedPerson.relationship_strength} />
                  )}
              </div>
            </div>

            {/* AI Summary & Insights Box */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-6 mb-8 relative overflow-hidden shadow-sm">
                <div className="relative z-10">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-blue-900 flex items-center text-lg">
                            <Bot className="w-5 h-5 mr-2 text-blue-600" /> 
                            AI 军师 · 每日内参
                        </h3>
                        <div className="flex items-center gap-2">
                            {summaryLoading ? (
                                <span className="text-xs text-blue-400 animate-pulse bg-white/50 px-2 py-1 rounded">更新中...</span>
                            ) : (
                                <span className="text-xs text-blue-400 bg-white/50 px-2 py-1 rounded">
                                    {summaryData?.cached ? '今日缓存' : '今日已更新'}
                                </span>
                            )}
                            <button
                                onClick={handleRefreshSummary}
                                disabled={summaryLoading || !selectedPerson?.id}
                                className="text-xs px-2 py-1 rounded border border-blue-200 text-blue-600 hover:bg-blue-100/70 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                手动刷新
                            </button>
                        </div>
                    </div>
                    {summaryError && (
                        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 whitespace-pre-wrap">
                            刷新失败：{summaryError}
                        </div>
                    )}
                    
                    {summaryData ? (
                        <div className="space-y-4">
                            <div className="bg-white/60 rounded-xl p-4 border border-blue-100/50 backdrop-blur-sm">
                                <div className="text-sm text-blue-900 font-medium leading-relaxed">
                                    {summaryData.summary || "暂无摘要"}
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-blue-100/50 rounded-xl p-4 border border-blue-200/50">
                                    <div className="text-xs font-bold text-blue-600 mb-2 uppercase tracking-wide flex items-center">
                                        <Zap className="w-3 h-3 mr-1" /> 行动建议
                                    </div>
                                    <div className="text-sm text-blue-800 leading-relaxed">
                                        {summaryData.advice || "保持现状即可。"}
                                    </div>
                                </div>
                                
                                <div className="bg-yellow-50/80 rounded-xl p-4 border border-yellow-100">
                                    <div className="text-xs font-bold text-yellow-600 mb-2 uppercase tracking-wide flex items-center">
                                        <Clock className="w-3 h-3 mr-1" /> 重要提醒
                                    </div>
                                    <div className="space-y-2">
                                        {summaryData.reminders && summaryData.reminders.length > 0 ? (
                                            summaryData.reminders.map((r: string, i: number) => (
                                                <div key={i} className="flex items-start text-sm text-yellow-800">
                                                    <span className="mr-2">•</span>
                                                    <span>{r}</span>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="text-sm text-yellow-800/60 italic">暂无特别提醒</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-8 text-blue-400/60">
                            <div className="animate-spin w-6 h-6 border-2 border-blue-400 border-t-transparent rounded-full mx-auto mb-2"></div>
                            正在生成今日摘要...
                        </div>
                    )}
                </div>
                
                {/* Decoration */}
                <div className="absolute -top-6 -right-6 opacity-5 pointer-events-none">
                    <Brain className="w-48 h-48 text-blue-900" />
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
              {/* Personality Analysis */}
              <div className="bg-purple-50 p-6 rounded-xl border border-purple-100 relative group">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-purple-900 flex items-center">
                        <Brain className="w-5 h-5 mr-2" /> 性格分析 (AI 辅助)
                    </h3>
                    <button 
                        onClick={handleAIAnalyze}
                        disabled={analyzing}
                        className="text-xs bg-white/50 hover:bg-white text-purple-700 px-2 py-1 rounded border border-purple-200 transition-colors flex items-center"
                    >
                        {analyzing ? '分析中...' : '✨ 智能生成建议'}
                    </button>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      {isEditing && editForm ? (
                          <>
                            <select 
                                value={editForm.disc_type || ''} 
                                onChange={e => setEditForm({...editForm, disc_type: e.target.value})}
                                className="text-sm font-bold text-purple-800 bg-white px-2 py-0.5 rounded border-none focus:ring-1 focus:ring-purple-300"
                            >
                                <option value="">DISC未知</option>
                                <option value="D型">D型</option>
                                <option value="I型">I型</option>
                                <option value="S型">S型</option>
                                <option value="C型">C型</option>
                            </select>
                            <input 
                                value={editForm.mbti_type || ''} 
                                onChange={e => setEditForm({...editForm, mbti_type: e.target.value})}
                                className="text-sm font-bold text-purple-800 bg-white px-2 py-0.5 rounded border-none focus:ring-1 focus:ring-purple-300 w-24"
                                placeholder="MBTI"
                            />
                          </>
                      ) : (
                          <>
                            <span className="text-sm font-bold text-purple-800 bg-white/50 px-2 py-0.5 rounded">DISC: {selectedPerson.disc_type || '未分析'}</span>
                            <span className="text-sm font-bold text-purple-800 bg-white/50 px-2 py-0.5 rounded">MBTI: {selectedPerson.mbti_type || '未分析'}</span>
                          </>
                      )}
                    </div>
                    
                    {isEditing && editForm ? (
                        <textarea 
                            value={editForm.ai_analysis || ''} 
                            onChange={e => setEditForm({...editForm, ai_analysis: e.target.value})}
                            className="w-full h-24 text-sm text-purple-800 bg-white/50 border border-purple-100 rounded p-2 focus:outline-none focus:border-purple-300 resize-none"
                            placeholder="性格分析..."
                        />
                    ) : (
                        <p className="text-sm text-purple-800 leading-relaxed whitespace-pre-wrap">{selectedPerson.ai_analysis || "暂无分析，请添加互动记录后生成。"}</p>
                    )}
                  </div>
                  <div className="pt-4 border-t border-purple-200">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-sm font-bold text-purple-900">💡 相处建议</h4>
                    {!isEditing && (
                        <button 
                            onClick={handleGenerateScript} 
                            disabled={scriptLoading}
                            className="text-xs text-primary border border-primary/20 bg-white px-2 py-0.5 rounded-full hover:bg-primary/5 flex items-center"
                        >
                            <MessageSquare className="w-3 h-3 mr-1" />
                            {scriptLoading ? '生成中...' : '生成开场白'}
                        </button>
                    )}
                  </div>
                  {/* Generated Scripts Display */}
                  {generatedScript && !isEditing && (
                      <div className="mb-4 bg-white rounded-lg border border-purple-100 p-3 shadow-sm">
                          <div className="flex justify-between items-center mb-2">
                              <span className="text-xs font-bold text-purple-700">💬 推荐开场白</span>
                              <button onClick={() => setGeneratedScript(null)} className="text-gray-400 hover:text-gray-600"><X className="w-3 h-3"/></button>
                          </div>
                          <div className="space-y-2">
                              {generatedScript.map((script, i) => (
                                  <div key={i} className="text-sm text-gray-600 bg-gray-50 p-2 rounded border border-gray-100 hover:bg-white hover:border-purple-200 transition-colors cursor-pointer" onClick={() => navigator.clipboard.writeText(script)}>
                                      <span className="font-bold mr-1 text-primary">{(['A','B','C'])[i]}.</span> {script}
                                  </div>
                              ))}
                          </div>
                      </div>
                  )}

                  {isEditing && editForm ? (
                        <textarea 
                            value={editForm.interaction_tips || ''} 
                            onChange={e => setEditForm({...editForm, interaction_tips: e.target.value})}
                            className="w-full h-24 text-sm text-purple-800 bg-white/50 border border-purple-100 rounded p-2 focus:outline-none focus:border-purple-300 resize-none"
                            placeholder="相处建议..."
                        />
                    ) : (
                        <p className="text-sm text-purple-800 leading-relaxed whitespace-pre-wrap">{selectedPerson.interaction_tips || "暂无建议"}</p>
                    )}
                  </div>

                  <div className="mt-4 pt-4 border-t border-purple-200">
                      <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-bold text-gray-900">高频场景反应库</h4>
                          <div className="flex items-center gap-2">
                              {reactionSavedAt && <Check className="w-4 h-4 text-green-600" />}
                              {reactionSaving && <div className="text-[10px] text-gray-400">保存中…</div>}
                              <button
                                  onClick={addReactionItem}
                                  className="text-xs px-3 py-1.5 rounded-md bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
                              >
                                  + 添加
                              </button>
                          </div>
                      </div>
                      <div className="text-xs text-gray-600 leading-relaxed mb-3">
                          用“场景 → 反应”的形式记录；遇到具体情况时直接查这里，比宏观性格分析更好用。
                      </div>

                      <div className="space-y-3">
                          {(reactionLibraryDraft || []).length > 0 ? (
                              reactionLibraryDraft.map((item: any, idx: number) => (
                                  <div key={idx} className="bg-white/60 border border-gray-200 rounded-lg p-3">
                                      <div className="flex items-center justify-between mb-2">
                                          <div className="text-xs font-bold text-gray-700">场景 → 反应</div>
                                          <button
                                              onClick={() => removeReactionItem(idx)}
                                              className="text-gray-400 hover:text-red-500"
                                              title="删除"
                                          >
                                              <X className="w-4 h-4" />
                                          </button>
                                      </div>
                                      <input
                                          value={typeof item?.scene === 'string' ? item.scene : ''}
                                          onChange={(e) => updateReactionItem(idx, { scene: e.target.value })}
                                          className="w-full text-sm bg-white border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-200"
                                          placeholder="场景：例如 被质疑学术观点时"
                                      />
                                      <div className="mt-2 text-xs text-gray-400">→</div>
                                      <textarea
                                          rows={3}
                                          value={typeof item?.reaction === 'string' ? item.reaction : ''}
                                          onChange={(e) => updateReactionItem(idx, { reaction: e.target.value })}
                                          className="mt-2 w-full text-sm bg-white border border-gray-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-200 resize-none"
                                          placeholder="反应：例如 沉默不语，事后发邮件长篇大论解释（防御机制：回避正面冲突，重视逻辑自洽）"
                                      />
                                  </div>
                              ))
                          ) : (
                              <div className="text-xs text-gray-400 italic">暂无记录，点击“+ 添加”开始记录。</div>
                          )}
                      </div>
                  </div>

                  {/* Practical Scene Library */}
                  <div className="pt-4 border-t border-purple-200">
                      <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-bold text-gray-900 flex items-center">
                              <Zap className="w-4 h-4 mr-2 text-purple-600" /> 实战场景库
                          </h4>
                          <button
                              onClick={handleGeneratePracticalScenes}
                              disabled={practicalScenesLoading}
                              className="text-xs px-3 py-1.5 rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center"
                          >
                              <Bot className="w-3 h-3 mr-1" /> {practicalScenesLoading ? '生成中…' : 'AI 生成/更新'}
                          </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-white/60 border border-red-100 rounded-lg p-4">
                              <div className="text-sm font-bold text-red-700 mb-2 flex items-center">
                                  <AlertCircle className="w-4 h-4 mr-2" /> 💥 雷区触发场景
                              </div>
                              {(selectedPerson.triggers || []).length > 0 ? (
                                  <ul className="list-disc list-inside text-xs text-gray-800 space-y-2">
                                      {selectedPerson.triggers.map((t: string, i: number) => (
                                          <li key={i} className="leading-relaxed">{t}</li>
                                      ))}
                                  </ul>
                              ) : (
                                  <div className="text-xs text-gray-400 italic">
                                      暂无内容，点击右上角“AI 生成/更新”自动生成。
                                  </div>
                              )}
                          </div>

                          <div className="bg-white/60 border border-green-100 rounded-lg p-4">
                              <div className="text-sm font-bold text-green-700 mb-2 flex items-center">
                                  <ThumbsUp className="w-4 h-4 mr-2" /> ✨ 爽点触发场景
                              </div>
                              {(selectedPerson.pleasers || []).length > 0 ? (
                                  <ul className="list-disc list-inside text-xs text-gray-800 space-y-2">
                                      {selectedPerson.pleasers.map((t: string, i: number) => (
                                          <li key={i} className="leading-relaxed">{t}</li>
                                      ))}
                                  </ul>
                              ) : (
                                  <div className="text-xs text-gray-400 italic">
                                      暂无内容，点击右上角“AI 生成/更新”自动生成。
                                  </div>
                              )}
                          </div>
                      </div>
                  </div>
                </div>
              </div>

              {/* Basic Info & Actions */}
              <div className="space-y-6">
                <div className="bg-gray-50 p-6 rounded-xl border border-gray-100">
                  <h3 className="font-bold text-gray-900 mb-4">基本信息</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center">
                        <Phone className="w-4 h-4 mr-2 text-gray-400"/> 
                        <span className="text-gray-500 w-20 shrink-0">联系方式:</span> 
                        {isEditing && editForm ? (
                            <input 
                                value={editForm.contact_info || ''} 
                                onChange={e => setEditForm({...editForm, contact_info: e.target.value})}
                                className="flex-1 bg-white border border-gray-200 rounded px-2 py-1"
                            />
                        ) : (
                            <span className="text-gray-900 break-all">{selectedPerson.contact_info || '未记录'}</span>
                        )}
                    </div>
                    <div className="flex items-center">
                        <MapPin className="w-4 h-4 mr-2 text-gray-400"/>
                        <span className="text-gray-500 w-20 shrink-0">哪里人:</span>
                        {isEditing && editForm ? (
                            <input
                                value={editForm.hometown || ''}
                                onChange={e => setEditForm({...editForm, hometown: e.target.value})}
                                className="flex-1 bg-white border border-gray-200 rounded px-2 py-1"
                                placeholder="如：海南 / 北京"
                            />
                        ) : (
                            <span className="text-gray-900">{selectedPerson.hometown || '未记录'}</span>
                        )}
                    </div>
                    <div className="flex items-center">
                        <Calendar className="w-4 h-4 mr-2 text-gray-400"/> 
                        <span className="text-gray-500 w-20 shrink-0">认识时间:</span> 
                        {isEditing && editForm ? (
                            <input 
                                type="date"
                                value={editForm.first_met_date || ''} 
                                onChange={e => setEditForm({...editForm, first_met_date: e.target.value})}
                                className="flex-1 bg-white border border-gray-200 rounded px-2 py-1"
                            />
                        ) : (
                            <span className="text-gray-900">{selectedPerson.first_met_date || '未记录'}</span>
                        )}
                    </div>
                    <div className="flex items-center">
                        <MapPin className="w-4 h-4 mr-2 text-gray-400"/> 
                        <span className="text-gray-500 w-20 shrink-0">认识场景:</span> 
                        {isEditing && editForm ? (
                            <input 
                                value={editForm.first_met_scene || ''} 
                                onChange={e => setEditForm({...editForm, first_met_scene: e.target.value})}
                                className="flex-1 bg-white border border-gray-200 rounded px-2 py-1"
                            />
                        ) : (
                            <span className="text-gray-900">{selectedPerson.first_met_scene || '未记录'}</span>
                        )}
                    </div>

                    <div className="pt-3 mt-3 border-t border-gray-200">
                        <div className="flex items-center justify-between mb-2">
                            <div className="text-sm font-bold text-gray-900">自定义条目</div>
                            {isEditing && editForm && (
                                <button
                                    onClick={() => {
                                        const current = Array.isArray(editForm.basic_info_extra) ? editForm.basic_info_extra : [];
                                        setEditForm({ ...editForm, basic_info_extra: [...current, createBasicExtraItem()] });
                                    }}
                                    className="text-xs text-primary hover:underline"
                                >
                                    + 手动添加
                                </button>
                            )}
                        </div>

                        {(isEditing && editForm ? (Array.isArray(editForm.basic_info_extra) ? editForm.basic_info_extra : []) : (Array.isArray(selectedPerson.basic_info_extra) ? selectedPerson.basic_info_extra : [])).length > 0 ? (
                            <div className="space-y-2">
                                {(isEditing && editForm ? (Array.isArray(editForm.basic_info_extra) ? editForm.basic_info_extra : []) : (Array.isArray(selectedPerson.basic_info_extra) ? selectedPerson.basic_info_extra : [])).map((it: any, idx: number) => (
                                    <div key={it?.id || idx} className="flex items-center gap-2">
                                        <div className="shrink-0">{renderBasicExtraIcon(it?.icon)}</div>
                                        {isEditing && editForm ? (
                                            <>
                                                <input
                                                    value={it?.label || ''}
                                                    onChange={(e) => {
                                                        const arr = Array.isArray(editForm.basic_info_extra) ? [...editForm.basic_info_extra] : [];
                                                        arr[idx] = { ...(arr[idx] || {}), label: e.target.value };
                                                        setEditForm({ ...editForm, basic_info_extra: arr });
                                                    }}
                                                    className="w-24 bg-white border border-gray-200 rounded px-2 py-1 text-sm"
                                                    placeholder="条目"
                                                />
                                                <span className="text-gray-400">:</span>
                                                <input
                                                    value={it?.value || ''}
                                                    onChange={(e) => {
                                                        const arr = Array.isArray(editForm.basic_info_extra) ? [...editForm.basic_info_extra] : [];
                                                        arr[idx] = { ...(arr[idx] || {}), value: e.target.value };
                                                        setEditForm({ ...editForm, basic_info_extra: arr });
                                                    }}
                                                    className="flex-1 bg-white border border-gray-200 rounded px-2 py-1 text-sm"
                                                    placeholder="内容"
                                                />
                                                <button
                                                    onClick={() => {
                                                        const arr = Array.isArray(editForm.basic_info_extra) ? editForm.basic_info_extra.filter((_: any, i: number) => i !== idx) : [];
                                                        setEditForm({ ...editForm, basic_info_extra: arr });
                                                    }}
                                                    className="text-gray-400 hover:text-red-500"
                                                    title="删除"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </>
                                        ) : (
                                            <div className="text-sm text-gray-900">
                                                <span className="text-gray-500">{it?.label || '未命名'}:</span> {it?.value || '未记录'}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-xs text-gray-400 italic">暂无</div>
                        )}
                    </div>
                  </div>
                </div>
                
                {/* Private Info (Moved here) */}

                {/* Related People Section */}
                <div className="bg-gray-50 p-6 rounded-xl border border-gray-100 mt-6">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="font-bold text-gray-900 flex items-center">
                            <Users className="w-4 h-4 mr-2" /> 关联人物
                        </h3>
                        {isEditing && <button onClick={() => setShowRelatedModal(true)} className="text-xs text-primary hover:underline">+ 关联</button>}
                    </div>

                    {(() => {
                      const source = (isEditing && editForm) ? editForm : selectedPerson;
                      const related = Array.isArray(source?.related_people) ? source.related_people : [];
                      const updateRelation = (idx: number, nextRelation: string) => {
                        const base = Array.isArray(editForm?.related_people) ? editForm.related_people : [];
                        const next = base.map((r: any, i: number) => (i === idx ? { ...(r || {}), relation: nextRelation } : r));
                        setEditForm({ ...(editForm || {}), related_people: next });
                      };

                      return related.length > 0 ? (
                        <div className="space-y-3">
                          {(() => {
                            const withScore = related.map((rel: any, idx: number) => {
                              const rawScore = Number(rel?.relationship_strength ?? rel?.score ?? rel?.strength ?? 50);
                              const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 50;
                              const bucket = score >= 70 ? '核心圈' : (score >= 40 ? '协作圈' : '扩展圈');
                              return { ...rel, _idx: idx, _score: score, _bucket: bucket };
                            }).sort((a: any, b: any) => b._score - a._score);
                            const visible = showAllRelated ? withScore : withScore.slice(0, 6);
                            const buckets = ['核心圈', '协作圈', '扩展圈'];
                            return (
                              <>
                                <div className="flex items-center justify-between text-xs text-gray-500">
                                  <span>共 {withScore.length} 人，按关系强度分层展示</span>
                                  {withScore.length > 6 && (
                                    <button onClick={() => setShowAllRelated((v) => !v)} className="text-primary hover:underline">
                                      {showAllRelated ? '收起' : `展开全部（+${withScore.length - 6}）`}
                                    </button>
                                  )}
                                </div>
                                {buckets.map((bucket) => {
                                  const items = visible.filter((x: any) => x._bucket === bucket);
                                  if (items.length === 0) return null;
                                  return (
                                    <div key={bucket}>
                                      <div className="text-[11px] font-bold text-gray-600 mb-2">{bucket}</div>
                                      <div className="grid grid-cols-1 gap-2">
                                        {items.map((rel: any) => (
                                          <div key={`${bucket}_${rel._idx}`} className="bg-white p-2.5 rounded-lg border border-gray-200">
                                            <div className="flex items-center">
                                              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold mr-3 shrink-0">
                                                {rel.avatar ? <img src={rel.avatar} className="w-full h-full rounded-full object-cover"/> : String(rel.name || '?')[0]}
                                              </div>
                                              <div className="min-w-0 flex-1">
                                                <div className="text-sm font-bold text-gray-900 truncate">{rel.name || '未命名'}</div>
                                                {isEditing ? (
                                                  <input
                                                    value={String(rel.relation || '')}
                                                    onChange={(e) => updateRelation(rel._idx, e.target.value)}
                                                    className="mt-0.5 w-full bg-white border border-gray-200 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                                                    placeholder="例如：同事/导师/合作伙伴"
                                                  />
                                                ) : (
                                                  <div className="text-xs text-gray-500 truncate">{rel.relation || '关系待补充'}</div>
                                                )}
                                              </div>
                                              <div className="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                                                强度 {rel._score}
                                              </div>
                                              {isEditing && (
                                                <button
                                                  onClick={() => {
                                                    const base = Array.isArray(editForm?.related_people) ? editForm.related_people : [];
                                                    const newRelated = base.filter((_: any, idx: number) => idx !== rel._idx);
                                                    setEditForm({ ...(editForm || {}), related_people: newRelated });
                                                  }}
                                                  className="ml-2 text-gray-400 hover:text-red-500"
                                                >
                                                  <X className="w-3 h-3" />
                                                </button>
                                              )}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </>
                            );
                          })()}
                        </div>
                      ) : (
                        <div className="text-sm text-gray-400 italic">暂无关联人物</div>
                      );
                    })()}
                </div>

                <button className="w-full py-3 bg-white border border-primary text-primary rounded-xl font-medium hover:bg-primary/5 transition-colors flex items-center justify-center mt-6">
                  <MessageSquare className="w-4 h-4 mr-2" />
                  用此人档案进行模拟训练
                </button>
                
                {/* New: AI Consultation Button */}
                <button 
                    onClick={() => setAdvisorOpen((v) => !v)}
                    className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-xl font-bold shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all flex items-center justify-center mt-3"
                >
                    <Bot className="w-5 h-5 mr-2" />
                    {advisorOpen ? '隐藏 AI 军师侧栏' : '遇到难题？打开 AI 军师'}
                </button>
              </div>
            </div>

            {/* Interaction Timeline */}
            <div className="flex flex-col gap-6">
                
              {showPrivate ? (
                <div className="bg-blue-50 p-6 rounded-xl border border-blue-100 space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold text-blue-900 flex items-center">
                      <Lock className="w-4 h-4 mr-2" /> 动态关系作战地图
                    </h3>
                    <button onClick={() => setShowPrivate(false)} className="text-blue-500 hover:text-blue-700">
                      <EyeOff className="w-4 h-4" />
                    </button>
                  </div>

                  {mapProposal && (
                    <div className="bg-white border border-blue-200 rounded-lg p-4">
                      <div className="text-sm font-bold text-blue-800 mb-2">AI 提案：是否更新作战地图？</div>
                      <div className="text-xs text-gray-700 space-y-1">
                        <div>红灯建议：{(mapProposal.red_lights || []).length} 条</div>
                        <div>绿灯建议：{(mapProposal.green_lights || []).length} 条</div>
                        <div>档案补充：{(mapProposal.archive_notes || []).length} 条</div>
                      </div>
                      <button onClick={handleApplyProposal} className="mt-3 text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                        一键应用提案
                      </button>
                    </div>
                  )}

                  <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="font-bold text-gray-900">⚡ 交互红绿灯</div>
                      <div className={`text-[11px] px-2 py-0.5 rounded-full border ${trafficSaving ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                        {trafficSaving ? '保存中…' : '已自动保存'}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-red-50 border border-red-100 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm font-bold text-red-700">🔴 红灯区（高阻力）</div>
                          <button onClick={() => addTrafficItem('red')} className="text-xs text-red-700 hover:underline">+ 新增</button>
                        </div>
                        <div className="space-y-2">
                          {(trafficRedDraft || []).map((it: any, i: number) => (
                            <div key={`red_${i}`} className="bg-white border border-red-200 rounded-lg px-2 py-1.5">
                              {trafficEditTarget?.kind === 'red' && trafficEditTarget?.index === i ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    value={trafficEditText}
                                    onChange={(e) => setTrafficEditText(e.target.value)}
                                    className="flex-1 bg-white border border-red-200 rounded px-2 py-1 text-xs"
                                    placeholder="触发冲突/防御的话题或行为"
                                  />
                                  <button onClick={saveTrafficEdit} className="text-xs px-2 py-1 rounded bg-red-600 text-white">保存</button>
                                  <button onClick={() => { setTrafficEditTarget(null); setTrafficEditText(''); }} className="text-xs px-2 py-1 rounded border border-gray-200">取消</button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <div className="text-xs text-red-900 flex-1 leading-relaxed">{it?.text || '未填写'}</div>
                                  <button onClick={() => startTrafficEdit('red', i, it?.text || '')} className="text-gray-400 hover:text-gray-600"><Edit2 className="w-3 h-3" /></button>
                                  <button onClick={() => removeTrafficItem('red', i)} className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="bg-green-50 border border-green-100 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm font-bold text-green-700">🟢 绿灯区（高推力）</div>
                          <button onClick={() => addTrafficItem('green')} className="text-xs text-green-700 hover:underline">+ 新增</button>
                        </div>
                        <div className="space-y-2">
                          {(trafficGreenDraft || []).map((it: any, i: number) => (
                            <div key={`green_${i}`} className="bg-white border border-green-200 rounded-lg px-2 py-1.5">
                              {trafficEditTarget?.kind === 'green' && trafficEditTarget?.index === i ? (
                                <div className="flex items-center gap-2">
                                  <input
                                    value={trafficEditText}
                                    onChange={(e) => setTrafficEditText(e.target.value)}
                                    className="flex-1 bg-white border border-green-200 rounded px-2 py-1 text-xs"
                                    placeholder="快速拉近关系的行为或话题"
                                  />
                                  <button onClick={saveTrafficEdit} className="text-xs px-2 py-1 rounded bg-green-600 text-white">保存</button>
                                  <button onClick={() => { setTrafficEditTarget(null); setTrafficEditText(''); }} className="text-xs px-2 py-1 rounded border border-gray-200">取消</button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <div className="text-xs text-green-900 flex-1 leading-relaxed">{it?.text || '未填写'}</div>
                                  <button onClick={() => startTrafficEdit('green', i, it?.text || '')} className="text-gray-400 hover:text-gray-600"><Edit2 className="w-3 h-3" /></button>
                                  <button onClick={() => removeTrafficItem('green', i)} className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="font-bold text-gray-900">🎭 场景预演实验室</div>
                      <button onClick={() => selectedPerson && fetchScenarioCards(selectedPerson.id)} className="text-xs text-gray-500 hover:underline">
                        {scenarioLoading ? '加载中…' : '刷新'}
                      </button>
                    </div>
                    <div className="text-xs text-gray-500 mb-2">
                      建议按“问题类型”而不是固定关系维度来分类：如资源协作、冲突修复、边界协商、日常破冰、长期承诺等。
                    </div>
                    <div className="flex flex-col md:flex-row gap-2 mb-3">
                      <input
                        value={scenarioInput}
                        onChange={(e) => setScenarioInput(e.target.value)}
                        className="flex-1 bg-white border border-gray-200 rounded-md px-3 py-2 text-sm"
                        placeholder="输入要预演的场景，如：如果我想让他帮忙内推，该怎么开口？"
                      />
                      <select value={scenarioCategory} onChange={(e) => setScenarioCategory(e.target.value as any)} className="bg-white border border-gray-200 rounded-md px-2 py-2 text-sm">
                        <option value="职场协作">职场协作</option>
                        <option value="亲密关系">亲密关系</option>
                        <option value="资源请求">资源请求</option>
                        <option value="冲突修复">冲突修复</option>
                        <option value="边界协商">边界协商</option>
                        <option value="日常破冰">日常破冰</option>
                        <option value="自定义分类">自定义分类</option>
                      </select>
                      {scenarioCategory === '自定义分类' && (
                        <input
                          value={scenarioCategoryCustom}
                          onChange={(e) => setScenarioCategoryCustom(e.target.value)}
                          className="bg-white border border-gray-200 rounded-md px-3 py-2 text-sm min-w-[140px]"
                          placeholder="输入分类名"
                        />
                      )}
                      <button onClick={handleGenerateScenarioCard} disabled={scenarioGenerating} className="px-3 py-2 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-60">
                        {scenarioGenerating ? '生成中…' : '✨ 生成新剧本'}
                      </button>
                    </div>
                    <div className="space-y-3">
                      <div className="text-xs font-bold text-gray-700">待处理</div>
                      {(scenarioCards || []).filter((x: any) => {
                        const v = String(x?.verdict || 'pending');
                        return v !== 'accept' && v !== 'reject';
                      }).length > 0 ? (scenarioCards || []).filter((x: any) => {
                        const v = String(x?.verdict || 'pending');
                        return v !== 'accept' && v !== 'reject';
                      }).map((item: any) => (
                        <div key={item.sop_id || item.id} className="border border-gray-100 rounded-lg p-3 bg-gray-50/50 space-y-2">
                          <div className="text-sm font-bold text-gray-900">{item.title}</div>
                          {scenarioEditingId === (item.sop_id || item.id) && scenarioEditDraft ? (
                            <div className="space-y-2">
                              <textarea
                                rows={5}
                                value={scenarioEditDraft.text || ''}
                                onChange={(e) => setScenarioEditDraft((prev: any) => ({ ...(prev || {}), text: e.target.value }))}
                                className="w-full bg-white border border-blue-200 rounded px-2 py-1.5 text-sm"
                                placeholder="在这里直接修改剧本条目正文（文字形式）"
                              />
                              <div className="flex items-center gap-2">
                                <input
                                  value={scenarioEditDraft.category || ''}
                                  onChange={(e) => setScenarioEditDraft((prev: any) => ({ ...(prev || {}), category: e.target.value }))}
                                  className="bg-white border border-blue-200 rounded px-2 py-1 text-xs min-w-[120px]"
                                  placeholder="分类"
                                />
                                <button onClick={saveScenarioEdit} disabled={scenarioEditSaving} className="ml-auto text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60">
                                  {scenarioEditSaving ? '保存中…' : '保存修改'}
                                </button>
                                <button onClick={() => handleDeleteScenarioCard(item.sop_id || item.id)} disabled={scenarioDeletingId === (item.sop_id || item.id)} className="text-xs px-3 py-1.5 bg-white border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-60">
                                  {scenarioDeletingId === (item.sop_id || item.id) ? '删除中…' : '删除'}
                                </button>
                                <button onClick={() => { setScenarioEditingId(null); setScenarioEditDraft(null); }} className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded hover:bg-gray-50">
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="text-xs text-gray-700"><span className="font-semibold">预期反应：</span>{item.predicted_reaction || '无'}</div>
                              <div className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed"><span className="font-semibold">建议对策：</span>{item.strategy || '无'}</div>
                              <div className="mt-1 flex items-center gap-2">
                                <button disabled={scenarioActingId === (item.sop_id || item.id)} onClick={() => handleScenarioVerdict(item.sop_id || item.id, 'accept')} className="text-xs px-2 py-1 rounded disabled:opacity-60 bg-white border border-green-200 text-green-700">👍 {scenarioActingId === (item.sop_id || item.id) ? '处理中…' : '准/采纳'}</button>
                                <button disabled={scenarioActingId === (item.sop_id || item.id)} onClick={() => startScenarioEdit(item, true)} className="text-xs px-2 py-1 rounded disabled:opacity-60 bg-white border border-red-200 text-red-700">👎 不准/去修改</button>
                                <span className="text-[10px] text-gray-400 ml-auto">{item.category || '未分类'}</span>
                              </div>
                            </>
                          )}
                        </div>
                      )) : (
                        <div className="text-xs text-gray-400 italic">当前没有待处理条目。</div>
                      )}
                      <div className="text-xs font-bold text-gray-700 pt-1">已入库（可随时修改）</div>
                      {(scenarioCards || []).filter((x: any) => {
                        const v = String(x?.verdict || 'pending');
                        return v === 'accept' || v === 'reject';
                      }).length > 0 ? (scenarioCards || []).filter((x: any) => {
                        const v = String(x?.verdict || 'pending');
                        return v === 'accept' || v === 'reject';
                      }).map((item: any) => (
                        <div key={`saved_${item.sop_id || item.id}`} className="border border-gray-100 rounded-lg p-3 bg-white space-y-2">
                          <div className="flex items-center">
                            <div className="text-sm font-bold text-gray-900">{item.title}</div>
                            <span className={`ml-2 text-[10px] px-2 py-0.5 rounded-full ${item.verdict === 'accept' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                              {item.verdict === 'accept' ? '已采纳' : '已修改'}
                            </span>
                            <button onClick={() => startScenarioEdit(item, false)} className="ml-auto text-xs px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">编辑</button>
                          </div>
                          {scenarioEditingId === (item.sop_id || item.id) && scenarioEditDraft ? (
                            <div className="space-y-2">
                              <textarea
                                rows={5}
                                value={scenarioEditDraft.text || ''}
                                onChange={(e) => setScenarioEditDraft((prev: any) => ({ ...(prev || {}), text: e.target.value }))}
                                className="w-full bg-white border border-blue-200 rounded px-2 py-1.5 text-sm"
                                placeholder="在这里直接修改剧本条目正文（文字形式）"
                              />
                              <div className="flex items-center gap-2">
                                <input
                                  value={scenarioEditDraft.category || ''}
                                  onChange={(e) => setScenarioEditDraft((prev: any) => ({ ...(prev || {}), category: e.target.value }))}
                                  className="bg-white border border-blue-200 rounded px-2 py-1 text-xs min-w-[120px]"
                                  placeholder="分类"
                                />
                                <button onClick={saveScenarioEdit} disabled={scenarioEditSaving} className="ml-auto text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60">
                                  {scenarioEditSaving ? '保存中…' : '保存修改'}
                                </button>
                                <button onClick={() => handleDeleteScenarioCard(item.sop_id || item.id)} disabled={scenarioDeletingId === (item.sop_id || item.id)} className="text-xs px-3 py-1.5 bg-white border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-60">
                                  {scenarioDeletingId === (item.sop_id || item.id) ? '删除中…' : '删除'}
                                </button>
                                <button onClick={() => { setScenarioEditingId(null); setScenarioEditDraft(null); }} className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded hover:bg-gray-50">
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="text-xs text-gray-700"><span className="font-semibold">预期反应：</span>{item.predicted_reaction || '无'}</div>
                              <div className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed"><span className="font-semibold">建议对策：</span>{item.strategy || '无'}</div>
                              <div className="text-[10px] text-gray-400">{item.category || '未分类'}</div>
                            </>
                          )}
                        </div>
                      )) : (
                        <div className="text-xs text-gray-400 italic">暂无已入库条目。</div>
                      )}
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-100 p-4">
                    <div className="font-bold text-gray-900 mb-3">🗂️ 行为细节档案馆</div>
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs font-bold text-gray-700">生活规律与行为模式</div>
                        <div className="text-[11px] text-gray-500 mt-1">
                          观察建议：作息节律、饮食偏好、消费决策、沟通语气、情绪波动时的非语言动作（如沉默、打断、刷手机）。
                        </div>
                        <textarea
                          ref={behaviorHabitsRef}
                          rows={3}
                          value={analysisDraft.layer_3_surface.behavior_habits}
                          onChange={(e) => { setAnalysisField('layer_3_surface.behavior_habits', e.target.value); autoResize(e.currentTarget); }}
                          onInput={(e) => autoResize(e.currentTarget as HTMLTextAreaElement)}
                          className="mt-1 w-full text-sm leading-relaxed bg-white border border-gray-200 rounded-lg p-2 resize-none overflow-hidden"
                          placeholder="可按“触发场景 → 对方行为 → 你方感受/结果”记录，例：催进度时先沉默后密集输出。"
                        />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700">关键事件轴</div>
                        <div className="text-[11px] text-gray-500 mt-1">
                          记录模板：时间点、事件、情绪反应、后续行为变化。重点放“转折点”与“长期影响”。
                        </div>
                        <textarea
                          ref={lifeTrajectoryRef}
                          rows={3}
                          value={analysisDraft.layer_3_surface.life_trajectory}
                          onChange={(e) => { setAnalysisField('layer_3_surface.life_trajectory', e.target.value); autoResize(e.currentTarget); }}
                          onInput={(e) => autoResize(e.currentTarget as HTMLTextAreaElement)}
                          className="mt-1 w-full text-sm leading-relaxed bg-white border border-gray-200 rounded-lg p-2 resize-none overflow-hidden"
                          placeholder="例：2024.10 项目被否后，沟通从主动转为防御；2025.02 获奖后，公开表达明显增加。"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-bold text-gray-700">待验证观察点</div>
                          <button onClick={() => scheduleEnsureChecklist('layer_3_surface', true)} className="text-xs text-green-700 hover:underline" disabled={!!verificationLoading['layer_3_surface']}>
                            {verificationLoading['layer_3_surface'] ? '生成中…' : 'AI 生成'}
                          </button>
                        </div>
                        {(verificationChecklists?.layer_3_surface?.items || []).length > 0 ? (
                          <ul className="mt-2 list-disc list-inside text-xs text-gray-800 space-y-1">
                            {verificationChecklists.layer_3_surface.items.map((t: string, i: number) => (
                              <li key={i}>{t}</li>
                            ))}
                          </ul>
                        ) : (
                          <div className="mt-1 text-xs text-gray-400 italic">填写档案后可生成观察任务。建议示例：观察对方在资源不足时是否优先求助还是独自硬扛。</div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-gray-900">🎯 主观策略层（V1+V2+V3）</div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleRecommendStrategy}
                          disabled={strategySuggesting || !selectedPerson}
                          className="text-xs px-3 py-1.5 rounded border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                        >
                          {strategySuggesting ? 'AI 生成中…' : 'AI 推荐策略'}
                        </button>
                        <button
                          onClick={handleEvaluateStrategy}
                          disabled={strategyEvaluating || !selectedPerson}
                          className="text-xs px-3 py-1.5 rounded border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                        >
                          {strategyEvaluating ? '评估中…' : '策略效果评估'}
                        </button>
                      </div>
                    </div>
                    <div className="text-[11px] text-gray-500">
                      AI 仅提供建议草案与评估结论，最终策略以你手动输入为准，不提供一键采纳。
                    </div>
                    <div className="text-xs font-bold text-indigo-700">V1：目标与关系策略</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs font-bold text-gray-700">我对TA的关系定位</div>
                        <input list="relation-positioning-options" value={analysisDraft.strategy_layer?.relation_positioning || ''} onChange={(e) => setAnalysisField('strategy_layer.relation_positioning', e.target.value)} className="mt-1 w-full text-sm bg-white border border-gray-200 rounded-lg p-2" placeholder="可选：战略合作 / 资源连接 / 普通维护 / 观察中 / 降低投入，或自定义输入" />
                        <datalist id="relation-positioning-options"><option value="战略合作" /><option value="资源连接" /><option value="普通维护" /><option value="观察中" /><option value="降低投入" /></datalist>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700">关系优先级</div>
                        <input list="relation-priority-options" value={analysisDraft.strategy_layer?.relation_priority || ''} onChange={(e) => setAnalysisField('strategy_layer.relation_priority', e.target.value)} className="mt-1 w-full text-sm bg-white border border-gray-200 rounded-lg p-2" placeholder="可选：P0 / P1 / P2，或自定义输入" />
                        <datalist id="relation-priority-options"><option value="P0" /><option value="P1" /><option value="P2" /></datalist>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700">关系阶段</div>
                        <input list="relation-stage-options" value={analysisDraft.strategy_layer?.relation_stage || ''} onChange={(e) => setAnalysisField('strategy_layer.relation_stage', e.target.value)} className="mt-1 w-full text-sm bg-white border border-gray-200 rounded-lg p-2" placeholder="可选：初识 / 建立信任 / 协作中 / 稳定期 / 退出期，或自定义输入" />
                        <datalist id="relation-stage-options"><option value="初识" /><option value="建立信任" /><option value="协作中" /><option value="稳定期" /><option value="退出期" /></datalist>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700">期望节奏</div>
                        <input list="expected-rhythm-options" value={analysisDraft.strategy_layer?.expected_rhythm || ''} onChange={(e) => setAnalysisField('strategy_layer.expected_rhythm', e.target.value)} className="mt-1 w-full text-sm bg-white border border-gray-200 rounded-lg p-2" placeholder="可选：快速熟络 / 稳步推进 / 低频维持，或自定义输入" />
                        <datalist id="expected-rhythm-options"><option value="快速熟络" /><option value="稳步推进" /><option value="低频维持" /></datalist>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700">当前策略状态</div>
                        <input list="strategy-status-options" value={analysisDraft.strategy_layer?.strategy_status || ''} onChange={(e) => setAnalysisField('strategy_layer.strategy_status', e.target.value)} className="mt-1 w-full text-sm bg-white border border-gray-200 rounded-lg p-2" placeholder="可选：推进中 / 暂停 / 退出，或自定义输入" />
                        <datalist id="strategy-status-options"><option value="推进中" /><option value="暂停" /><option value="退出" /></datalist>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700">策略置信度（0-100）</div>
                        <input value={analysisDraft.strategy_layer?.strategy_confidence || ''} onChange={(e) => setAnalysisField('strategy_layer.strategy_confidence', e.target.value)} className="mt-1 w-full text-sm bg-white border border-gray-200 rounded-lg p-2" placeholder="如：70" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700">30天目标</div>
                        <textarea rows={2} value={analysisDraft.strategy_layer?.short_term_goal_30d || ''} onChange={(e) => setAnalysisField('strategy_layer.short_term_goal_30d', e.target.value)} className="mt-1 w-full text-sm leading-relaxed bg-white border border-gray-200 rounded-lg p-2" placeholder="30天目标" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700">90天目标</div>
                        <textarea rows={2} value={analysisDraft.strategy_layer?.mid_term_goal_90d || ''} onChange={(e) => setAnalysisField('strategy_layer.mid_term_goal_90d', e.target.value)} className="mt-1 w-full text-sm leading-relaxed bg-white border border-gray-200 rounded-lg p-2" placeholder="90天目标" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700">每周时间预算（小时）</div>
                        <input value={analysisDraft.strategy_layer?.weekly_time_budget_hours || ''} onChange={(e) => setAnalysisField('strategy_layer.weekly_time_budget_hours', e.target.value)} className="mt-1 w-full text-sm bg-white border border-gray-200 rounded-lg p-2" placeholder="如：2-3小时" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700">月度金钱预算</div>
                        <input value={analysisDraft.strategy_layer?.money_budget_monthly || ''} onChange={(e) => setAnalysisField('strategy_layer.money_budget_monthly', e.target.value)} className="mt-1 w-full text-sm bg-white border border-gray-200 rounded-lg p-2" placeholder="如：500元以内" />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs font-bold text-gray-700">渠道偏好</div>
                        <input value={analysisDraft.strategy_layer?.channel_preference || ''} onChange={(e) => setAnalysisField('strategy_layer.channel_preference', e.target.value)} className="mt-1 w-full text-sm bg-white border border-gray-200 rounded-lg p-2" placeholder="如：微信+线下为主" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700">触达频次</div>
                        <input value={analysisDraft.strategy_layer?.contact_frequency || ''} onChange={(e) => setAnalysisField('strategy_layer.contact_frequency', e.target.value)} className="mt-1 w-full text-sm bg-white border border-gray-200 rounded-lg p-2" placeholder="如：每周一次" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700">推荐话题</div>
                        <textarea rows={2} value={analysisDraft.strategy_layer?.preferred_topics || ''} onChange={(e) => setAnalysisField('strategy_layer.preferred_topics', e.target.value)} className="mt-1 w-full text-sm leading-relaxed bg-white border border-gray-200 rounded-lg p-2" placeholder="如：行业趋势、协作机会" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700">禁忌话题</div>
                        <textarea rows={2} value={analysisDraft.strategy_layer?.taboo_topics || ''} onChange={(e) => setAnalysisField('strategy_layer.taboo_topics', e.target.value)} className="mt-1 w-full text-sm leading-relaxed bg-white border border-gray-200 rounded-lg p-2" placeholder="如：收入细节、家庭隐私" />
                      </div>
                      <div className="md:col-span-2">
                        <div className="text-xs font-bold text-gray-700">边界与红线</div>
                        <textarea rows={2} value={analysisDraft.strategy_layer?.boundaries_red_lines || ''} onChange={(e) => setAnalysisField('strategy_layer.boundaries_red_lines', e.target.value)} className="mt-1 w-full text-sm leading-relaxed bg-white border border-gray-200 rounded-lg p-2" placeholder="如：不借钱、不越界承诺" />
                      </div>
                    </div>
                    <div className="text-xs font-bold text-emerald-700">V2：执行计划与复盘闭环</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="md:col-span-2">
                        <div className="text-xs font-bold text-gray-700">本周动作计划（建议1/2/3）</div>
                        <textarea rows={3} value={analysisDraft.strategy_layer?.weekly_action_plan || ''} onChange={(e) => setAnalysisField('strategy_layer.weekly_action_plan', e.target.value)} className="mt-1 w-full text-sm leading-relaxed bg-white border border-gray-200 rounded-lg p-2" placeholder="动作1... 动作2... 动作3..." />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700">预期反馈信号</div>
                        <textarea rows={2} value={analysisDraft.strategy_layer?.expected_feedback_signals || ''} onChange={(e) => setAnalysisField('strategy_layer.expected_feedback_signals', e.target.value)} className="mt-1 w-full text-sm leading-relaxed bg-white border border-gray-200 rounded-lg p-2" placeholder="如：回复速度提升、愿意主动约见" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700">周复盘结果</div>
                        <textarea rows={2} value={analysisDraft.strategy_layer?.weekly_review_result || ''} onChange={(e) => setAnalysisField('strategy_layer.weekly_review_result', e.target.value)} className="mt-1 w-full text-sm leading-relaxed bg-white border border-gray-200 rounded-lg p-2" placeholder="本周执行结果" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700">偏差原因</div>
                        <textarea rows={2} value={analysisDraft.strategy_layer?.deviation_reason || ''} onChange={(e) => setAnalysisField('strategy_layer.deviation_reason', e.target.value)} className="mt-1 w-full text-sm leading-relaxed bg-white border border-gray-200 rounded-lg p-2" placeholder="如：节奏过快、话题不匹配" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700">下周调整动作</div>
                        <textarea rows={2} value={analysisDraft.strategy_layer?.next_week_adjustment || ''} onChange={(e) => setAnalysisField('strategy_layer.next_week_adjustment', e.target.value)} className="mt-1 w-full text-sm leading-relaxed bg-white border border-gray-200 rounded-lg p-2" placeholder="下周优化策略" />
                      </div>
                    </div>
                    <div className="text-xs font-bold text-orange-700">V3：投入产出与系统建议</div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <div className="text-xs font-bold text-gray-700">本月投入时间（小时）</div>
                        <input value={analysisDraft.strategy_layer?.invested_time_hours_month || ''} onChange={(e) => setAnalysisField('strategy_layer.invested_time_hours_month', e.target.value)} className="mt-1 w-full text-sm bg-white border border-gray-200 rounded-lg p-2" placeholder="如：10" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700">本月投入金钱</div>
                        <input value={analysisDraft.strategy_layer?.invested_money_month || ''} onChange={(e) => setAnalysisField('strategy_layer.invested_money_month', e.target.value)} className="mt-1 w-full text-sm bg-white border border-gray-200 rounded-lg p-2" placeholder="如：800" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700">价值收益评分（0-100）</div>
                        <input value={analysisDraft.strategy_layer?.gained_value_score || ''} onChange={(e) => setAnalysisField('strategy_layer.gained_value_score', e.target.value)} className="mt-1 w-full text-sm bg-white border border-gray-200 rounded-lg p-2" placeholder="如：65" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-gray-700">策略ROI评分</div>
                        <input value={analysisDraft.strategy_layer?.strategy_roi_score || ''} onChange={(e) => setAnalysisField('strategy_layer.strategy_roi_score', e.target.value)} className="mt-1 w-full text-sm bg-white border border-gray-200 rounded-lg p-2" placeholder="系统评估后会更新" />
                      </div>
                      <div className="md:col-span-2">
                        <div className="text-xs font-bold text-gray-700">系统建议</div>
                        <textarea rows={2} value={analysisDraft.strategy_layer?.system_recommendation || ''} onChange={(e) => setAnalysisField('strategy_layer.system_recommendation', e.target.value)} className="mt-1 w-full text-sm leading-relaxed bg-white border border-gray-200 rounded-lg p-2" placeholder="如：建议降频并收敛投入" />
                      </div>
                    </div>
                    {strategySuggestion && (
                      <div className="p-3 rounded-lg border border-indigo-100 bg-indigo-50/40 space-y-2">
                        <div className="text-xs font-bold text-indigo-800">AI 策略建议草案（请手动录入）</div>
                        <div className="text-xs text-indigo-700">基于策略版本：{formatStrategyVersion(strategySuggestion.strategy_version)}</div>
                        <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                          关系定位：{strategySuggestion?.recommendation?.relation_positioning || '-'}{'\n'}
                          关系优先级：{strategySuggestion?.recommendation?.relation_priority || '-'}{'\n'}
                          关系阶段：{strategySuggestion?.recommendation?.relation_stage || '-'}{'\n'}
                          30天目标：{strategySuggestion?.recommendation?.short_term_goal_30d || '-'}{'\n'}
                          90天目标：{strategySuggestion?.recommendation?.mid_term_goal_90d || '-'}{'\n'}
                          节奏：{strategySuggestion?.recommendation?.expected_rhythm || '-'}{'\n'}
                          渠道偏好：{strategySuggestion?.recommendation?.channel_preference || '-'}{'\n'}
                          触达频次：{strategySuggestion?.recommendation?.contact_frequency || '-'}{'\n'}
                          推荐话题：{strategySuggestion?.recommendation?.preferred_topics || '-'}{'\n'}
                          禁忌话题：{strategySuggestion?.recommendation?.taboo_topics || '-'}{'\n'}
                          每周时间预算：{strategySuggestion?.recommendation?.weekly_time_budget_hours || '-'}{'\n'}
                          月度金钱预算：{strategySuggestion?.recommendation?.money_budget_monthly || '-'}{'\n'}
                          边界与红线：{strategySuggestion?.recommendation?.boundaries_red_lines || '-'}{'\n'}
                          策略状态：{strategySuggestion?.recommendation?.strategy_status || '-'}{'\n'}
                          策略置信度：{strategySuggestion?.recommendation?.strategy_confidence || '-'}{'\n'}
                          本周动作计划：{strategySuggestion?.recommendation?.weekly_action_plan || '-'}{'\n'}
                          预期反馈信号：{strategySuggestion?.recommendation?.expected_feedback_signals || '-'}
                        </div>
                        <div className="text-xs text-gray-700">策略匹配说明：{strategySuggestion.match_reason || '-'}</div>
                        <div className="text-xs text-gray-700">投入成本提示：{strategySuggestion.cost_hint || '-'}</div>
                        <div className="text-xs text-gray-700">本周动作建议：{strategySuggestion.next_action || '-'}</div>
                      </div>
                    )}
                    {strategyEvaluation && (
                      <div className="p-3 rounded-lg border border-emerald-100 bg-emerald-50/40 space-y-1">
                        <div className="text-xs font-bold text-emerald-800">策略效果评估结果</div>
                        <div className="text-xs text-emerald-700">基于策略版本：{formatStrategyVersion(strategyEvaluation.strategy_version)}</div>
                        <div className="text-sm text-gray-800">ROI评分：{strategyEvaluation.roi_score ?? '-'}</div>
                        <div className="text-xs text-gray-700">结果得分：{strategyEvaluation.outcome_score ?? '-'} ｜ 成本得分：{strategyEvaluation.cost_score ?? '-'}</div>
                        <div className="text-xs text-gray-700">系统建议：{strategyEvaluation.recommendation || '-'}</div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100/50 flex items-center justify-between cursor-pointer hover:bg-blue-50" onClick={() => setShowPrivate(true)}>
                  <div className="flex items-center text-blue-900/50 font-medium">
                    <Lock className="w-4 h-4 mr-2" /> 动态关系作战地图 (已隐藏)
                  </div>
                  <Eye className="w-4 h-4 text-blue-400" />
                </div>
              )}

              <div>
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg font-bold text-gray-900 flex items-center">
                    <MessageSquare className="w-5 h-5 mr-2" /> 互动记录时间线
                  </h3>
                  <button onClick={() => setIsAddingLog(true)} className="text-sm text-primary hover:underline">+ 添加记录</button>
                </div>
              
              <div className="space-y-6 relative before:absolute before:left-2 before:top-2 before:bottom-0 before:w-0.5 before:bg-gray-200 pl-8">
                 {logs.length > 0 ? (
                     logs.map(log => (
                         <div key={log.id} className="relative">
                             <div className="absolute -left-[30px] top-1 w-3 h-3 bg-white border-2 border-primary rounded-full"></div>
                             <div className="text-xs text-gray-400 mb-1">{new Date(log.event_date).toLocaleDateString()} · {log.event_context}</div>
                             <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                                <div className="flex justify-end gap-3 mb-2">
                                  <button
                                    onClick={() => setEditingLog(log)}
                                    className="text-xs text-gray-500 hover:text-primary flex items-center"
                                  >
                                    <Edit2 className="w-3 h-3 mr-1" /> 编辑
                                  </button>
                                  <button
                                    onClick={() => handleDeleteLog(log.id)}
                                    className="text-xs text-gray-500 hover:text-red-600 flex items-center"
                                  >
                                    <Trash2 className="w-3 h-3 mr-1" /> 删除
                                  </button>
                                </div>
                                 <div className="mb-2">
                                     <span className="text-xs font-bold text-gray-500 bg-gray-200 px-1 rounded mr-2">我</span>
                                     <span className="text-sm text-gray-800">{log.my_behavior}</span>
                                 </div>
                                 <div className="mb-2">
                                     <span className="text-xs font-bold text-gray-500 bg-gray-200 px-1 rounded mr-2">TA</span>
                                     <span className="text-sm text-gray-800">{log.their_reaction}</span>
                                 </div>
                                 {log.relationship_change !== 0 && (
                                     <div className={`text-xs font-bold ${log.relationship_change > 0 ? 'text-green-600' : 'text-red-600'}`}>
                                         关系变化: {log.relationship_change > 0 ? '+' : ''}{log.relationship_change}%
                                     </div>
                                 )}
                                 
                                 {/* AI Review Section */}
                                 <div className="mt-3 pt-3 border-t border-gray-200">
                                     {log.ai_review ? (
                                         <details className="group">
                                             <summary className="text-xs font-bold text-purple-600 cursor-pointer flex items-center select-none">
                                                 <Bot className="w-3 h-3 mr-1" /> 🤖 AI 复盘
                                                 <ChevronDown className="w-3 h-3 ml-1 group-open:hidden" />
                                                 <ChevronUp className="w-3 h-3 ml-1 hidden group-open:block" />
                                             </summary>
                                             <div className="mt-2 text-xs text-gray-600 bg-purple-50 p-3 rounded border border-purple-100 whitespace-pre-wrap leading-relaxed">
                                                 {log.ai_review}
                                             </div>
                                         </details>
                                     ) : (
                                         <button 
                                             onClick={() => handleGenerateReview(log.id)}
                                             className="text-xs text-gray-400 hover:text-purple-600 flex items-center transition-colors"
                                         >
                                             <Bot className="w-3 h-3 mr-1" /> 生成 AI 复盘
                                         </button>
                                     )}
                                 </div>
                             </div>
                         </div>
                     ))
                 ) : (
                    <div className="text-gray-400 text-sm italic">暂无互动记录</div>
                 )}
              </div>
            </div>

            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <User className="w-16 h-16 mb-4 opacity-20" />
            <p>请选择或创建一个人物档案</p>
          </div>
        )}
      </div>

      {/* Creation Modal */}
      {isCreating && (
        <PersonCreationModal 
          onClose={() => setIsCreating(false)} 
          onSuccess={handleCreateSuccess}
        />
      )}

      {/* Add Log Modal */}
      {isAddingLog && selectedPerson && (
          <InteractionLogModal 
              personId={selectedPerson.id}
              currentLogCount={logs.length}
              onClose={() => setIsAddingLog(false)}
              onSuccess={handleLogAdded}
          />
      )}
      {editingLog && selectedPerson && (
          <InteractionLogModal
              personId={selectedPerson.id}
              initialData={editingLog}
              onClose={() => setEditingLog(null)}
              onSuccess={handleLogAdded}
          />
      )}

      {/* Related People Modal */}
      {showRelatedModal && isEditing && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
                  <h3 className="text-lg font-bold text-gray-900 mb-4">添加关联人物</h3>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                    {people
                        .filter(p => 
                            p.id !== selectedPerson.id && 
                            !editForm.related_people?.some((r: any) => r.id === p.id)
                        )
                        .map(p => (
                        <div 
                            key={p.id}
                            onClick={() => {
                                const rel = window.prompt('请输入你与TA的关系（例如：同事/导师/同学/合作伙伴）', '') || 'unknown';
                                const newRelated = [...(editForm.related_people || []), { id: p.id, name: p.name, role: p.identity, relation: rel }];
                                setEditForm({ ...editForm, related_people: newRelated });
                                setShowRelatedModal(false);
                            }}
                            className="flex items-center p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors"
                        >
                            <div className="w-8 h-8 rounded-full bg-gray-200 mr-3 overflow-hidden">
                                {p.avatar_real ? (
                                    <img src={p.avatar_real} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-500 font-bold text-xs">{p.name[0]}</div>
                                )}
                            </div>
                            <div>
                                <div className="font-bold text-gray-900 text-sm">{p.name}</div>
                                <div className="text-xs text-gray-500">{p.identity}</div>
                            </div>
                            <Plus className="w-4 h-4 text-gray-400 ml-auto" />
                        </div>
                    ))}
                    {people.filter(p => p.id !== selectedPerson.id && !editForm.related_people?.some((r: any) => r.id === p.id)).length === 0 && (
                        <div className="text-center py-4 text-gray-400 text-sm">暂无更多可选人物</div>
                    )}
                </div>
                  <button onClick={() => setShowRelatedModal(false)} className="mt-4 w-full py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">取消</button>
              </div>
          </div>
      )}
      {/* Analysis Review Modal */}
      {analysisResult && (
          <AnalysisReviewModal 
              currentData={isEditing && editForm ? editForm : selectedPerson}
              newData={analysisResult}
              onClose={() => setAnalysisResult(null)}
              onApply={handleApplyAnalysis}
          />
      )}

      {selectedPerson && (
        <AIAdvisorSidebar
          person={selectedPerson}
          open={advisorOpen}
          onClose={() => setAdvisorOpen(false)}
          onApplyInsight={(nextArchive: any) => {
            if (!selectedPerson) return;
            const parsed = parsePrivateInfoObject(selectedPerson.private_info);
            const nextPrivate = {
              ...(parsed || {}),
              behavioral_archive: {
                ...(parsed?.behavioral_archive || {}),
                ...(nextArchive || {}),
              },
            };
            const updated = { ...selectedPerson, private_info: JSON.stringify(nextPrivate) };
            setSelectedPerson(updated);
            setPeople((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
            setEditForm((prev: any) => (prev && prev.id === updated.id ? { ...prev, private_info: updated.private_info } : prev));
          }}
        />
      )}
    </div>
  );
}

function AIAdvisorSidebar({ person, open, onClose, onApplyInsight }: { person: any, open: boolean, onClose: () => void, onApplyInsight: (nextArchive: any) => void }) {
    const [threads, setThreads] = useState<any[]>([]);
    const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
    const [messages, setMessages] = useState<any[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [applyingId, setApplyingId] = useState<string | null>(null);
    const messageWrapRef = useRef<HTMLDivElement | null>(null);
    const [panelWidth, setPanelWidth] = useState(420);
    const [resizing, setResizing] = useState(false);

    const loadThreads = async () => {
      if (!person?.id) return;
      setLoading(true);
      try {
        const res = await api.getAdvisorThreads(person.id);
        const list = Array.isArray(res?.threads) ? res.threads : [];
        setThreads(list);
        const picked = res?.active_thread_id || list?.[0]?.id || null;
        setActiveThreadId(picked);
      } catch (err) {
        console.error('Failed to load advisor threads', err);
        setThreads([]);
        setActiveThreadId(null);
      } finally {
        setLoading(false);
      }
    };

    const loadThreadMessages = async (threadId: string) => {
      if (!person?.id || !threadId) return;
      try {
        const res = await api.getAdvisorThread(person.id, threadId);
        setMessages(Array.isArray(res?.thread?.messages) ? res.thread.messages : []);
      } catch (err) {
        console.error('Failed to load advisor thread', err);
        setMessages([]);
      }
    };

    useEffect(() => {
      if (!open || !person?.id) return;
      loadThreads();
    }, [open, person?.id]);

    useEffect(() => {
      if (!open || !activeThreadId) return;
      loadThreadMessages(activeThreadId);
    }, [open, activeThreadId]);

    useEffect(() => {
      if (!messageWrapRef.current) return;
      messageWrapRef.current.scrollTop = messageWrapRef.current.scrollHeight;
    }, [messages.length, open]);

    useEffect(() => {
      try {
        const raw = window.localStorage.getItem('advisor_sidebar_width');
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed >= 320 && parsed <= 760) setPanelWidth(parsed);
      } catch {}
    }, []);

    useEffect(() => {
      const handleMove = (e: MouseEvent) => {
        if (!resizing) return;
        const next = window.innerWidth - e.clientX - 16;
        const clamped = Math.max(320, Math.min(760, next));
        setPanelWidth(clamped);
      };
      const handleUp = () => {
        if (!resizing) return;
        setResizing(false);
      };
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
      return () => {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
      };
    }, [resizing]);

    useEffect(() => {
      try {
        window.localStorage.setItem('advisor_sidebar_width', String(panelWidth));
      } catch {}
    }, [panelWidth]);

    const createThread = async () => {
      if (!person?.id) return;
      try {
        const res = await api.createAdvisorThread(person.id, '新建会话');
        const t = res?.thread;
        if (t?.id) {
          setThreads((prev) => [t, ...(Array.isArray(prev) ? prev : [])]);
          setActiveThreadId(t.id);
          setMessages([]);
        }
      } catch (err) {
        console.error('Failed to create advisor thread', err);
      }
    };

    const send = async () => {
      const content = input.trim();
      if (!content || !person?.id || !activeThreadId) return;
      setSending(true);
      setInput('');
      const optimisticUser = { id: `temp_${Date.now()}`, role: 'user', content, created_at: new Date().toISOString(), applied: false };
      setMessages((prev) => [...(Array.isArray(prev) ? prev : []), optimisticUser]);
      try {
        const res = await api.advisorChat(person.id, { threadId: activeThreadId, content });
        setMessages((prev) => {
          const filtered = (prev || []).filter((m: any) => m.id !== optimisticUser.id);
          return [...filtered, res?.user_message, res?.assistant_message].filter(Boolean);
        });
        if (res?.thread) {
          setThreads((prev) => {
            const rest = (prev || []).filter((t: any) => t.id !== res.thread.id);
            return [res.thread, ...rest];
          });
        }
      } catch (err) {
        console.error('Failed to send advisor message', err);
        setMessages((prev) => (prev || []).filter((m: any) => m.id !== optimisticUser.id));
        setInput(content);
      } finally {
        setSending(false);
      }
    };

    const applyInsight = async (messageId: string) => {
      if (!person?.id || !activeThreadId || !messageId) return;
      setApplyingId(messageId);
      try {
        const res = await api.applyAdvisorInsight(person.id, { threadId: activeThreadId, messageId });
        setMessages((prev) => (prev || []).map((m: any) => m.id === messageId ? { ...m, applied: true } : m));
        if (res?.behavioral_archive) onApplyInsight(res.behavioral_archive);
      } catch (err) {
        console.error('Failed to apply advisor insight', err);
      } finally {
        setApplyingId(null);
      }
    };

    if (!open) return null;

    return (
      <div
        className="fixed right-4 top-4 bottom-4 z-40 bg-white border border-gray-200 rounded-2xl shadow-2xl flex flex-col"
        style={{ width: `${panelWidth}px` }}
      >
        <div
          onMouseDown={(e) => {
            e.preventDefault();
            setResizing(true);
          }}
          className={`absolute left-0 top-0 bottom-0 w-2 -translate-x-1/2 cursor-ew-resize ${resizing ? 'bg-purple-200/70' : 'bg-transparent hover:bg-purple-100/80'} rounded-l-full`}
        />
        <div className="px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-purple-50 to-blue-50 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div className="font-bold text-gray-900 flex items-center">
              <Bot className="w-4 h-4 mr-2 text-purple-600" />
              AI 军师 · 决策侧栏
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
          </div>
          <div className="text-xs text-gray-600 mt-1">咨询对象：{person?.name}（{person?.disc_type || '-'} / {person?.mbti_type || '-'}）</div>
        </div>

        <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 overflow-x-auto">
          <button onClick={createThread} className="shrink-0 text-xs px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50 flex items-center">
            <Plus className="w-3 h-3 mr-1" /> 新会话
          </button>
          {(threads || []).map((t: any) => (
            <button
              key={t.id}
              onClick={() => setActiveThreadId(t.id)}
              className={`shrink-0 text-xs px-2 py-1 rounded border ${activeThreadId === t.id ? 'border-purple-300 bg-purple-50 text-purple-700' : 'border-gray-200 bg-white text-gray-600'}`}
            >
              {t.title || '未命名'}
            </button>
          ))}
        </div>

        <div ref={messageWrapRef} className="flex-1 overflow-y-auto p-3 space-y-3">
          {loading ? (
            <div className="text-xs text-gray-400">加载中...</div>
          ) : !activeThreadId ? (
            <div className="text-xs text-gray-400">先创建一个会话再开始咨询。</div>
          ) : (
            <>
              {(messages || []).map((m: any) => (
                <div key={m.id} className={`rounded-lg px-3 py-2 text-sm ${m.role === 'assistant' ? 'bg-purple-50 border border-purple-100' : 'bg-gray-50 border border-gray-100'}`}>
                  <div className="text-[11px] text-gray-400 mb-1">{m.role === 'assistant' ? '军师' : '我'}</div>
                  {m.role === 'assistant' ? (
                    <div className="text-gray-800 leading-relaxed break-words">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="list-disc pl-5 mb-2">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2">{children}</ol>,
                          li: ({ children }) => <li className="mb-1">{children}</li>,
                          pre: ({ children }) => <pre className="p-2 rounded bg-gray-100 text-[13px] overflow-x-auto mb-2">{children}</pre>,
                          code: ({ children }) => <code className="px-1 py-0.5 rounded bg-gray-100 text-[13px]">{children}</code>,
                          a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {String(m.content || '')}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div className="text-gray-800 whitespace-pre-wrap leading-relaxed">{m.content}</div>
                  )}
                  {m.role === 'assistant' && (
                    <div className="mt-2 flex items-center">
                      <button
                        disabled={!!m.applied || applyingId === m.id}
                        onClick={() => applyInsight(m.id)}
                        className={`text-[11px] px-2 py-1 rounded border ${m.applied ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-blue-200 bg-white text-blue-700'} disabled:opacity-70`}
                      >
                        {m.applied ? '已沉淀到档案馆' : (applyingId === m.id ? '沉淀中…' : '沉淀到行为档案')}
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {(messages || []).length === 0 && <div className="text-xs text-gray-400">输入你的情境，开始多轮咨询。</div>}
            </>
          )}
        </div>

        <div className="p-3 border-t border-gray-100">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="flex-1 h-20 text-sm border border-gray-200 rounded-lg p-2 resize-none focus:ring-2 focus:ring-purple-200"
              placeholder="描述你当前的问题，军师会基于上下文连续给建议"
            />
            <button
              onClick={send}
              disabled={sending || !input.trim() || !activeThreadId}
              className="w-16 rounded-lg bg-purple-600 text-white text-sm disabled:opacity-50"
            >
              {sending ? '发送中' : '发送'}
            </button>
          </div>
        </div>
      </div>
    );
}

function AnalysisReviewModal({ currentData, newData, onClose, onApply }: { currentData: any, newData: any, onClose: () => void, onApply: (data: any) => void }) {
    const [editedData, setEditedData] = useState(newData);

    // Helper to render diff
    const DiffField = ({ label, oldVal, newVal, fieldKey, isList = false }: { label: string, oldVal: string, newVal: string | string[], fieldKey: string, isList?: boolean }) => {
        const hasChanged = isList 
            ? JSON.stringify(oldVal) !== JSON.stringify(newVal)
            : oldVal !== newVal;
            
        const handleListChange = (val: string) => {
            setEditedData({ ...editedData, [fieldKey]: val.split('\n') });
        };

        const handleChange = (val: string) => {
            setEditedData({ ...editedData, [fieldKey]: val });
        };

        return (
            <div className="mb-4">
                <div className="flex items-center mb-1">
                    <span className="text-sm font-bold text-gray-700">{label}</span>
                    {hasChanged && <span className="ml-2 text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">已变更</span>}
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                        <div className="text-xs text-gray-400 mb-1">当前内容</div>
                        <div className="text-sm text-gray-600 whitespace-pre-wrap">{isList && Array.isArray(oldVal) ? oldVal.join('\n') : (oldVal || '(空)')}</div>
                    </div>
                    <div className={`p-3 rounded-lg border ${hasChanged ? 'bg-green-50 border-green-100' : 'bg-gray-50 border-gray-100'}`}>
                        <div className="text-xs text-gray-400 mb-1 flex justify-between">
                            <span>AI 建议 (可编辑)</span>
                            <Edit2 className="w-3 h-3 text-gray-400" />
                        </div>
                        <textarea 
                            className={`w-full bg-transparent border-none p-0 text-sm focus:ring-0 resize-none ${hasChanged ? 'text-green-800 font-medium' : 'text-gray-600'}`}
                            value={isList && Array.isArray(newVal) ? newVal.join('\n') : (newVal || '')}
                            onChange={e => isList ? handleListChange(e.target.value) : handleChange(e.target.value)}
                            rows={isList ? 5 : 3}
                        />
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center p-6 border-b border-gray-100">
                    <h2 className="text-xl font-bold text-gray-900 flex items-center">
                        <Brain className="w-5 h-5 mr-2 text-primary" />
                        审查 AI 分析结果
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X className="w-6 h-6" />
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6">
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-6 text-sm text-blue-800 flex items-start">
                        <AlertCircle className="w-5 h-5 mr-2 shrink-0" />
                        AI 已根据最新互动记录生成了新的分析建议。您可以直接在右侧编辑 AI 的建议，确认无误后点击“应用更改”。
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                         <DiffField label="DISC 类型" oldVal={currentData.disc_type} newVal={editedData.disc} fieldKey="disc" />
                         <DiffField label="MBTI 类型" oldVal={currentData.mbti_type} newVal={editedData.mbti} fieldKey="mbti" />
                    </div>

                    <DiffField label="性格深度分析" oldVal={currentData.ai_analysis} newVal={editedData.analysis} fieldKey="analysis" />
                    <DiffField label="相处建议" oldVal={currentData.interaction_tips} newVal={editedData.tips} fieldKey="tips" />
                    
                    <div className="grid grid-cols-2 gap-4">
                        <DiffField label="雷区 (Triggers)" oldVal={currentData.triggers} newVal={editedData.triggers} fieldKey="triggers" isList={true} />
                        <DiffField label="爽点 (Pleasers)" oldVal={currentData.pleasers} newVal={editedData.pleasers} fieldKey="pleasers" isList={true} />
                    </div>
                </div>

                <div className="p-6 border-t border-gray-100 flex justify-end space-x-3 bg-gray-50 rounded-b-xl">
                    <button onClick={onClose} className="px-4 py-2 text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg text-sm font-medium transition-colors">
                        放弃更改
                    </button>
                    <button onClick={() => onApply(editedData)} className="px-6 py-2 text-white bg-primary hover:bg-primary/90 rounded-lg text-sm font-medium shadow-sm transition-colors flex items-center">
                        <Save className="w-4 h-4 mr-2" />
                        应用更改
                    </button>
                </div>
            </div>
        </div>
    );
}

function PersonCreationModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (person: any) => void }) {
    const [formData, setFormData] = useState({
        name: '',
        category: '', // Added category
        identity: '',
        field: '',
        hometown: '',
        tags: '',
        relationship_strength: 50,
        disc_type: '',
        mbti_type: '',
        contact_info: '',
        birthday: '', // Added birthday
        first_met_date: new Date().toISOString().split('T')[0],
        first_met_scene: '',
        ai_analysis: '', // User can manually input initial analysis
        interaction_tips: ''
    });
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const tagsArray = formData.tags.split(/[,，\s]+/).filter(Boolean);
            const dataToSave = {
                ...formData,
                tags: tagsArray,
                birthday: formData.birthday ? formData.birthday : null,
                first_met_date: formData.first_met_date ? formData.first_met_date : null,
                basic_info_extra: []
            };
            const result = await api.createPerson(dataToSave);
            onSuccess(result);
        } catch (error) {
            console.error("Create failed", error);
            alert("创建失败，请重试");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center p-6 border-b border-gray-100 sticky top-0 bg-white z-10">
                    <h2 className="text-xl font-bold text-gray-900">✨ 新建人物档案</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    {/* Basic Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">身份分类 *</label>
                            <div className="grid grid-cols-2 gap-2">
                                {CATEGORIES.map(cat => (
                                    <div 
                                        key={cat.id}
                                        onClick={() => setFormData({...formData, category: cat.id})}
                                        className={`flex items-center p-2 rounded-lg cursor-pointer border transition-colors ${formData.category === cat.id ? 'bg-primary/5 border-primary text-primary' : 'bg-white border-gray-200 hover:bg-gray-50'}`}
                                    >
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-2 ${formData.category === cat.id ? 'bg-primary text-white' : 'bg-gray-100 text-gray-500'}`}>
                                            {cat.icon}
                                        </div>
                                        <div className="text-xs font-medium">{cat.label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">姓名 *</label>
                            <input 
                                type="text" 
                                required
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                value={formData.name}
                                onChange={e => setFormData({...formData, name: e.target.value})}
                                placeholder="如：王教授"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">身份/职位 *</label>
                            <input 
                                type="text" 
                                required
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                value={formData.identity}
                                onChange={e => setFormData({...formData, identity: e.target.value})}
                                placeholder="如：某大学学院教授"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">所属领域/行业</label>
                            <input 
                                type="text" 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                value={formData.field}
                                onChange={e => setFormData({...formData, field: e.target.value})}
                                placeholder="如：机械工程 / 互联网"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">哪里人</label>
                            <input
                                type="text"
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                value={formData.hometown}
                                onChange={e => setFormData({...formData, hometown: e.target.value})}
                                placeholder="如：海南 / 北京"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">标签 (空格或逗号分隔)</label>
                            <input 
                                type="text" 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                value={formData.tags}
                                onChange={e => setFormData({...formData, tags: e.target.value})}
                                placeholder="如：导师 学术圈 高权力"
                            />
                        </div>
                    </div>

                    {/* Relationship & Personality */}
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-100 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">关系强度 ({formData.relationship_strength}%)</label>
                            <input 
                                type="range" 
                                min="0" 
                                max="100" 
                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary"
                                value={formData.relationship_strength}
                                onChange={e => setFormData({...formData, relationship_strength: parseInt(e.target.value)})}
                            />
                            <div className="flex justify-between text-xs text-gray-400 mt-1">
                                <span>陌生 (0%)</span>
                                <span>熟悉 (50%)</span>
                                <span>至交 (100%)</span>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">DISC 类型</label>
                                <select 
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary bg-white"
                                    value={formData.disc_type}
                                    onChange={e => setFormData({...formData, disc_type: e.target.value})}
                                >
                                    <option value="">未知</option>
                                    <option value="D型">D型 (支配型)</option>
                                    <option value="I型">I型 (影响型)</option>
                                    <option value="S型">S型 (稳健型)</option>
                                    <option value="C型">C型 (谨慎型)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">MBTI 类型</label>
                                <input 
                                    type="text" 
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                    value={formData.mbti_type}
                                    onChange={e => setFormData({...formData, mbti_type: e.target.value.toUpperCase()})}
                                    placeholder="如：INTJ"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Contact & Context */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">联系方式</label>
                            <input 
                                type="text" 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                value={formData.contact_info}
                                onChange={e => setFormData({...formData, contact_info: e.target.value})}
                                placeholder="电话/微信"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">生日</label>
                            <input 
                                type="date" 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                value={formData.birthday}
                                onChange={e => setFormData({...formData, birthday: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">认知时间</label>
                            <input 
                                type="date" 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                value={formData.first_met_date}
                                onChange={e => setFormData({...formData, first_met_date: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">认识场景</label>
                            <input 
                                type="text" 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary"
                                value={formData.first_met_scene}
                                onChange={e => setFormData({...formData, first_met_scene: e.target.value})}
                                placeholder="如：学术会议"
                            />
                        </div>
                    </div>
                    
                    {/* Notes */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">性格描述/备注</label>
                        <textarea 
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary/20 focus:border-primary h-24 resize-none"
                            value={formData.ai_analysis}
                            onChange={e => setFormData({...formData, ai_analysis: e.target.value})}
                            placeholder="输入对这个人的初步印象或性格分析..."
                        ></textarea>
                    </div>

                    <div className="pt-4 border-t border-gray-100 flex justify-end space-x-3">
                        <button 
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
                        >
                            取消
                        </button>
                        <button 
                            type="submit"
                            disabled={loading}
                            className="px-6 py-2 text-white bg-primary hover:bg-primary/90 rounded-lg text-sm font-medium shadow-sm transition-colors disabled:opacity-50 flex items-center"
                        >
                            {loading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>}
                            创建档案
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function InteractionLogModal({ personId, onClose, onSuccess, initialData, currentLogCount = 0 }: { personId: string; onClose: () => void; onSuccess: (result?: any) => void; initialData?: any; currentLogCount?: number }) {
    const [formData, setFormData] = useState({
        event_date: new Date().toISOString().split('T')[0],
        event_context: '',
        my_behavior: '',
        their_reaction: '',
        relationship_change: 0,
        ai_analysis: '' // Optional
    });
    const [loading, setLoading] = useState(false);
    const [rawInput, setRawInput] = useState('');
    const [aiExtracting, setAiExtracting] = useState(false);
    const isEditMode = !!initialData?.id;

    useEffect(() => {
      if (!initialData) return;
      setFormData({
        event_date: initialData.event_date ? String(initialData.event_date).slice(0, 10) : new Date().toISOString().split('T')[0],
        event_context: initialData.event_context || '',
        my_behavior: initialData.my_behavior || '',
        their_reaction: initialData.their_reaction || '',
        relationship_change: Number(initialData.relationship_change || 0),
        ai_analysis: initialData.ai_analysis || '',
      });
    }, [initialData]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            if (isEditMode) {
              const updated = await api.updateInteractionLog(initialData.id, { ...formData });
              onSuccess(updated);
            } else {
              const created = await api.createInteractionLog({ ...formData, person_id: personId });
              onSuccess(created);
              // Reset form
              setFormData({
                  event_date: new Date().toISOString().split('T')[0],
                  event_context: '',
                  my_behavior: '',
                  their_reaction: '',
                  relationship_change: 0,
                  ai_analysis: ''
              });
            }
        } catch (error) {
            console.error("Failed to save log", error);
            alert(isEditMode ? "更新失败" : "添加失败");
        } finally {
            setLoading(false);
        }
    };

    const handleExtractAndCreate = async () => {
      if (!rawInput.trim()) {
        alert('请先输入互动描述文本');
        return;
      }
      setAiExtracting(true);
      try {
        const result = await api.createInteractionLogsFromText({
          person_id: personId,
          text: rawInput,
          default_date: formData.event_date,
        });
        alert(result?.message || '已通过 AI 添加互动记录');
        onSuccess(result);
        setRawInput('');
      } catch (error) {
        console.error('Failed to extract logs from text', error);
        const errMsg = error instanceof Error ? error.message : 'AI提取并添加失败';
        const networkLike = /网络连接失败|Failed to fetch|NetworkError|timeout|超时|aborted/i.test(errMsg);
        if (networkLike) {
          try {
            const latest = await api.getInteractionLogs(personId);
            if (Array.isArray(latest) && latest.length > currentLogCount) {
              alert('已写入，响应超时。记录已成功添加并自动刷新。');
              onSuccess({ message: '已写入，响应超时' });
              return;
            }
          } catch (e) {
            console.error('Failed to verify logs after network-like error', e);
          }
        }
        alert(errMsg);
      } finally {
        setAiExtracting(false);
      }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
                <div className="flex justify-between items-center p-6 border-b border-gray-100">
                    <h2 className="text-xl font-bold text-gray-900">{isEditMode ? '✏️ 编辑互动记录' : '📝 添加互动记录'}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X className="w-6 h-6" />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {!isEditMode && <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-semibold text-indigo-900">AI 批量提取（可多次互动）</label>
                            <button
                                type="button"
                                onClick={handleExtractAndCreate}
                                disabled={aiExtracting}
                                className="px-3 py-1.5 text-xs text-indigo-700 bg-white border border-indigo-200 rounded-lg hover:bg-indigo-50 disabled:opacity-60"
                            >
                                {aiExtracting ? '提取中…' : 'AI提取并添加'}
                            </button>
                        </div>
                        <textarea
                            className="w-full border border-indigo-200 rounded-lg px-3 py-2 h-24 resize-y text-sm"
                            placeholder="直接粘贴一段长文字，AI会自动拆分为1条或多条互动记录并添加到时间线。"
                            value={rawInput}
                            onChange={e => setRawInput(e.target.value)}
                        />
                        <div className="mt-1 text-[11px] text-indigo-700/80">
                            示例：今天先在微信沟通了项目方向，晚上电话里又聊了预算分工。AI会按内容自动拆分。
                        </div>
                    </div>}
                    {!isEditMode && <div className="text-xs text-gray-400 pt-1 border-t border-gray-100">或手动添加单条记录：</div>}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">互动日期</label>
                        <input 
                            type="date" 
                            required
                            className="w-full border border-gray-300 rounded-lg px-3 py-2"
                            value={formData.event_date}
                            onChange={e => setFormData({...formData, event_date: e.target.value})}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">互动场景/背景</label>
                        <input 
                            type="text" 
                            required
                            className="w-full border border-gray-300 rounded-lg px-3 py-2"
                            placeholder="如：咖啡厅闲聊，讨论项目"
                            value={formData.event_context}
                            onChange={e => setFormData({...formData, event_context: e.target.value})}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">我的表现/行为</label>
                        <textarea 
                            required
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 h-20 resize-none"
                            placeholder="我说/做了什么..."
                            value={formData.my_behavior}
                            onChange={e => setFormData({...formData, my_behavior: e.target.value})}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">对方反应/反馈</label>
                        <textarea 
                            required
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 h-20 resize-none"
                            placeholder="他/她说了什么，表情如何..."
                            value={formData.their_reaction}
                            onChange={e => setFormData({...formData, their_reaction: e.target.value})}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">关系变化 (当前 +{formData.relationship_change}%)</label>
                        <input 
                            type="range" 
                            min="-10" 
                            max="10" 
                            className="w-full"
                            value={formData.relationship_change}
                            onChange={e => setFormData({...formData, relationship_change: parseInt(e.target.value)})}
                        />
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>恶化 (-10%)</span>
                            <span>不变 (0%)</span>
                            <span>升温 (+10%)</span>
                        </div>
                    </div>
                    
                    <div className="pt-4 flex justify-end space-x-3">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg text-sm">取消</button>
                        <button type="submit" disabled={loading} className="px-6 py-2 text-white bg-primary rounded-lg text-sm">
                            {loading ? (isEditMode ? '更新中...' : '保存中...') : (isEditMode ? '保存修改' : '保存记录')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
