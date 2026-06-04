// Bridges the string `icon` keys stored in utils/productGuide.js to lucide
// components. The catalog stays plain serialisable data (no React imports);
// this is the single place that resolves a key to a component, reused by the
// Guide drawer and the per-page intros.

import {
  LayoutDashboard, Briefcase, Brain, BarChart3, FileBarChart2, Map, Settings,
  Database, Inbox, Activity, Beaker, Sparkles, ShieldCheck, Gauge, LandPlot,
  Ruler, FileText, Clock, Calculator, ClipboardCheck, ShieldAlert, Building2,
  History, FileCheck, BadgeCheck, Cpu, MapPin, Layers, Compass,
} from 'lucide-react';

const ICONS = {
  LayoutDashboard, Briefcase, Brain, BarChart3, FileBarChart2, Map, Settings,
  Database, Inbox, Activity, Beaker, Sparkles, ShieldCheck, Gauge, LandPlot,
  Ruler, FileText, Clock, Calculator, ClipboardCheck, ShieldAlert, Building2,
  History, FileCheck, BadgeCheck, Cpu, MapPin, Layers,
};

// Compass is the fallback for an unknown key — a guide is a compass.
export function GuideIcon({ name, ...props }) {
  const Icon = ICONS[name] || Compass;
  return <Icon {...props} />;
}

export default GuideIcon;
