import {
  Home, UtensilsCrossed, Car, Film, Stethoscope, Shield, ShoppingBag,
  Zap, RefreshCw, Monitor, Plane, BookOpen, Sparkles, PiggyBank,
  DollarSign, Package, Shuffle, ArrowRightLeft, SlidersHorizontal,
  Megaphone, Paperclip, Code2, Handshake, Utensils, Printer, Building2,
} from 'lucide-react';

const MAP = {
  'Housing':                             Home,
  'Food & Dining':                       UtensilsCrossed,
  'Transportation':                      Car,
  'Entertainment':                       Film,
  'Healthcare':                          Stethoscope,
  'Insurance':                           Shield,
  'Shopping':                            ShoppingBag,
  'Utilities':                           Zap,
  'Subscriptions':                       RefreshCw,
  'Technology':                          Monitor,
  'Travel':                              Plane,
  'Education':                           BookOpen,
  'Personal Care':                       Sparkles,
  'Savings':                             PiggyBank,
  'Income':                              DollarSign,
  'Other':                               Package,
  'Split':                               Shuffle,
  'Transfer':                            ArrowRightLeft,
  'Adjustment':                          SlidersHorizontal,
  'Business - Advertising':              Megaphone,
  'Business - Office Supplies':          Paperclip,
  'Business - Software & SaaS':          Code2,
  'Business - Professional Services':    Handshake,
  'Business - Meals (50% deductible)':   Utensils,
  'Business - Travel':                   Plane,
  'Business - Vehicle & Mileage':        Car,
  'Business - Equipment':                Printer,
  'Business - Utilities':                Zap,
  'Business - Other':                    Building2,
};

export const CATEGORY_ICON_MAP = MAP;

export default function CategoryIcon({ name, size = 14, strokeWidth = 1.5, style }) {
  const Icon = MAP[name] ?? Package;
  return <Icon size={size} strokeWidth={strokeWidth} style={{ display:'inline', verticalAlign:'text-bottom', flexShrink:0, ...style }} />;
}
