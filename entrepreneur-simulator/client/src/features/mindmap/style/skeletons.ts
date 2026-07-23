import type {
  StyleProperties,
  StyleScope,
  TopicRole,
} from '../domain/types';
import { cloneStyleProperties, deepFreezeStyleValue } from './merge';

const literal = (value: string) => ({ kind: 'literal' as const, value });

const TOPIC_SKELETONS: Readonly<Record<TopicRole, Readonly<StyleProperties>>> =
  deepFreezeStyleValue({
    central: {
      opacity: 1,
      fill: { color: literal('#4F46E5') },
      border: { color: literal('#3730A3'), radius: 16, width: 2 },
      typography: { color: literal('#FFFFFF'), fontWeight: 700 },
    },
    regular: {
      opacity: 1,
      fill: { color: literal('#FFFFFF') },
      border: { color: literal('#CBD5E1'), radius: 12, width: 1 },
      typography: { color: literal('#0F172A') },
    },
    'floating-root': {
      opacity: 1,
      fill: { color: literal('#FFFBEB') },
      border: { color: literal('#F59E0B'), radius: 14, width: 2 },
      typography: { color: literal('#78350F'), fontWeight: 600 },
    },
    'summary-result': {
      opacity: 1,
      fill: { color: literal('#ECFDF5') },
      border: { color: literal('#10B981'), radius: 14, width: 2 },
      typography: { color: literal('#064E3B'), fontWeight: 600 },
    },
  });

const SCOPE_SKELETONS: Readonly<Record<StyleScope, Readonly<StyleProperties>>> =
  deepFreezeStyleValue({
    sheet: { opacity: 1 },
    topic: TOPIC_SKELETONS.regular,
    'tree-edge': {
      opacity: 1,
      connector: { color: literal('#64748B'), width: 2 },
    },
    relationship: {
      opacity: 0.9,
      connector: { color: literal('#8B5CF6'), width: 2, dash: [6, 4] },
    },
    boundary: {
      opacity: 1,
      fill: { color: literal('#EFF6FF'), opacity: 0.08 },
      border: { color: literal('#60A5FA'), dash: [7, 5], radius: 18, width: 2 },
      typography: { color: literal('#1D4ED8'), fontWeight: 600 },
    },
    summary: {
      opacity: 1,
      border: { color: literal('#8B5CF6'), width: 2 },
      typography: { color: literal('#6D28D9'), fontWeight: 600 },
    },
    callout: {
      opacity: 1,
      fill: { color: literal('#FFFBEB') },
      border: { color: literal('#F59E0B'), radius: 12, width: 2 },
      typography: { color: literal('#92400E') },
    },
    zone: {
      opacity: 1,
      fill: { color: literal('#F8FAFC'), opacity: 0.12 },
      border: { color: literal('#94A3B8'), dash: [6, 4], radius: 12, width: 1 },
      typography: { color: literal('#475569'), fontWeight: 600 },
    },
    marker: { opacity: 1 },
    presentation: { opacity: 1 },
  });

export const getBuiltInTopicSkeleton = (role: TopicRole): StyleProperties =>
  cloneStyleProperties(TOPIC_SKELETONS[role]);

export const getBuiltInScopeSkeleton = (scope: StyleScope): StyleProperties =>
  cloneStyleProperties(SCOPE_SKELETONS[scope]);

export const BUILT_IN_TOPIC_SKELETONS = TOPIC_SKELETONS;
export const BUILT_IN_SCOPE_SKELETONS = SCOPE_SKELETONS;
